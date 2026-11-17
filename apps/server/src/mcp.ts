import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "./db/index.js";
import {
  dbProperties,
  dbViews,
  pages,
  type PropertyType,
  type WebhookEvent,
  webhooks,
  workspaceMembers,
  workspaces,
} from "./db/schema.js";
import { env } from "./env.js";
import { resolveUser } from "./http.js";
import {
  createPage,
  editDocument,
  getPageMarkdown,
  movePage,
  setTitle,
  trashPage,
  writePageMarkdown,
} from "./lib/pages.js";
import {
  createDatabase,
  createRowWithValues,
  getDatabase,
  getRows,
  formatValue,
  options,
  peopleNames,
  personIds,
  PROPERTY_TYPES,
  type Property,
  updateRowValues,
  checkExpression,
  createProperty,
  nextViewPosition,
  TAG_COLORS,
} from "./lib/database.js";
import { appendBlocks } from "./lib/blocks.js";
import { sealSecret } from "./lib/secrets.js";
import { randomString } from "./lib/tokens.js";
import { resetWebhookCache, WEBHOOK_EVENTS } from "./lib/webhooks.js";
import { saveUpload } from "./routes/files.js";
import { emitDatabase } from "./lib/events.js";
import type { AppUser } from "./lib/tokens.js";
import { canEdit, getMembership, getPageAccess } from "./lib/workspaces.js";
import { searchPages } from "./routes/pages.js";
import { iconPrefix } from "./lib/icons.js";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const guessMime = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""];
/** Recognises common image formats from their first bytes. */
function sniffMime(d: Uint8Array) {
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return "image/png";
  if (d[0] === 0xff && d[1] === 0xd8) return "image/jpeg";
  if (d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46) return "image/gif";
  if (d[8] === 0x57 && d[9] === 0x45 && d[10] === 0x42 && d[11] === 0x50) return "image/webp";
  if (d[0] === 0x25 && d[1] === 0x50 && d[2] === 0x44 && d[3] === 0x46) return "application/pdf";
  return undefined;
}

const CALC_FNS = [
  "count_all",
  "count_values",
  "count_empty",
  "count_unique",
  "percent_empty",
  "percent_not_empty",
  "sum",
  "average",
  "median",
  "min",
  "max",
  "range",
  "earliest",
  "latest",
  "date_range",
  "checked",
  "unchecked",
  "percent_checked",
  "percent_unchecked",
] as const;

const pageUrl = (id: string) => `${env.PUBLIC_URL.replace(/\/$/, "")}/p/${id}`;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** Wraps a tool body so thrown errors become MCP tool errors instead of protocol errors. */
function guard<A>(fn: (args: A) => Promise<ToolResult>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}

async function defaultWorkspace(userId: string) {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  if (!row) throw new Error("You are not a member of any workspace.");
  return row.id;
}

async function requirePage(user: AppUser, pageId: string, edit = false) {
  const access = await getPageAccess(user.id, pageId);
  if (!access || access.deletedAt) throw new Error(`Page ${pageId} not found or not accessible.`);
  if (edit && !canEdit(access.role)) throw new Error("You only have view access to this page.");
  return access;
}

/** Builds an MCP server whose tools act as `user`, with the same permissions as in the app. */
function buildServer(user: AppUser) {
  const server = new McpServer(
    { name: "calepin", version: "0.4.0" },
    {
      instructions:
        "Calepin is the user's self-hosted notebook. Pages are organised in a tree inside workspaces. " +
        "Page content is read and written as Markdown (code blocks keep their language after ```; callouts are written as GitHub alerts: > [!NOTE], [!TIP], [!WARNING], [!CAUTION]). Databases are tables of row pages with typed properties: " +
        "read them with get_database, then use add_database_row / update_database_row; shape them with " +
        "add_database_property (including formulas, relations, rollups) and add_database_view (table, board, gallery, " +
        "calendar, timeline). create_database with embed: true shows the database inside its parent page. " +
        "upload_file adds images and files to a page. " +
        "Use search_pages to find pages before reading or editing them.",
    },
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: "Workspaces you belong to, with your role.",
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const rows = await db
        .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(eq(workspaceMembers.userId, user.id))
        .orderBy(asc(workspaces.createdAt));
      return ok(rows);
    }),
  );

  server.registerTool(
    "search_pages",
    {
      title: "Search pages",
      description: "Full-text search over page titles and content (accent-insensitive, prefix matching).",
      inputSchema: {
        query: z.string().min(1).describe("Words to search for"),
        workspace_id: z.string().uuid().optional().describe("Defaults to your first workspace"),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ query, workspace_id, limit }) => {
      const wid = workspace_id ?? (await defaultWorkspace(user.id));
      if (!(await getMembership(user.id, wid))) return fail("Workspace not found.");
      const hits = await searchPages(wid, query, limit ?? 10);
      return ok(
        hits.map((h) => ({
          id: h.id,
          title: h.title || "Untitled",
          parent_id: h.parentId,
          snippet: h.snippet.replace(/[\u0002\u0003]/g, ""),
          updated_at: h.updatedAt,
          url: pageUrl(h.id),
        })),
      );
    }),
  );

  server.registerTool(
    "list_pages",
    {
      title: "List pages",
      description:
        "The page tree of a workspace (id, title, type: page or database, parent_id), or only the children of one page. Database rows are listed by get_database.",
      inputSchema: {
        workspace_id: z.string().uuid().optional(),
        parent_id: z.string().uuid().optional().describe("Only list direct children of this page"),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ workspace_id, parent_id }) => {
      const wid = workspace_id ?? (await defaultWorkspace(user.id));
      if (!(await getMembership(user.id, wid))) return fail("Workspace not found.");
      const rows = await db
        .select({
          id: pages.id,
          title: pages.title,
          parentId: pages.parentId,
          position: pages.position,
          icon: pages.icon,
        })
        .from(pages)
        .where(
          and(
            eq(pages.workspaceId, wid),
            isNull(pages.deletedAt),
            parent_id ? eq(pages.parentId, parent_id) : undefined,
          ),
        );
      rows.sort((a, b) => (a.position < b.position ? -1 : 1));
      return ok(rows.map(({ position: _p, ...r }) => ({ ...r, title: r.title || "Untitled" })));
    }),
  );

  server.registerTool(
    "get_page",
    {
      title: "Read a page",
      description: "Title, metadata and full content of a page as Markdown.",
      inputSchema: { page_id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ page_id }) => {
      const access = await requirePage(user, page_id);
      const [page] = await db
        .select({
          title: pages.title,
          icon: pages.icon,
          parentId: pages.parentId,
          updatedAt: pages.updatedAt,
          type: pages.type,
        })
        .from(pages)
        .where(eq(pages.id, page_id));
      if (page?.type === "database") return ok(await describeDatabase(page_id, 100));
      let markdown = await getPageMarkdown(page_id);
      if (page?.type === "row" && page.parentId) {
        const database = await getDatabase(page.parentId);
        if (database) {
          const [row] = await getRows(database.page.id, database.properties, [page_id]);
          const people = await peopleNames(personIds(database.properties, row ? [row] : []));
          const lines = database.properties.map(
            (p) => `- **${p.name}**: ${formatValue(p, row?.props[p.id], people) || "—"}`,
          );
          markdown = `Row of database "${database.page.title}" (${database.page.id})\n\n${lines.join("\n")}\n\n---\n\n${markdown}`;
        }
      }
      const header = [
        `# ${iconPrefix(page?.icon)}${page?.title || "Untitled"}`,
        "",
        `- id: ${page_id}`,
        `- parent_id: ${page?.parentId ?? "none"}`,
        `- updated: ${page?.updatedAt.toISOString()}`,
        `- your access: ${access.role}`,
        `- url: ${pageUrl(page_id)}`,
        "",
        "---",
        "",
      ].join("\n");
      return ok(header + (markdown || "_(empty page)_"));
    }),
  );

  server.registerTool(
    "create_page",
    {
      title: "Create a page",
      description: "Creates a page, optionally under a parent page, with Markdown content.",
      inputSchema: {
        title: z.string().min(1).max(500),
        markdown: z.string().optional().describe("Page content in Markdown"),
        parent_id: z.string().uuid().optional().describe("Create as a subpage of this page"),
        workspace_id: z.string().uuid().optional().describe("Ignored when parent_id is given"),
        icon: z
          .string()
          .max(64)
          .optional()
          .describe(
            'An emoji, or a Lucide icon as "lucide:<PascalCaseName>" with an optional colour, e.g. "lucide:Rocket:blue" (gray, amber, green, blue, rose, violet, orange, teal)',
          ),
      },
    },
    guard(async ({ title, markdown, parent_id, workspace_id, icon }) => {
      let wid: string;
      if (parent_id) {
        wid = (await requirePage(user, parent_id, true)).workspaceId;
      } else {
        wid = workspace_id ?? (await defaultWorkspace(user.id));
        const member = await getMembership(user.id, wid);
        if (!member || !canEdit(member.role)) return fail("You cannot create pages in this workspace.");
      }
      const page = await createPage({ workspaceId: wid, parentId: parent_id ?? null, title, icon, userId: user.id });
      if (markdown?.trim()) await writePageMarkdown(page.id, user.id, markdown, "replace");
      return ok({ id: page.id, title, url: pageUrl(page.id) });
    }),
  );

  server.registerTool(
    "append_to_page",
    {
      title: "Append to a page",
      description: "Adds Markdown content at the end of a page, keeping what is already there.",
      inputSchema: { page_id: z.string().uuid(), markdown: z.string().min(1) },
    },
    guard(async ({ page_id, markdown }) => {
      await requirePage(user, page_id, true);
      await writePageMarkdown(page_id, user.id, markdown, "append", { agent: true });
      return ok({ id: page_id, url: pageUrl(page_id), appended: true });
    }),
  );

  server.registerTool(
    "replace_page_content",
    {
      title: "Replace page content",
      description:
        "Replaces the whole content of a page with Markdown. Read the page first; prefer append_to_page when adding. " +
        "The previous content is kept in the page's version history.",
      inputSchema: { page_id: z.string().uuid(), markdown: z.string() },
      annotations: { destructiveHint: true },
    },
    guard(async ({ page_id, markdown }) => {
      await requirePage(user, page_id, true);
      await writePageMarkdown(page_id, user.id, markdown, "replace", { agent: true });
      return ok({ id: page_id, url: pageUrl(page_id), replaced: true });
    }),
  );

  server.registerTool(
    "update_page",
    {
      title: "Rename or move a page",
      description: "Changes a page's title or icon, or moves it under another parent (null = top level).",
      inputSchema: {
        page_id: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        icon: z
          .string()
          .max(64)
          .nullable()
          .optional()
          .describe(
            'An emoji, or a Lucide icon as "lucide:<PascalCaseName>" with an optional colour, e.g. "lucide:Rocket:blue" (gray, amber, green, blue, rose, violet, orange, teal)',
          ),
        parent_id: z.string().uuid().nullable().optional().describe("New parent; null moves the page to the top level"),
      },
    },
    guard(async ({ page_id, title, icon, parent_id }) => {
      const access = await requirePage(user, page_id, true);
      if (title) await editDocument(page_id, user.id, (doc) => setTitle(doc, title), { agent: true });
      if (icon !== undefined) await db.update(pages).set({ icon }).where(eq(pages.id, page_id));
      if (parent_id !== undefined) {
        if (!access.isMember) return fail("Only workspace members can move pages.");
        if (parent_id) {
          const parent = await requirePage(user, parent_id, true);
          if (parent.workspaceId !== access.workspaceId) return fail("The new parent is in another workspace.");
        }
        await movePage(page_id, access.workspaceId, parent_id, undefined, user.id);
      }
      return ok({ id: page_id, url: pageUrl(page_id), updated: true });
    }),
  );

  server.registerTool(
    "delete_page",
    {
      title: "Move a page to the trash",
      description: "Moves a page and its subpages to the trash. They can be restored from the app.",
      inputSchema: { page_id: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    guard(async ({ page_id }) => {
      const access = await requirePage(user, page_id, true);
      if (!access.isMember) return fail("Only workspace members can delete pages.");
      const ids = await trashPage(page_id, access.workspaceId);
      return ok({ trashed: ids.length });
    }),
  );

  /* ----- Databases ----- */

  server.registerTool(
    "get_database",
    {
      title: "Read a database",
      description:
        "Schema (properties with types and options) and rows of a database as a Markdown table. " +
        "Use the property names or ids from here with add_database_row / update_database_row.",
      inputSchema: {
        database_id: z.string().uuid(),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum rows to return (default 100)"),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ database_id, limit }) => {
      await requirePage(user, database_id);
      return ok(await describeDatabase(database_id, limit ?? 100));
    }),
  );

  server.registerTool(
    "create_database",
    {
      title: "Create a database",
      description:
        "Creates a database (a table of pages with typed properties). Types: text, number, select, multi_select, " +
        "status, date, checkbox, url, email, phone, person, formula, created_time, last_edited_time. With parent_id and " +
        "embed: true, the database also appears inside the parent page (an inline database). Formulas take an " +
        'expression such as `prop("Price") * prop("Qty")` or `if(prop("Done"), "✓", "")`. Relations and rollups ' +
        "are added from the app.",
      inputSchema: {
        title: z.string().min(1).max(500),
        parent_id: z.string().uuid().optional(),
        embed: z.boolean().optional().describe("Show the database inside its parent page (needs parent_id)"),
        workspace_id: z.string().uuid().optional(),
        icon: z
          .string()
          .max(64)
          .optional()
          .describe(
            'An emoji, or a Lucide icon as "lucide:<PascalCaseName>" with an optional colour, e.g. "lucide:Rocket:blue" (gray, amber, green, blue, rose, violet, orange, teal)',
          ),
        properties: z
          .array(
            z.object({
              name: z.string().min(1).max(100),
              type: z.enum(
                PROPERTY_TYPES.filter((t) => t !== "relation" && t !== "rollup") as [PropertyType, ...PropertyType[]],
              ),
              options: z.array(z.string()).optional().describe("Option names for select / multi_select"),
              expression: z.string().max(5000).optional().describe("Formula expression (type formula)"),
            }),
          )
          .max(30)
          .optional(),
      },
    },
    guard(async ({ title, parent_id, workspace_id, icon, properties, embed }) => {
      if (embed && !parent_id) return fail("embed needs parent_id: the page to show the database in.");
      let wid: string;
      if (parent_id) wid = (await requirePage(user, parent_id, true)).workspaceId;
      else {
        wid = workspace_id ?? (await defaultWorkspace(user.id));
        const member = await getMembership(user.id, wid);
        if (!member || !canEdit(member.role)) return fail("You cannot create pages in this workspace.");
      }
      const colors = ["gray", "amber", "green", "blue", "rose"];
      const page = await createDatabase({
        workspaceId: wid,
        parentId: parent_id ?? null,
        title,
        icon,
        userId: user.id,
        viewName: "Table",
        properties: (properties ?? []).map((p) => ({
          name: p.name,
          type: p.type,
          config: p.expression
            ? { expression: p.expression }
            : p.options?.length
              ? {
                  options: p.options.map((name, i) => ({
                    id: Math.random().toString(36).slice(2, 10),
                    name,
                    color: colors[i % colors.length],
                  })),
                }
              : undefined,
        })),
      });
      if (embed && parent_id)
        await editDocument(
          parent_id,
          user.id,
          (doc) => appendBlocks(doc, [{ type: "database", props: { databaseId: page.id } }]),
          {
            agent: true,
          },
        );
      return ok({ id: page.id, title, url: pageUrl(page.id), embedded: !!embed });
    }),
  );

  const valuesSchema = z
    .record(z.string(), z.unknown())
    .describe(
      "Values keyed by property name or id. select/status: option name; multi_select: list of names; " +
        "date: YYYY-MM-DD; checkbox: true/false; person: user ids; relation: row ids of the related database. " +
        "Unknown option names are created.",
    );

  server.registerTool(
    "add_database_row",
    {
      title: "Add a row to a database",
      description: "Creates a row (a page) in a database with a title, property values and optional Markdown content.",
      inputSchema: {
        database_id: z.string().uuid(),
        title: z.string().max(500),
        values: valuesSchema.optional(),
        markdown: z.string().optional().describe("Content of the row's page"),
      },
    },
    guard(async ({ database_id, title, values, markdown }) => {
      const access = await requirePage(user, database_id, true);
      const database = await getDatabase(database_id);
      if (!database) return fail("Not a database.");
      const row = await createRowWithValues({
        database: database.page,
        properties: database.properties,
        title,
        values,
        userId: user.id,
      });
      if (markdown?.trim()) await writePageMarkdown(row.id, user.id, markdown, "replace");
      emitDatabase(access.workspaceId, database_id);
      return ok({ id: row.id, title, url: pageUrl(row.id) });
    }),
  );

  server.registerTool(
    "update_database_row",
    {
      title: "Update a database row",
      description: "Changes the title and/or property values of a row. Values you don't mention are kept.",
      inputSchema: {
        row_id: z.string().uuid(),
        title: z.string().max(500).optional(),
        values: valuesSchema.optional(),
      },
    },
    guard(async ({ row_id, title, values }) => {
      const access = await requirePage(user, row_id, true);
      const [row] = await db
        .select({ parentId: pages.parentId, type: pages.type })
        .from(pages)
        .where(eq(pages.id, row_id));
      if (row?.type !== "row" || !row.parentId) return fail("This page is not a database row.");
      const database = await getDatabase(row.parentId);
      if (!database) return fail("Database not found.");
      let touched = [database.page.id];
      if (values && Object.keys(values).length)
        touched = await updateRowValues(database.page.id, database.properties, row_id, values, user.id);
      if (title) {
        await db.update(pages).set({ title }).where(eq(pages.id, row_id));
        await editDocument(row_id, user.id, (doc) => setTitle(doc, title));
      }
      for (const id of touched) emitDatabase(access.workspaceId, id);
      return ok({ id: row_id, url: pageUrl(row_id), updated: true });
    }),
  );

  /* ----- Files ----- */

  server.registerTool(
    "upload_file",
    {
      title: "Upload an image or file to a page",
      description:
        "Stores an image or file in Calepin (on the server or its S3 bucket) and, by default, adds it at the end of " +
        "the page as an image / video / audio / file block. Give the bytes as base64 (`data_base64`) or a public " +
        "http(s) `url` Calepin will download. Returns the file's URL and a Markdown snippet (`![name](url)`) you can " +
        "place elsewhere with replace_page_content.",
      inputSchema: {
        page_id: z.string().uuid().describe("Page (or database row) the file belongs to"),
        file_name: z.string().min(1).max(200).optional().describe("Name with extension, e.g. diagram.png"),
        data_base64: z.string().optional().describe("File content, base64-encoded (a data: URL also works)"),
        url: z.string().url().optional().describe("Public http(s) URL to download the file from"),
        mime_type: z.string().max(100).optional().describe("e.g. image/png; guessed from the name or the download"),
        caption: z.string().max(500).optional().describe("Caption shown under an image"),
        insert: z
          .enum(["end", "none"])
          .optional()
          .describe('"end" (default) adds a block at the end of the page; "none" only uploads'),
      },
    },
    guard(async ({ page_id, file_name, data_base64, url, mime_type, caption, insert }) => {
      const access = await requirePage(user, page_id, true);
      if (!data_base64 === !url) return fail("Give either data_base64 or url.");
      const max = env.MAX_UPLOAD_MB * 1024 * 1024;
      let data: Uint8Array;
      let mime = mime_type ?? "";
      let name = file_name ?? "";
      if (data_base64) {
        const m = data_base64.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
        if (m && !mime) mime = m[1] ?? "";
        data = new Uint8Array(Buffer.from(m ? m[3]! : data_base64.replace(/\s/g, ""), "base64"));
      } else {
        if (!/^https?:\/\//i.test(url!)) return fail("Only http(s) URLs can be downloaded.");
        const res = await fetch(url!, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
        if (!res.ok || !res.body) return fail(`Download failed: HTTP ${res.status}`);
        if (Number(res.headers.get("content-length") ?? 0) > max)
          return fail(`Files are limited to ${env.MAX_UPLOAD_MB} MB.`);
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > max) return fail(`Files are limited to ${env.MAX_UPLOAD_MB} MB.`);
          chunks.push(chunk);
        }
        data = new Uint8Array(Buffer.concat(chunks));
        if (!mime) mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
        if (!name) name = decodeURIComponent(new URL(res.url || url!).pathname.split("/").pop() || "");
      }
      if (!data.length) return fail("The file is empty.");
      if (data.length > max) return fail(`Files are limited to ${env.MAX_UPLOAD_MB} MB.`);
      if (!mime || mime === "application/octet-stream")
        mime = guessMime(name) ?? sniffMime(data) ?? "application/octet-stream";
      if (!name) name = `file.${mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin"}`;
      else if (!/\.[a-z0-9]{1,6}$/i.test(name) && mime.includes("/"))
        name += `.${mime
          .split("/")[1]!
          .replace("jpeg", "jpg")
          .replace(/[^a-z0-9]/gi, "")}`;

      const file = await saveUpload({
        workspaceId: access.workspaceId,
        pageId: page_id,
        userId: user.id,
        name,
        mime,
        data,
      });
      const kind = mime.startsWith("image/")
        ? "image"
        : mime.startsWith("video/")
          ? "video"
          : mime.startsWith("audio/")
            ? "audio"
            : "file";
      if ((insert ?? "end") === "end") {
        await editDocument(
          page_id,
          user.id,
          (doc) =>
            appendBlocks(doc, [
              { type: kind, props: { url: file.url, name: file.name, ...(caption ? { caption } : {}) } },
            ]),
          { agent: true },
        );
      }
      return ok({
        id: file.id,
        name: file.name,
        mime: file.mime,
        size: file.size,
        url: file.url,
        absolute_url: `${env.PUBLIC_URL.replace(/\/$/, "")}${file.url}`,
        markdown: kind === "image" ? `![${file.name}](${file.url})` : `[${file.name}](${file.url})`,
        inserted: (insert ?? "end") === "end",
      });
    }),
  );

  /* ----- Database schema and views ----- */

  const resolveProperty = (properties: Property[], key: string) =>
    properties.find((p) => p.id === key) ?? properties.find((p) => p.name.toLowerCase() === key.toLowerCase());

  server.registerTool(
    "add_database_property",
    {
      title: "Add a property (column) to a database",
      description:
        "Adds a property. Types: text, number, select, multi_select, status, date, checkbox, url, email, phone, " +
        "person, created_time, last_edited_time, formula (needs `expression`), relation (needs " +
        "`related_database_id`), rollup (needs `relation_property` and `rollup_function`). Formula syntax: " +
        'prop("Name"), + - * / %, == != > <, and/or/not, if(c, a, b), concat, length, contains, round, min, max, ' +
        'sum, now(), today(), dateAdd(d, n, "days"), dateBetween(a, b, "days"), formatDate(d, "DD/MM/YYYY")…',
      inputSchema: {
        database_id: z.string().uuid(),
        name: z.string().min(1).max(100),
        type: z.enum(PROPERTY_TYPES as [PropertyType, ...PropertyType[]]),
        options: z
          .array(z.string().min(1).max(100))
          .optional()
          .describe("Option names for select / multi_select / status"),
        expression: z.string().max(5000).optional().describe("Formula expression"),
        number_format: z.enum(["number", "percent", "dollar"]).optional(),
        related_database_id: z.string().uuid().optional().describe("Relation: the database to link to"),
        two_way: z.boolean().optional().describe("Relation: also add the reverse property there (default true)"),
        relation_property: z.string().optional().describe("Rollup: name or id of a relation property of this database"),
        target_property: z
          .string()
          .optional()
          .describe('Rollup: property of the related database ("title" by default)'),
        rollup_function: z
          .enum([
            "count",
            "count_values",
            "count_unique",
            "sum",
            "average",
            "min",
            "max",
            "show_original",
            "percent_checked",
            "earliest",
            "latest",
          ])
          .optional(),
      },
    },
    guard(async (a) => {
      const access = await requirePage(user, a.database_id, true);
      const database = await getDatabase(a.database_id);
      if (!database) return fail("Not a database.");
      const config: Record<string, unknown> = {};
      if (a.options?.length)
        config.options = a.options.map((name, i) => ({
          id: Math.random().toString(36).slice(2, 10),
          name,
          color: TAG_COLORS[i % TAG_COLORS.length],
        }));
      if (a.type === "formula") {
        if (!a.expression) return fail("A formula needs an expression.");
        config.expression = a.expression;
      }
      if (a.number_format) config.format = a.number_format;
      if (a.type === "relation") {
        if (!a.related_database_id) return fail("A relation needs related_database_id.");
        await requirePage(user, a.related_database_id, true);
        config.databaseId = a.related_database_id;
        config.twoWay = a.two_way ?? true;
      }
      if (a.type === "rollup") {
        const rel = resolveProperty(database.properties, a.relation_property ?? "");
        if (!rel || rel.type !== "relation")
          return fail("relation_property must name a relation property of this database.");
        let target = "title";
        if (a.target_property && a.target_property.toLowerCase() !== "title") {
          const other = await getDatabase(rel.config.databaseId as string);
          const t = other && resolveProperty(other.properties, a.target_property);
          if (!t) return fail(`No property "${a.target_property}" in the related database.`);
          target = t.id;
        }
        Object.assign(config, {
          relationPropertyId: rel.id,
          targetPropertyId: target,
          fn: a.rollup_function ?? "count",
        });
      }
      const prop = await createProperty(database.page.id, { name: a.name, type: a.type, config }, database.page.title);
      emitDatabase(access.workspaceId, database.page.id);
      if (prop.type === "relation" && prop.config.pairedPropertyId)
        emitDatabase(access.workspaceId, prop.config.databaseId as string);
      return ok({ id: prop.id, name: prop.name, type: prop.type });
    }),
  );

  server.registerTool(
    "update_database_property",
    {
      title: "Change a database property",
      description:
        "Renames a property, changes a formula's expression, or adds options to a select / multi_select / status.",
      inputSchema: {
        database_id: z.string().uuid(),
        property: z.string().describe("Property name or id"),
        new_name: z.string().min(1).max(100).optional(),
        expression: z.string().max(5000).optional().describe("New formula expression"),
        add_options: z.array(z.string().min(1).max(100)).optional(),
      },
    },
    guard(async ({ database_id, property, new_name, expression, add_options }) => {
      const access = await requirePage(user, database_id, true);
      const database = await getDatabase(database_id);
      if (!database) return fail("Not a database.");
      const prop = resolveProperty(database.properties, property);
      if (!prop) return fail(`No property "${property}".`);
      const patch: Partial<Property> = {};
      if (new_name) patch.name = new_name;
      if (expression !== undefined) {
        if (prop.type !== "formula") return fail(`"${prop.name}" is not a formula.`);
        checkExpression(expression);
        patch.config = { ...prop.config, expression };
      }
      if (add_options?.length) {
        const current = options(prop);
        const fresh = add_options
          .filter((n) => !current.some((o) => o.name.toLowerCase() === n.toLowerCase()))
          .map((name, i) => ({
            id: Math.random().toString(36).slice(2, 10),
            name,
            color: TAG_COLORS[(current.length + i) % TAG_COLORS.length]!,
          }));
        patch.config = { ...(patch.config ?? prop.config), options: [...current, ...fresh] };
      }
      if (!Object.keys(patch).length) return fail("Nothing to change.");
      await db.update(dbProperties).set(patch).where(eq(dbProperties.id, prop.id));
      emitDatabase(access.workspaceId, database_id);
      return ok({ id: prop.id, updated: true });
    }),
  );

  server.registerTool(
    "add_database_view",
    {
      title: "Add a view to a database",
      description:
        "Adds a view: table, board (Kanban, grouped by a select/status property), gallery (cards with the first " +
        "image of each row), calendar or timeline (placed by a date property, optionally spanning to an end date).",
      inputSchema: {
        database_id: z.string().uuid(),
        name: z.string().min(1).max(100),
        type: z.enum(["table", "board", "gallery", "calendar", "timeline"]),
        group_by: z.string().optional().describe("Board: select/status property name or id"),
        date_property: z.string().optional().describe("Calendar/timeline: date property name or id"),
        end_date_property: z.string().optional().describe("Calendar/timeline: end date property"),
        sort_by: z.string().optional().describe("Property name or id to sort by"),
        sort_direction: z.enum(["asc", "desc"]).optional(),
        hidden_properties: z.array(z.string()).optional().describe("Property names or ids to hide"),
        totals: z
          .record(z.string(), z.enum(CALC_FNS))
          .optional()
          .describe(
            'Table: calculation under each column, keyed by property name/id or "title" — e.g. {"Prix": "sum", ' +
              '"title": "count_all"}. Counts work on any column; sum/average/median/min/max/range on numbers; ' +
              "earliest/latest/date_range on dates; checked/unchecked/percent_checked on checkboxes.",
          ),
      },
    },
    guard(async (a) => {
      const access = await requirePage(user, a.database_id, true);
      const database = await getDatabase(a.database_id);
      if (!database) return fail("Not a database.");
      const pick = (key: string | undefined, types: PropertyType[], label: string) => {
        if (!key) return undefined;
        const p = resolveProperty(database.properties, key);
        if (!p || !types.includes(p.type)) throw new Error(`${label} must be a ${types.join(" / ")} property.`);
        return p.id;
      };
      const config: Record<string, unknown> = {};
      if (a.type === "board")
        config.groupBy =
          pick(a.group_by, ["select", "status"], "group_by") ??
          database.properties.find((p) => p.type === "status" || p.type === "select")?.id ??
          null;
      const dateTypes: PropertyType[] = ["date", "created_time", "last_edited_time"];
      if (a.type === "calendar" || a.type === "timeline") {
        config.dateProperty =
          pick(a.date_property, dateTypes, "date_property") ??
          database.properties.find((p) => p.type === "date")?.id ??
          null;
        if (!config.dateProperty) return fail("This database has no date property: add one first.");
        config.endDateProperty = pick(a.end_date_property, dateTypes, "end_date_property") ?? null;
      }
      if (a.sort_by) {
        const sid = a.sort_by.toLowerCase() === "title" ? "title" : resolveProperty(database.properties, a.sort_by)?.id;
        if (!sid) return fail(`No property "${a.sort_by}".`);
        config.sorts = [{ propertyId: sid, dir: a.sort_direction ?? "asc" }];
      }
      if (a.totals) {
        const calcs: Record<string, string> = {};
        for (const [key, fn] of Object.entries(a.totals)) {
          const id = key.toLowerCase() === "title" ? "title" : resolveProperty(database.properties, key)?.id;
          if (!id) return fail(`No property "${key}".`);
          calcs[id] = fn;
        }
        config.calculations = calcs;
      }
      if (a.hidden_properties?.length)
        config.hidden = a.hidden_properties.map((h) => resolveProperty(database.properties, h)?.id).filter(Boolean);
      const [view] = await db
        .insert(dbViews)
        .values({
          databaseId: database.page.id,
          name: a.name,
          type: a.type,
          config,
          position: await nextViewPosition(database.page.id),
        })
        .returning();
      emitDatabase(access.workspaceId, database.page.id);
      return ok({ id: view!.id, name: view!.name, type: view!.type, url: pageUrl(database.page.id) });
    }),
  );

  /* ----- Webhooks ----- */

  const requireOwner = async (workspaceId: string) => {
    const m = await getMembership(user.id, workspaceId);
    if (m?.role !== "owner") throw new Error("Only workspace owners manage webhooks.");
  };

  server.registerTool(
    "list_webhooks",
    {
      title: "List webhooks",
      description: "Webhooks of a workspace (owners only), with their last delivery status.",
      inputSchema: { workspace_id: z.string().uuid().optional() },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ workspace_id }) => {
      const wid = workspace_id ?? (await defaultWorkspace(user.id));
      await requireOwner(wid);
      const rows = await db
        .select({
          id: webhooks.id,
          name: webhooks.name,
          url: webhooks.url,
          events: webhooks.events,
          scopePageId: webhooks.scopePageId,
          enabled: webhooks.enabled,
          lastStatus: webhooks.lastStatus,
          lastError: webhooks.lastError,
          lastDeliveryAt: webhooks.lastDeliveryAt,
        })
        .from(webhooks)
        .where(eq(webhooks.workspaceId, wid));
      return ok(rows);
    }),
  );

  server.registerTool(
    "create_webhook",
    {
      title: "Create a webhook",
      description:
        "Calepin will POST signed JSON to the URL when pages or rows change (owners only). Events: page.created, " +
        "page.updated, page.deleted, row.created, row.updated, row.deleted (none = all). Optionally scoped to a " +
        "page subtree or a database. Returns the signing secret once (header X-Calepin-Signature: sha256=HMAC of the body).",
      inputSchema: {
        url: z.string().url(),
        workspace_id: z.string().uuid().optional(),
        name: z.string().max(100).optional(),
        events: z.array(z.enum(WEBHOOK_EVENTS as [WebhookEvent, ...WebhookEvent[]])).optional(),
        scope_page_id: z.string().uuid().optional().describe("Only this page, its subpages, or this database's rows"),
      },
    },
    guard(async ({ url, workspace_id, name, events, scope_page_id }) => {
      if (!/^https?:\/\//i.test(url)) return fail("Use an http(s) URL.");
      const wid =
        workspace_id ??
        (scope_page_id ? (await requirePage(user, scope_page_id)).workspaceId : await defaultWorkspace(user.id));
      await requireOwner(wid);
      if (scope_page_id && (await requirePage(user, scope_page_id)).workspaceId !== wid)
        return fail("scope_page_id is in another workspace.");
      const secret = `whsec_${randomString(32)}`;
      const [hook] = await db
        .insert(webhooks)
        .values({
          workspaceId: wid,
          name: name ?? "",
          url,
          events: events ?? [],
          scopePageId: scope_page_id ?? null,
          secret: sealSecret(secret),
          createdBy: user.id,
        })
        .returning({ id: webhooks.id });
      resetWebhookCache();
      return ok({ id: hook!.id, secret, note: "Store the secret now: it is not shown again." });
    }),
  );

  server.registerTool(
    "delete_webhook",
    {
      title: "Delete a webhook",
      description: "Removes a webhook (owners only).",
      inputSchema: { webhook_id: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    guard(async ({ webhook_id }) => {
      const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, webhook_id));
      if (!hook) return fail("Webhook not found.");
      await requireOwner(hook.workspaceId);
      await db.delete(webhooks).where(eq(webhooks.id, webhook_id));
      resetWebhookCache();
      return ok({ deleted: true });
    }),
  );

  return server;
}

/* ---------- Formatting databases for agents ---------- */

async function describeDatabase(databaseId: string, limit: number) {
  const database = await getDatabase(databaseId);
  if (!database) throw new Error("Not a database.");
  const rows = (await getRows(databaseId, database.properties)).slice(0, limit);
  const people = await peopleNames(personIds(database.properties, rows));
  const schema = database.properties.map((p) => {
    const extra =
      p.type === "select" || p.type === "multi_select" || p.type === "status"
        ? ` — options: ${
            options(p)
              .map((o) => o.name)
              .join(", ") || "none yet"
          }`
        : p.type === "relation"
          ? ` — rows of database ${p.config.databaseId}`
          : p.type === "rollup"
            ? ` — ${p.config.fn} (read-only)`
            : p.type === "formula"
              ? ` — \`${p.config.expression}\` (read-only)`
              : "";
    return `- **${p.name}** (\`${p.id}\`): ${p.type}${extra}`;
  });
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const header = ["Title", ...database.properties.map((p) => p.name), "id"];
  const table = [
    `| ${header.map(esc).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map(
      (r) =>
        `| ${[r.title || "Untitled", ...database.properties.map((p) => formatValue(p, r.props[p.id], people)), r.id].map(esc).join(" | ")} |`,
    ),
  ];
  return [
    `# ${iconPrefix(database.page.icon)}${database.page.title || "Untitled"} (database)`,
    "",
    `- id: ${databaseId}`,
    `- url: ${pageUrl(databaseId)}`,
    `- rows: ${rows.length}`,
    "",
    "## Properties",
    "- **Title** (`title`): the row's page title",
    ...schema,
    "",
    "## Views",
    ...database.views.map((v) => {
      const cfg = v.config as Record<string, unknown>;
      const name = (id: unknown) => database.properties.find((p) => p.id === id)?.name;
      const extra =
        v.type === "board" && cfg.groupBy
          ? ` grouped by ${name(cfg.groupBy)}`
          : (v.type === "calendar" || v.type === "timeline") && cfg.dateProperty
            ? ` by ${name(cfg.dateProperty)}${cfg.endDateProperty ? ` → ${name(cfg.endDateProperty)}` : ""}`
            : "";
      const totals = Object.entries((cfg.calculations as Record<string, string | null> | undefined) ?? {})
        .filter(([, fn]) => fn)
        .map(([id, fn]) => `${id === "title" ? "Title" : name(id)}: ${fn}`);
      return `- ${v.name} (${v.type}${extra})${totals.length ? ` — totals: ${totals.join(", ")}` : ""}`;
    }),
    "",
    "## Rows",
    rows.length ? table.join("\n") : "_(no rows yet)_",
  ].join("\n");
}

/**
 * Streamable HTTP MCP endpoint (stateless). Authenticate with a personal access token:
 * `Authorization: Bearer cp_…` (created in Settings → API tokens).
 */
export const mcpRoutes = new Hono().all("/mcp", async (c) => {
  const resolved = await resolveUser(c.req.raw.headers);
  if (!resolved) {
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: use Authorization: Bearer <Calepin API token>" },
        id: null,
      },
      401,
    );
  }
  if (c.req.method !== "POST") {
    // Stateless server: no standalone SSE stream or session to delete.
    return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, 405);
  }
  const server = buildServer(resolved.user);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(c.req.raw);
  // The response body is fully buffered in JSON mode; release the per-request server.
  void server.close();
  return response;
});
