import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { unzipSync } from "fflate";
import * as Y from "yjs";
import { db } from "../db/index.js";
import { pages, type PropertyType } from "../db/schema.js";
import { saveUpload } from "../routes/files.js";
import { writeMarkdown } from "./blocks.js";
import { createDatabase, createProperty, createRowWithValues, getDatabase } from "./database.js";
import { emitWorkspace } from "./events.js";
import { positionAt } from "./tree.js";
import { extractCover, extractText, getTitle, seedTitle } from "./ydoc.js";

/**
 * Imports Notion exports ("Markdown & CSV" zip), Markdown files or folders (zipped), Obsidian vaults and
 * CSV files into a workspace. Folders become pages, CSV files become databases, links between notes and
 * embedded images are rewritten to Calepin pages and uploaded files.
 */

export type ImportSummary = {
  pages: number;
  databases: number;
  rows: number;
  files: number;
  roots: RootRef[];
  warnings: string[];
};
type RootRef = { id: string; title: string; type: "page" | "database" };

export type ImportJob = {
  id: string;
  userId: string;
  workspaceId: string;
  status: "running" | "done" | "error";
  step: string;
  done: number;
  total: number;
  result?: ImportSummary;
  error?: string;
  startedAt: number;
};

const jobs = new Map<string, ImportJob>();
export const getImportJob = (id: string) => jobs.get(id);

/* ---------- Files ---------- */

const decoder = new TextDecoder();
const MD = /\.(md|markdown|mdown|txt)$/i;
const CSV = /\.csv$/i;
const NOTION_ID = /\s+([0-9a-f]{32})$/i;
const SKIP = /(^|\/)(\.[^/]+|__MACOSX|node_modules)(\/|$)/;

/** Unzips (including the zips Notion nests inside its export) into path → bytes. */
function expand(name: string, data: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const add = (path: string, bytes: Uint8Array, depth: number) => {
    if (SKIP.test(path)) return;
    if (/\.zip$/i.test(path) && depth < 3) {
      for (const [p, b] of Object.entries(unzipSync(bytes))) {
        if (p.endsWith("/")) continue;
        // Nested export parts ("Export-…-Part-1.zip") merge into one tree.
        add(p, b, depth + 1);
      }
      return;
    }
    out.set(path.normalize("NFC"), bytes);
  };
  add(name, data, 0);
  // Notion sometimes wraps everything in one "Export-…" folder: that folder is not a page of its own.
  const tops = new Set([...out.keys()].map((p) => (p.includes("/") ? p.split("/")[0]! : "")));
  if (tops.size === 1) {
    const [top] = [...tops];
    if (top && /^export[-_ ]/i.test(top)) {
      const strip = new Map<string, Uint8Array>();
      for (const [p, b] of out) strip.set(p.slice(top.length + 1), b);
      return strip;
    }
  }
  return out;
}

const clean = (segment: string) =>
  segment
    .replace(/\.(md|markdown|mdown|txt|csv)$/i, "")
    .replace(/_all$/i, "")
    .replace(NOTION_ID, "")
    .trim();
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const stem = (p: string) => baseOf(p).replace(/\.[^.]+$/, "");

function joinPath(dir: string, rel: string) {
  const parts = (dir ? dir.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/* ---------- Tree ---------- */

type Node = {
  /** Folder path or file path without extension: the key other files use to find this node. */
  key: string;
  title: string;
  kind: "page" | "database";
  mdPath?: string;
  csvPath?: string;
  children: Node[];
  id?: string;
};

function buildTree(files: Map<string, Uint8Array>) {
  const nodes = new Map<string, Node>();
  const root: Node = { key: "", title: "", kind: "page", children: [] };
  nodes.set("", root);

  const ensureFolder = (dir: string): Node => {
    const existing = nodes.get(dir);
    if (existing) return existing;
    const node: Node = { key: dir, title: clean(baseOf(dir)), kind: "page", children: [] };
    nodes.set(dir, node);
    ensureFolder(dirOf(dir)).children.push(node);
    return node;
  };

  const paths = [...files.keys()].sort((a, b) => a.localeCompare(b));
  // Notion writes "X.csv" and "X_all.csv": keep the complete one.
  const csvs = paths.filter((p) => CSV.test(p));
  const skipCsv = new Set(
    csvs.filter((p) => !/_all\.csv$/i.test(p) && csvs.includes(p.replace(/\.csv$/i, "_all.csv"))),
  );

  for (const path of paths) {
    const isMd = MD.test(path);
    const isCsv = CSV.test(path) && !skipCsv.has(path);
    if (!isMd && !isCsv) continue;
    const dir = dirOf(path);
    const key = joinPath(dir, stem(path).replace(/_all$/i, ""));
    // Obsidian folder note (X/X.md) or index.md / README.md: the content of the folder page itself.
    const folderName = baseOf(dir);
    const isFolderNote = isMd && dir && (stem(path) === folderName || /^(index|readme|_index)$/i.test(stem(path)));
    const target = isFolderNote ? ensureFolder(dir) : (nodes.get(key) ?? null);
    if (target) {
      if (isMd) target.mdPath ??= path;
      if (isCsv) {
        target.csvPath = path;
        target.kind = "database";
      }
      continue;
    }
    const node: Node = {
      key,
      title: clean(baseOf(path)),
      kind: isCsv ? "database" : "page",
      mdPath: isMd ? path : undefined,
      csvPath: isCsv ? path : undefined,
      children: [],
    };
    // "X.md" next to a folder "X/": the folder's contents are its subpages.
    const folder = nodes.get(key);
    if (folder) {
      folder.mdPath ??= node.mdPath;
      if (isCsv) Object.assign(folder, { csvPath: path, kind: "database" });
      continue;
    }
    nodes.set(key, node);
    ensureFolder(dir).children.push(node);
  }
  // Folders created before their "X.md" sibling was seen were registered under the same key, so they merged.
  return { root, nodes };
}

/* ---------- Markdown clean-up and link rewriting ---------- */

function splitFrontMatter(md: string) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: [] as [string, string][], body: md };
  const meta: [string, string][] = [];
  let lastKey = "";
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_\- ]+):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1]!.trim();
      meta.push([lastKey, kv[2]!.trim().replace(/^["']|["']$/g, "")]);
    } else if (/^\s*-\s+/.test(line) && lastKey) {
      const last = meta.at(-1)!;
      last[1] = [last[1], line.replace(/^\s*-\s+/, "").trim()].filter(Boolean).join(", ");
    }
  }
  return { meta: meta.filter(([, v]) => v), body: md.slice(m[0].length) };
}

type Resolver = {
  page: (target: string, fromDir: string) => string | undefined;
  file: (target: string, fromDir: string) => string | undefined;
};

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic)$/i;

/** Rewrites Markdown links and Obsidian syntax to Calepin links; returns attachments to upload. */
function rewrite(md: string, fromDir: string, resolve: Resolver) {
  const attachments: { path: string; placeholder: string; image: boolean }[] = [];
  const attach = (path: string, image: boolean) => {
    const placeholder = `calepin-attachment-${attachments.length}-${randomUUID().slice(0, 8)}`;
    attachments.push({ path, placeholder, image });
    return placeholder;
  };
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  let out = md;
  // Obsidian embeds: ![[image.png|300]] / ![[Note]]
  out = out.replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (all, target: string, alias?: string) => {
    const file = resolve.file(target.trim(), fromDir);
    if (file)
      return IMAGE.test(file) ? `![${stem(file)}](${attach(file, true)})` : `[${baseOf(file)}](${attach(file, false)})`;
    const page = resolve.page(target.trim(), fromDir);
    return page ? `[${alias && !/^\d+$/.test(alias) ? alias : clean(target)}](/p/${page})` : all;
  });
  // Obsidian links: [[Note]], [[Note|alias]], [[Note#Heading]]
  out = out.replace(
    /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g,
    (all, target: string, heading?: string, alias?: string) => {
      const page = resolve.page(target.trim(), fromDir);
      const label = alias?.trim() || (heading ? `${clean(target)} › ${heading}` : clean(baseOf(target.trim())));
      if (page) return `[${label}](/p/${page})`;
      const file = resolve.file(target.trim(), fromDir);
      return file ? `[${label}](${attach(file, false)})` : label;
    },
  );
  // Markdown images and links with relative targets.
  out = out.replace(
    /(!?)\[([^\]]*)\]\(<?([^)<>]+?)>?(?:\s+"[^"]*")?\)/g,
    (all, bang: string, text: string, href: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return all;
      const target = decode(href.split("#")[0]!);
      if (!target) return all;
      if (MD.test(target) || CSV.test(target) || !/\.[a-z0-9]{1,5}$/i.test(target)) {
        const page = resolve.page(target, fromDir);
        if (page) return `${bang ? "" : ""}[${text || clean(baseOf(target))}](/p/${page})`;
      }
      const file = resolve.file(target, fromDir);
      if (file)
        return bang || IMAGE.test(file)
          ? `![${text}](${attach(file, true)})`
          : `[${text || baseOf(file)}](${attach(file, false)})`;
      return all;
    },
  );
  // Obsidian highlights become bold (no highlight mark in Markdown).
  out = out.replace(/==([^=\n]+)==/g, "**$1**");
  return { markdown: out, attachments };
}

/* ---------- CSV ---------- */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

const NUMBER = /^-?\$?\s?\d{1,3}([ ,]?\d{3})*([.,]\d+)?\s?(%|\$)?$|^-?\d+([.,]\d+)?$/;
const toNumber = (v: string) =>
  Number(
    v
      .replace(/[$%\s]/g, "")
      .replace(/,(?=\d{3}\b)/g, "")
      .replace(",", "."),
  );
const YES = new Set(["yes", "no", "true", "false", "oui", "non", "x", "✓", "✔", "☑", "☐"]);

/** Notion dates ("November 16, 2026", "2026/11/16", ranges "A → B") as YYYY-MM-DD. */
function toDate(v: string): string | null {
  const first = v.split(/\s*(→|->)\s*/)[0]!.trim();
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(first)) return first.replace(/\//g, "-");
  if (!/\d/.test(first) || !/[a-z]/i.test(first.replace(/\b(am|pm)\b/gi, ""))) {
    if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(first)) return null;
  }
  const t = Date.parse(first.replace(/\s*\(.*\)$/, ""));
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Notion writes relations as "Page title (path/to/Page%20title%20<id>.md)". */
const stripLinks = (v: string) =>
  v
    .split(/,\s*(?=[^,]*\([^)]*\.md\))/)
    .map((x) => x.replace(/\s*\([^)]*\.md\)\s*$/, "").trim())
    .join(", ");

function inferType(values: string[]): PropertyType {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (!filled.length) return "text";
  if (filled.every((v) => YES.has(v.toLowerCase()))) return "checkbox";
  if (filled.every((v) => NUMBER.test(v))) return "number";
  if (filled.every((v) => /^https?:\/\/\S+$/i.test(v))) return "url";
  if (filled.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return "email";
  if (filled.every((v) => toDate(v))) return "date";
  const tokens = filled.flatMap((v) => v.split(/,\s*/).map((t) => t.trim()));
  const distinct = new Set(tokens.map((t) => t.toLowerCase()));
  const short = tokens.every((t) => t.length <= 40);
  const multi = filled.some((v) => v.includes(", "));
  if (multi) {
    // Lists of short labels (Notion multi-selects); sentences with commas stay text.
    const labels = tokens.every((t) => t.length <= 30 && t.split(/\s+/).length <= 4);
    const repeated = distinct.size < tokens.length || filled.length <= 5;
    if (labels && repeated && distinct.size <= 50 && filled.every((v) => v.split(",").length <= 12))
      return "multi_select";
    return "text";
  }
  if (short && distinct.size <= 30 && distinct.size <= Math.max(3, filled.length * 0.6)) return "select";
  return "text";
}

function cellValue(type: PropertyType, raw: string): unknown {
  const v = raw.trim();
  if (!v) return undefined;
  switch (type) {
    case "checkbox":
      return ["yes", "true", "oui", "x", "✓", "✔", "☑"].includes(v.toLowerCase());
    case "number":
      return toNumber(v);
    case "date":
      return toDate(v) ?? undefined;
    case "multi_select":
      return [
        ...new Set(
          v
            .split(/,\s*/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
    default:
      return v;
  }
}

/* ---------- Writing pages ---------- */

/** Fills a page's document (title + Markdown) directly, without going through the live collaboration server. */
async function writeDocument(pageId: string, title: string, markdown: string, userId: string) {
  const doc = new Y.Doc();
  seedTitle(doc, pageId, title);
  if (markdown.trim()) await writeMarkdown(doc, markdown, "replace");
  await db
    .update(pages)
    .set({
      yjsState: Y.encodeStateAsUpdate(doc),
      title: getTitle(doc),
      contentText: extractText(doc),
      cover: extractCover(doc),
      updatedBy: userId,
    })
    .where(eq(pages.id, pageId));
  doc.destroy();
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  heic: "image/heic",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/* ---------- Job ---------- */

export function startImport(input: {
  userId: string;
  workspaceId: string;
  parentId: string | null;
  fileName: string;
  data: Uint8Array;
}) {
  const job: ImportJob = {
    id: randomUUID(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    status: "running",
    step: "reading",
    done: 0,
    total: 0,
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  // Forget finished jobs after an hour.
  for (const [id, j] of jobs) if (Date.now() - j.startedAt > 3_600_000) jobs.delete(id);
  runImport(job, input)
    .then((result) => Object.assign(job, { status: "done", result, step: "done" }))
    .catch((e) => {
      console.error("[import]", e);
      Object.assign(job, { status: "error", error: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => emitWorkspace(input.workspaceId));
  return job;
}

async function runImport(
  job: ImportJob,
  input: { userId: string; workspaceId: string; parentId: string | null; fileName: string; data: Uint8Array },
): Promise<ImportSummary> {
  const files = expand(input.fileName, input.data);
  const { root, nodes } = buildTree(files);
  // A lone Markdown file takes its first heading as title ("notes.md" starting with "# Réunion").
  if (MD.test(input.fileName) && root.children.length === 1 && root.children[0]!.mdPath) {
    const only = root.children[0]!;
    const h1 = decoder
      .decode(files.get(only.mdPath!)!)
      .replace(/^---[\s\S]*?\n---\n/, "")
      .match(/^\s*#\s+(.+)/);
    if (h1) only.title = h1[1]!.trim();
  }
  const summary: ImportSummary = { pages: 0, databases: 0, rows: 0, files: 0, roots: [], warnings: [] };
  const all = [...nodes.values()].filter((n) => n !== root);
  if (!all.length) throw new Error("Nothing to import: no Markdown or CSV files found.");
  job.total = all.length;
  job.step = "pages";

  // Lookup tables for links: by path (with and without extension) and by name (Obsidian resolves by name).
  const byPath = new Map<string, Node>();
  const byName = new Map<string, Node>();
  for (const n of all) {
    for (const k of [n.key, n.mdPath, n.csvPath].filter(Boolean) as string[]) byPath.set(k.toLowerCase(), n);
    const name = (n.mdPath ? stem(n.mdPath) : baseOf(n.key)).toLowerCase();
    if (!byName.has(name)) byName.set(name, n);
    const cleanName = n.title.toLowerCase();
    if (!byName.has(cleanName)) byName.set(cleanName, n);
  }
  const fileByName = new Map<string, string>();
  for (const p of files.keys()) if (!MD.test(p) && !CSV.test(p)) fileByName.set(baseOf(p).toLowerCase(), p);

  const resolver: Resolver = {
    page(target, fromDir) {
      const t = target.replace(/\.(md|markdown|csv)$/i, "");
      const n =
        byPath.get(joinPath(fromDir, t).toLowerCase()) ??
        byPath.get(joinPath(fromDir, target).toLowerCase()) ??
        byPath.get(t.toLowerCase()) ??
        byName.get(baseOf(t).toLowerCase()) ??
        byName.get(clean(baseOf(t)).toLowerCase());
      return n?.id;
    },
    file(target, fromDir) {
      const direct = joinPath(fromDir, target);
      if (files.has(direct) && !MD.test(direct)) return direct;
      if (files.has(target) && !MD.test(target)) return target;
      return fileByName.get(baseOf(target).toLowerCase());
    },
  };

  // Pass 1: create every page and database (so links can point at them), in tree order.
  const created: Node[] = [];
  const create = async (node: Node, parentId: string | null, position: string) => {
    if (node.kind === "database") {
      const page = await createDatabase({
        workspaceId: input.workspaceId,
        parentId,
        title: node.title || "Untitled",
        userId: input.userId,
        viewName: "Table",
      });
      await db.update(pages).set({ position }).where(eq(pages.id, page.id));
      node.id = page.id;
      summary.databases++;
    } else {
      const [page] = await db
        .insert(pages)
        .values({
          workspaceId: input.workspaceId,
          parentId,
          position,
          title: node.title,
          createdBy: input.userId,
          updatedBy: input.userId,
        })
        .returning({ id: pages.id });
      node.id = page!.id;
      summary.pages++;
    }
    created.push(node);
    job.done++;
    let pos: string | null = null;
    // Pages first, then databases, each alphabetically (Notion's own order isn't in the export).
    const kids = [...node.children].sort(
      (a, b) => Number(a.kind === "database") - Number(b.kind === "database") || a.title.localeCompare(b.title),
    );
    for (const child of kids) {
      // Rows of a database come from its CSV, not from the page tree.
      if (node.kind === "database" && child.kind === "page" && !child.children.length) continue;
      pos = generateKeyBetween(pos, null);
      await create(child, node.id!, pos);
    }
  };

  let pos = await positionAt(input.workspaceId, input.parentId);
  const tops = [...root.children].sort(
    (a, b) => Number(a.kind === "database") - Number(b.kind === "database") || a.title.localeCompare(b.title),
  );
  for (const node of tops) {
    await create(node, input.parentId, pos);
    summary.roots.push({ id: node.id!, title: node.title, type: node.kind });
    pos = generateKeyBetween(pos, null);
  }

  // Pass 2: content, attachments and database rows.
  job.step = "content";
  job.done = 0;
  job.total = created.length;
  const uploaded = new Map<string, string>();

  const markdownFor = async (pageId: string, path: string, opts: { skipProps?: Set<string>; title?: string } = {}) => {
    let text = decoder.decode(files.get(path)!).replace(/\r\n/g, "\n");
    const { meta, body } = splitFrontMatter(text);
    text = body.replace(/^\s+/, "");
    // Notion repeats the title as the first heading.
    const firstHeading = text.match(/^#\s+(.+)\n?/);
    if (firstHeading && opts.title !== undefined && firstHeading[1]!.trim() === opts.title.trim())
      text = text.slice(firstHeading[0].length).replace(/^\s+/, "");
    // Notion row pages start with "Property: value" lines already imported from the CSV.
    if (opts.skipProps?.size) {
      const lines = text.split("\n");
      let i = 0;
      while (i < lines.length && (lines[i]!.trim() === "" || opts.skipProps.has(lines[i]!.split(":")[0]!.trim()))) i++;
      text = lines.slice(i).join("\n");
    }
    if (meta.length) text = `${meta.map(([k, v]) => `- **${k}:** ${v}`).join("\n")}\n\n---\n\n${text}`;
    const { markdown, attachments } = rewrite(text, dirOf(path), resolver);
    let result = markdown;
    for (const a of attachments) {
      let url = uploaded.get(`${pageId}|${a.path}`);
      if (!url) {
        const bytes = files.get(a.path);
        if (!bytes) continue;
        const ext = a.path.split(".").pop()!.toLowerCase();
        try {
          const file = await saveUpload({
            workspaceId: input.workspaceId,
            pageId,
            userId: input.userId,
            name: baseOf(a.path),
            mime: MIME[ext] ?? "application/octet-stream",
            data: bytes,
          });
          url = file.url;
          uploaded.set(`${pageId}|${a.path}`, url);
          summary.files++;
        } catch (e) {
          summary.warnings.push(`${baseOf(a.path)}: ${e instanceof Error ? e.message : "upload failed"}`);
          continue;
        }
      }
      result = result.split(a.placeholder).join(url);
    }
    return result;
  };

  for (const node of created) {
    try {
      if (node.kind === "page") {
        const md = node.mdPath ? await markdownFor(node.id!, node.mdPath, { title: node.title }) : "";
        await writeDocument(node.id!, node.title, md, input.userId);
      } else {
        if (node.mdPath)
          await writeDocument(
            node.id!,
            node.title,
            await markdownFor(node.id!, node.mdPath, { title: node.title }),
            input.userId,
          );
        else await writeDocument(node.id!, node.title, "", input.userId);
        summary.rows += await importCsv(node, input, files, markdownFor, summary);
      }
    } catch (e) {
      summary.warnings.push(`${node.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
    job.done++;
  }
  return summary;
}

async function importCsv(
  node: Node,
  input: { userId: string; workspaceId: string },
  files: Map<string, Uint8Array>,
  markdownFor: (pageId: string, path: string, opts?: { skipProps?: Set<string>; title?: string }) => Promise<string>,
  summary: ImportSummary,
) {
  if (!node.csvPath) return 0;
  const table = parseCsv(decoder.decode(files.get(node.csvPath)!));
  if (table.length < 1) return 0;
  const [header, ...rows] = table;
  const titleCol = 0;
  const columns = header!
    .map((name, i) => ({ name: name.trim() || `Column ${i + 1}`, i }))
    .filter((c) => c.i !== titleCol);
  const types = new Map<number, PropertyType>();
  const values = rows.map((r) => r.map((v) => stripLinks(v ?? "")));
  for (const c of columns) types.set(c.i, inferType(values.map((r) => r[c.i] ?? "")));

  // Properties: create them through the normal path (options are created from values as rows arrive).
  for (const c of columns)
    await createProperty(node.id!, { name: c.name, type: types.get(c.i)!, config: {} }, node.title);
  const database = await getDatabase(node.id!);
  if (!database) return 0;
  const byName = new Map(database.properties.map((p) => [p.name, p]));

  // Row pages exported next to the CSV ("DB/Row title <id>.md"), matched by title.
  const rowFiles = new Map<string, string>();
  const dir = node.csvPath.replace(/(_all)?\.csv$/i, "");
  for (const p of files.keys()) if (MD.test(p) && dirOf(p) === dir) rowFiles.set(clean(baseOf(p)).toLowerCase(), p);
  const propNames = new Set(header!.map((h) => h.trim()));

  let count = 0;
  for (const r of values) {
    const title = (r[titleCol] ?? "").trim();
    const vals: Record<string, unknown> = {};
    for (const c of columns) {
      const prop = byName.get(c.name);
      const v = cellValue(types.get(c.i)!, r[c.i] ?? "");
      if (prop && v !== undefined) vals[prop.id] = v;
    }
    let row: { id: string };
    try {
      row = await createRowWithValues({
        database: { id: database.page.id, workspaceId: database.page.workspaceId },
        properties: database.properties,
        title,
        values: vals,
        userId: input.userId,
      });
    } catch (e) {
      summary.warnings.push(`${node.title} / ${title}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const mdPath = rowFiles.get(title.toLowerCase());
    const md = mdPath ? await markdownFor(row.id, mdPath, { title, skipProps: propNames }) : "";
    await writeDocument(row.id, title, md, input.userId);
    count++;
  }
  return count;
}
