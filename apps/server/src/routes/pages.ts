import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import { pages } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { emitWorkspace } from "../lib/events.js";
import { createPage, movePage, pageSummary, trashPage } from "../lib/pages.js";
import { positionAt, subtreeIds } from "../lib/tree.js";
import { canEdit, getMembership, getPageAccess } from "../lib/workspaces.js";

const uuid = z.string().uuid();

const createSchema = z.object({
  parentId: uuid.nullable().optional(),
  title: z.string().max(500).optional(),
  icon: z.string().max(64).nullable().optional(),
});

const updateSchema = z.object({
  icon: z.string().max(64).nullable().optional(),
  /** Move the page: new parent (null = root) and index among its new siblings. */
  move: z.object({ parentId: uuid.nullable(), index: z.number().int().min(0) }).optional(),
});

/** Full-text query string for the "calepin" config (unaccented, prefix matches). */
export function toTsQuery(q: string) {
  const terms = q.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  return terms.length ? terms.map((t) => `${t.toLowerCase()}:*`).join(" & ") : null;
}

export type SearchHit = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  updatedAt: string;
  snippet: string;
};

export async function searchPages(workspaceId: string, q: string, limit = 20) {
  const tsquery = toTsQuery(q);
  if (!tsquery) return [];
  return db.execute<SearchHit>(sql`
    SELECT id, parent_id AS "parentId", title, icon, updated_at AS "updatedAt",
      ts_headline('calepin', content_text, to_tsquery('calepin', ${tsquery}),
        'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', MaxWords=18, MinWords=6, MaxFragments=1') AS snippet
    FROM pages
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
      AND (search @@ to_tsquery('calepin', ${tsquery}) OR unaccent(title) ILIKE unaccent(${"%" + q + "%"}))
    ORDER BY ts_rank(search, to_tsquery('calepin', ${tsquery})) DESC, updated_at DESC
    LIMIT ${limit}
  `);
}

export const pageRoutes = new Hono<AppEnv>()
  /* ----- Workspace-scoped (members) ----- */
  .get("/workspaces/:wid/pages", async (c) => {
    const wid = c.req.param("wid");
    if (!(await getMembership(c.var.user.id, wid))) return c.json({ error: "Not found" }, 404);
    const rows = await db
      .select(pageSummary)
      .from(pages)
      .where(and(eq(pages.workspaceId, wid), isNull(pages.deletedAt)));
    return c.json(rows);
  })

  .post("/workspaces/:wid/pages", async (c) => {
    const wid = c.req.param("wid");
    const body = createSchema.parse(await c.req.json().catch(() => ({})));
    const parentId = body.parentId ?? null;
    if (parentId) {
      // Members, and guests with edit access to the parent, can add subpages.
      const parent = await getPageAccess(c.var.user.id, parentId);
      if (!parent || parent.workspaceId !== wid || parent.deletedAt) return c.json({ error: "Invalid parent" }, 400);
      if (!canEdit(parent.role)) return c.json({ error: "Forbidden" }, 403);
    } else {
      const member = await getMembership(c.var.user.id, wid);
      if (!member) return c.json({ error: "Not found" }, 404);
      if (!canEdit(member.role)) return c.json({ error: "Forbidden" }, 403);
    }
    const page = await createPage({
      workspaceId: wid,
      parentId,
      title: body.title,
      icon: body.icon,
      userId: c.var.user.id,
    });
    return c.json(page, 201);
  })

  .get("/workspaces/:wid/trash", async (c) => {
    const wid = c.req.param("wid");
    if (!(await getMembership(c.var.user.id, wid))) return c.json({ error: "Not found" }, 404);
    // Only the roots of deleted subtrees.
    const rows = await db.execute(sql`
      SELECT p.id, p.title, p.icon, p.deleted_at AS "deletedAt", p.parent_id AS "parentId"
      FROM pages p
      LEFT JOIN pages parent ON parent.id = p.parent_id
      WHERE p.workspace_id = ${wid}
        AND p.deleted_at IS NOT NULL
        AND (parent.id IS NULL OR parent.deleted_at IS NULL OR parent.deleted_at <> p.deleted_at)
      ORDER BY p.deleted_at DESC
      LIMIT 200
    `);
    return c.json(rows);
  })

  .get("/workspaces/:wid/search", async (c) => {
    const wid = c.req.param("wid");
    if (!(await getMembership(c.var.user.id, wid))) return c.json({ error: "Not found" }, 404);
    const q = (c.req.query("q") ?? "").trim();
    if (!q) {
      const recent = await db
        .select(pageSummary)
        .from(pages)
        .where(and(eq(pages.workspaceId, wid), isNull(pages.deletedAt)))
        .orderBy(desc(pages.updatedAt))
        .limit(8);
      return c.json(recent.map((p) => ({ ...p, snippet: "" })));
    }
    return c.json(await searchPages(wid, q));
  })

  /* ----- Pages shared with me (guest access) ----- */
  .get("/shared", async (c) => {
    const userId = c.var.user.id;
    // Shared roots in workspaces I'm not a member of, plus all their live descendants.
    const rows = await db.execute(sql`
      WITH RECURSIVE roots AS (
        SELECT s.page_id AS id, s.role FROM page_shares s
        JOIN pages p ON p.id = s.page_id
        WHERE s.user_id = ${userId} AND p.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = p.workspace_id AND m.user_id = ${userId})
      ),
      tree AS (
        SELECT p.id, true AS is_root, r.role FROM pages p JOIN roots r ON r.id = p.id
        UNION ALL
        SELECT p.id, false, t.role FROM pages p JOIN tree t ON p.parent_id = t.id WHERE p.deleted_at IS NULL
      )
      SELECT DISTINCT ON (p.id) p.id, p.workspace_id AS "workspaceId",
        CASE WHEN t.is_root THEN NULL ELSE p.parent_id END AS "parentId",
        p.position, p.type, p.title, p.icon, p.public_slug AS "publicSlug",
        p.updated_at AS "updatedAt", p.created_at AS "createdAt", t.role
      FROM tree t JOIN pages p ON p.id = t.id
      ORDER BY p.id, t.is_root DESC, (t.role = 'editor') DESC
    `);
    return c.json(rows);
  })

  /* ----- Page-scoped ----- */
  .get("/pages/:id", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    const [page] = await db.select(pageSummary).from(pages).where(eq(pages.id, id));
    // Ancestors the user can reach (for breadcrumbs).
    const ancestors = await db.execute<{ id: string; title: string; icon: string | null }>(sql`
      WITH RECURSIVE anc AS (
        SELECT parent_id AS id, 1 AS depth FROM pages WHERE id = ${id}
        UNION ALL
        SELECT p.parent_id, a.depth + 1 FROM pages p JOIN anc a ON p.id = a.id WHERE p.parent_id IS NOT NULL
      )
      SELECT p.id, p.title, p.icon FROM anc JOIN pages p ON p.id = anc.id ORDER BY anc.depth DESC
    `);
    const visible = [];
    for (const a of ancestors) if (await getPageAccess(c.var.user.id, a.id)) visible.push(a);
    return c.json({ ...page, role: access.role, isMember: access.isMember, ancestors: visible });
  })

  .patch("/pages/:id", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role)) return c.json({ error: "Forbidden" }, 403);
    const body = updateSchema.parse(await c.req.json());

    if (body.move) {
      if (!access.isMember) return c.json({ error: "Only workspace members can move pages" }, 403);
      const { parentId, index } = body.move;
      if (parentId) {
        const subtree = await subtreeIds(id);
        if (subtree.includes(parentId)) return c.json({ error: "Cannot move a page inside itself" }, 400);
        const parent = await getPageAccess(c.var.user.id, parentId);
        if (!parent || parent.workspaceId !== access.workspaceId || parent.deletedAt)
          return c.json({ error: "Invalid parent" }, 400);
      }
      await movePage(id, access.workspaceId, parentId, index, c.var.user.id);
    }
    if (body.icon !== undefined) {
      await db.update(pages).set({ icon: body.icon, updatedAt: new Date() }).where(eq(pages.id, id));
      emitWorkspace(access.workspaceId);
    }
    const [page] = await db.select(pageSummary).from(pages).where(eq(pages.id, id));
    return c.json(page);
  })

  .delete("/pages/:id", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role) || !access.isMember) return c.json({ error: "Forbidden" }, 403);
    const ids = await trashPage(id, access.workspaceId);
    return c.json({ ok: true, ids });
  })

  .post("/pages/:id/restore", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || !access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role) || !access.isMember) return c.json({ error: "Forbidden" }, 403);
    const [page] = await db.select().from(pages).where(eq(pages.id, id));
    const ids = await subtreeIds(id);
    // Restore everything that was deleted together with this page.
    await db
      .update(pages)
      .set({ deletedAt: null })
      .where(and(inArray(pages.id, ids), eq(pages.deletedAt, page!.deletedAt!)));
    // If the original parent is still in the trash, bring the page back at the root.
    if (page!.parentId) {
      const [parent] = await db.select({ deletedAt: pages.deletedAt }).from(pages).where(eq(pages.id, page!.parentId));
      if (!parent || parent.deletedAt) {
        await db
          .update(pages)
          .set({ parentId: null, position: await positionAt(access.workspaceId, null, undefined, id) })
          .where(eq(pages.id, id));
      }
    }
    emitWorkspace(access.workspaceId);
    return c.json({ ok: true });
  })

  .delete("/pages/:id/permanent", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || !access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role) || !access.isMember) return c.json({ error: "Forbidden" }, 403);
    await db.delete(pages).where(and(eq(pages.id, id), isNotNull(pages.deletedAt)));
    return c.json({ ok: true });
  });
