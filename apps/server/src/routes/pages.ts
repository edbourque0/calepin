import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { hocuspocus } from "../collab.js";
import { db } from "../db/index.js";
import { pages } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { positionAt, subtreeIds } from "../lib/tree.js";
import { canEdit, getMembership, getPageAccess } from "../lib/workspaces.js";

const pageSummary = {
  id: pages.id,
  parentId: pages.parentId,
  position: pages.position,
  type: pages.type,
  title: pages.title,
  icon: pages.icon,
  updatedAt: pages.updatedAt,
  createdAt: pages.createdAt,
};

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

export const pageRoutes = new Hono<AppEnv>()
  /* ----- Workspace-scoped ----- */
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
    const member = await getMembership(c.var.user.id, wid);
    if (!member) return c.json({ error: "Not found" }, 404);
    if (!canEdit(member.role)) return c.json({ error: "Forbidden" }, 403);
    const body = createSchema.parse(await c.req.json().catch(() => ({})));
    const parentId = body.parentId ?? null;
    if (parentId) {
      const parent = await getPageAccess(c.var.user.id, parentId);
      if (!parent || parent.workspaceId !== wid || parent.deletedAt) return c.json({ error: "Invalid parent" }, 400);
    }
    const [page] = await db
      .insert(pages)
      .values({
        workspaceId: wid,
        parentId,
        position: await positionAt(wid, parentId),
        title: body.title?.trim() ?? "",
        icon: body.icon ?? null,
        createdBy: c.var.user.id,
        updatedBy: c.var.user.id,
      })
      .returning(pageSummary);
    return c.json(page, 201);
  })

  .get("/workspaces/:wid/trash", async (c) => {
    const wid = c.req.param("wid");
    if (!(await getMembership(c.var.user.id, wid))) return c.json({ error: "Not found" }, 404);
    // Only the roots of deleted subtrees: pages whose parent is alive or that were deleted separately.
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
    const terms = q.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
    if (terms.length === 0) return c.json([]);
    const tsquery = terms.map((t) => `${t.toLowerCase()}:*`).join(" & ");
    const rows = await db.execute(sql`
      SELECT id, parent_id AS "parentId", title, icon, updated_at AS "updatedAt",
        ts_headline('simple', content_text, to_tsquery('simple', ${tsquery}),
          'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', MaxWords=18, MinWords=6, MaxFragments=1') AS snippet
      FROM pages
      WHERE workspace_id = ${wid} AND deleted_at IS NULL
        AND (search @@ to_tsquery('simple', ${tsquery}) OR title ILIKE ${"%" + q + "%"})
      ORDER BY ts_rank(search, to_tsquery('simple', ${tsquery})) DESC, updated_at DESC
      LIMIT 20
    `);
    return c.json(rows);
  })

  /* ----- Page-scoped ----- */
  .patch("/pages/:id", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role)) return c.json({ error: "Forbidden" }, 403);
    const body = updateSchema.parse(await c.req.json());
    const patch: Partial<typeof pages.$inferInsert> = { updatedAt: new Date(), updatedBy: c.var.user.id };

    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.move) {
      const { parentId, index } = body.move;
      if (parentId) {
        const subtree = await subtreeIds(id);
        if (subtree.includes(parentId)) return c.json({ error: "Cannot move a page inside itself" }, 400);
        const parent = await getPageAccess(c.var.user.id, parentId);
        if (!parent || parent.workspaceId !== access.workspaceId || parent.deletedAt)
          return c.json({ error: "Invalid parent" }, 400);
      }
      patch.parentId = parentId;
      patch.position = await positionAt(access.workspaceId, parentId, index, id);
    }

    const [page] = await db.update(pages).set(patch).where(eq(pages.id, id)).returning(pageSummary);
    return c.json(page);
  })

  .delete("/pages/:id", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role)) return c.json({ error: "Forbidden" }, 403);
    const ids = await subtreeIds(id);
    await db
      .update(pages)
      .set({ deletedAt: new Date() })
      .where(and(inArray(pages.id, ids), isNull(pages.deletedAt)));
    for (const pageId of ids) hocuspocus.closeConnections(pageId);
    return c.json({ ok: true, ids });
  })

  .post("/pages/:id/restore", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || !access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role)) return c.json({ error: "Forbidden" }, 403);
    const [page] = await db.select().from(pages).where(eq(pages.id, id));
    const ids = await subtreeIds(id);
    // Restore everything that was deleted together with this page.
    await db
      .update(pages)
      .set({ deletedAt: null })
      .where(and(inArray(pages.id, ids), eq(pages.deletedAt, page.deletedAt!)));
    // If the original parent is still in the trash, bring the page back at the root.
    if (page.parentId) {
      const [parent] = await db.select({ deletedAt: pages.deletedAt }).from(pages).where(eq(pages.id, page.parentId));
      if (!parent || parent.deletedAt) {
        await db
          .update(pages)
          .set({ parentId: null, position: await positionAt(access.workspaceId, null, undefined, id) })
          .where(eq(pages.id, id));
      }
    }
    return c.json({ ok: true });
  })

  .delete("/pages/:id/permanent", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || !access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role)) return c.json({ error: "Forbidden" }, 403);
    await db.delete(pages).where(and(eq(pages.id, id), isNotNull(pages.deletedAt)));
    return c.json({ ok: true });
  });
