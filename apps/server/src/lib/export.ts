import { and, eq, isNull } from "drizzle-orm";
import { strToU8, zipSync, type Zippable } from "fflate";
import * as Y from "yjs";
import { db } from "../db/index.js";
import { pages, workspaces } from "../db/schema.js";
import { docToMarkdown } from "./blocks.js";
import { nameDatabaseLinks } from "./pages.js";
import { formatValue, getDatabase, getRows, peopleNames, personIds, type Property } from "./database.js";
import { iconPrefix } from "./icons.js";

/** Safe file name, keeping accents (Québec stays Québec). */
export function fileName(title: string, fallback = "Sans titre") {
  const clean = (title || fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return clean.replace(/^\.+/, "") || fallback;
}

function docFrom(state: Uint8Array | null) {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  return doc;
}

const yamlString = (v: string) => (/^[\w .,@/-]*$/.test(v) && v.trim() === v && v !== "" ? v : JSON.stringify(v));

/** Markdown for one page: title heading, YAML front matter with properties for database rows. */
export async function pageToMarkdown(page: {
  title: string;
  icon: string | null;
  yjsState: Uint8Array | null;
  props?: Record<string, unknown>;
  properties?: Property[];
  people?: Map<string, string>;
  row?: { props: Record<string, unknown> };
}) {
  const body = await nameDatabaseLinks(await docToMarkdown(docFrom(page.yjsState)));
  const heading = `# ${iconPrefix(page.icon)}${page.title || "Sans titre"}`;
  let front = "";
  if (page.properties?.length && page.row) {
    const lines = page.properties
      .map((p) => [p.name, formatValue(p, page.row!.props[p.id], page.people ?? new Map())] as const)
      .filter(([, v]) => v !== "")
      .map(([k, v]) => `${yamlString(k)}: ${yamlString(v)}`);
    if (lines.length) front = `---\n${lines.join("\n")}\n---\n\n`;
  }
  return `${front}${heading}\n\n${body}\n`;
}

const csvCell = (v: string) => (/[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function databaseToCsv(databaseId: string) {
  const database = await getDatabase(databaseId);
  if (!database) throw new Error("Not a database");
  const rows = await getRows(databaseId, database.properties);
  const people = await peopleNames(personIds(database.properties, rows));
  const header = ["Nom", ...database.properties.map((p) => p.name)];
  const lines = [
    header.map(csvCell).join(","),
    ...rows.map((r) =>
      [r.title, ...database.properties.map((p) => formatValue(p, r.props[p.id], people))].map(csvCell).join(","),
    ),
  ];
  // BOM so Excel opens accents correctly.
  return { csv: `﻿${lines.join("\r\n")}\r\n`, database, rows, people };
}

/**
 * The whole workspace as a ZIP: one Markdown file per page, a folder per page with subpages,
 * and for each database a CSV plus a folder with its rows as Markdown.
 */
export async function exportWorkspace(workspaceId: string) {
  const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const all = await db
    .select({
      id: pages.id,
      parentId: pages.parentId,
      type: pages.type,
      title: pages.title,
      icon: pages.icon,
      position: pages.position,
      yjsState: pages.yjsState,
    })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.deletedAt)));
  const children = new Map<string | null, typeof all>();
  for (const p of all) {
    const list = children.get(p.parentId) ?? [];
    list.push(p);
    children.set(p.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => (a.position < b.position ? -1 : 1));

  const files: Zippable = {};
  const root = fileName(ws?.name ?? "Calepin");

  const unique = (dir: string, name: string, ext: string, used: Set<string>) => {
    let candidate = `${name}${ext}`;
    for (let i = 2; used.has(`${dir}/${candidate}`.toLowerCase()); i++) candidate = `${name} (${i})${ext}`;
    used.add(`${dir}/${candidate}`.toLowerCase());
    return candidate;
  };
  const used = new Set<string>();

  const walk = async (parentId: string | null, dir: string) => {
    for (const page of children.get(parentId) ?? []) {
      if (page.type === "row") continue; // exported with their database
      const base = fileName(page.title);
      if (page.type === "database") {
        const name = unique(dir, base, ".csv", used);
        const { csv, database, rows, people } = await databaseToCsv(page.id);
        files[`${dir}/${name}`] = strToU8(csv);
        const rowDir = `${dir}/${name.replace(/\.csv$/, "")}`;
        const rowStates = new Map((children.get(page.id) ?? []).map((r) => [r.id, r.yjsState]));
        for (const row of rows) {
          const rowName = unique(rowDir, fileName(row.title), ".md", used);
          files[`${rowDir}/${rowName}`] = strToU8(
            await pageToMarkdown({
              title: row.title,
              icon: row.icon,
              yjsState: rowStates.get(row.id) ?? null,
              properties: database.properties,
              people,
              row,
            }),
          );
        }
        continue;
      }
      const name = unique(dir, base, ".md", used);
      files[`${dir}/${name}`] = strToU8(await pageToMarkdown(page));
      if ((children.get(page.id) ?? []).length) await walk(page.id, `${dir}/${name.replace(/\.md$/, "")}`);
    }
  };
  await walk(null, root);
  if (!Object.keys(files).length)
    files[`${root}/README.md`] = strToU8("# Calepin\n\nThis workspace has no pages yet.\n");
  return { zip: zipSync(files, { level: 6 }), name: root };
}
