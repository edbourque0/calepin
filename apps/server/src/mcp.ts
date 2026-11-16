import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "./db/index.js";
import { pages, type PropertyType, workspaceMembers, workspaces } from "./db/schema.js";
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
  type LinkedRow,
  options,
  peopleNames,
  PROPERTY_TYPES,
  type Property,
  updateRowValues,
} from "./lib/database.js";
import { emitDatabase } from "./lib/events.js";
import type { AppUser } from "./lib/tokens.js";
import { canEdit, getMembership, getPageAccess } from "./lib/workspaces.js";
import { searchPages } from "./routes/pages.js";

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
    { name: "calepin", version: "0.3.0" },
    {
      instructions:
        "Calepin is the user's self-hosted notebook. Pages are organised in a tree inside workspaces. " +
        "Page content is read and written as Markdown. Databases are tables of row pages with typed properties: " +
        "read them with get_database, then use add_database_row / update_database_row. " +
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
        `# ${page?.icon ? `${page.icon} ` : ""}${page?.title || "Untitled"}`,
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
        icon: z.string().max(16).optional().describe("A single emoji"),
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
      await writePageMarkdown(page_id, user.id, markdown, "append");
      return ok({ id: page_id, url: pageUrl(page_id), appended: true });
    }),
  );

  server.registerTool(
    "replace_page_content",
    {
      title: "Replace page content",
      description:
        "Replaces the whole content of a page with Markdown. Read the page first; prefer append_to_page when adding.",
      inputSchema: { page_id: z.string().uuid(), markdown: z.string() },
      annotations: { destructiveHint: true },
    },
    guard(async ({ page_id, markdown }) => {
      await requirePage(user, page_id, true);
      await writePageMarkdown(page_id, user.id, markdown, "replace");
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
        icon: z.string().max(16).nullable().optional(),
        parent_id: z.string().uuid().nullable().optional().describe("New parent; null moves the page to the top level"),
      },
    },
    guard(async ({ page_id, title, icon, parent_id }) => {
      const access = await requirePage(user, page_id, true);
      if (title) await editDocument(page_id, user.id, (doc) => setTitle(doc, title));
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
        "status, date, checkbox, url, email, phone, person, created_time, last_edited_time. Relations and rollups " +
        "are added from the app.",
      inputSchema: {
        title: z.string().min(1).max(500),
        parent_id: z.string().uuid().optional(),
        workspace_id: z.string().uuid().optional(),
        icon: z.string().max(16).optional(),
        properties: z
          .array(
            z.object({
              name: z.string().min(1).max(100),
              type: z.enum(
                PROPERTY_TYPES.filter((t) => t !== "relation" && t !== "rollup") as [PropertyType, ...PropertyType[]],
              ),
              options: z.array(z.string()).optional().describe("Option names for select / multi_select"),
            }),
          )
          .max(30)
          .optional(),
      },
    },
    guard(async ({ title, parent_id, workspace_id, icon, properties }) => {
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
          config: p.options?.length
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
      return ok({ id: page.id, title, url: pageUrl(page.id) });
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

  return server;
}

/* ---------- Formatting databases for agents ---------- */

function personIds(properties: Property[], rows: { props: Record<string, unknown> }[]) {
  const ids = new Set<string>();
  for (const p of properties)
    if (p.type === "person")
      for (const r of rows) for (const id of (r.props[p.id] as string[] | null) ?? []) ids.add(id);
  return [...ids];
}

function formatValue(prop: Property, value: unknown, people: Map<string, string>): string {
  if (value === null || value === undefined) return "";
  const opts = options(prop);
  switch (prop.type) {
    case "select":
    case "status":
      return opts.find((o) => o.id === value)?.name ?? "";
    case "multi_select":
      return (value as string[]).map((id) => opts.find((o) => o.id === id)?.name ?? id).join(", ");
    case "checkbox":
      return value ? "✓" : "";
    case "person":
      return (value as string[]).map((id) => people.get(id) ?? id).join(", ");
    case "relation":
      return (value as LinkedRow[]).map((r) => `${r.title || "Untitled"} (${r.id})`).join(", ");
    case "rollup":
      return Array.isArray(value)
        ? value.join(", ")
        : typeof value === "number"
          ? String(Math.round(value * 100) / 100)
          : String(value);
    default:
      return String(value);
  }
}

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
    `# ${database.page.icon ? `${database.page.icon} ` : ""}${database.page.title || "Untitled"} (database)`,
    "",
    `- id: ${databaseId}`,
    `- url: ${pageUrl(databaseId)}`,
    `- rows: ${rows.length}`,
    "",
    "## Properties",
    "- **Title** (`title`): the row's page title",
    ...schema,
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
