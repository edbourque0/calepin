import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import { dbProperties, dbViews, pages, type PropertyType, user, workspaceMembers } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import {
  checkExpression,
  convertProperty,
  createDatabase,
  createProperty,
  createRowWithValues,
  DatabaseError,
  getDatabase,
  getRows,
  nextViewPosition,
  PROPERTY_TYPES,
  TAG_COLORS,
  updateRowValues,
} from "../lib/database.js";
import { emitDatabase } from "../lib/events.js";
import { editDocument, setTitle, trashPage } from "../lib/pages.js";
import { positionAt } from "../lib/tree.js";
import { canEdit, getMembership, getPageAccess } from "../lib/workspaces.js";

const VIEW_TYPES = ["table", "board", "list", "gallery", "calendar", "timeline"] as const;
const propertyType = z.enum(PROPERTY_TYPES as [PropertyType, ...PropertyType[]]);
const option = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(100),
  color: z.enum(TAG_COLORS),
});

const filterSchema = z.object({ propertyId: z.string(), op: z.string(), value: z.unknown().optional() });
const viewConfig = z
  .object({
    filters: z.array(filterSchema).max(20).optional(),
    filterMode: z.enum(["and", "or"]).optional(),
    sorts: z
      .array(z.object({ propertyId: z.string(), dir: z.enum(["asc", "desc"]) }))
      .max(10)
      .optional(),
    groupBy: z.string().nullable().optional(),
    hidden: z.array(z.string()).optional(),
    widths: z.record(z.string(), z.number().min(60).max(1200)).optional(),
    order: z.array(z.string()).optional(),
    calculations: z.record(z.string(), z.string().max(40).nullable()).optional(),
  })
  .passthrough();

/** Loads a database the user can access; `edit` requires edit rights. */
async function access(userId: string, databaseId: string, edit = false) {
  const acc = await getPageAccess(userId, databaseId);
  if (!acc || acc.deletedAt) throw new HttpError(404, "Not found");
  if (edit && !canEdit(acc.role)) throw new HttpError(403, "Forbidden");
  const database = await getDatabase(databaseId);
  if (!database) throw new HttpError(404, "Not a database");
  return { acc, database };
}

class HttpError extends Error {
  constructor(
    public status: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

export const databaseRoutes = new Hono<AppEnv>()
  .onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof DatabaseError) return c.json({ error: err.message }, 400);
    throw err;
  })

  /* ----- Create a database page ----- */
  .post("/workspaces/:wid/databases", async (c) => {
    const wid = c.req.param("wid");
    const body = z
      .object({
        parentId: z.string().uuid().nullable().optional(),
        title: z.string().max(500).default(""),
        icon: z.string().max(64).nullable().optional(),
        viewName: z.string().max(100).optional(),
        properties: z
          .array(z.object({ name: z.string().min(1).max(100), type: propertyType }))
          .max(30)
          .optional(),
      })
      .parse(await c.req.json());
    if (body.parentId) {
      const parent = await getPageAccess(c.var.user.id, body.parentId);
      if (!parent || parent.workspaceId !== wid || !canEdit(parent.role)) return c.json({ error: "Forbidden" }, 403);
    } else {
      const member = await getMembership(c.var.user.id, wid);
      if (!member || !canEdit(member.role)) return c.json({ error: "Forbidden" }, 403);
    }
    const page = await createDatabase({
      workspaceId: wid,
      parentId: body.parentId ?? null,
      title: body.title,
      icon: body.icon,
      userId: c.var.user.id,
      properties: body.properties,
      viewName: body.viewName,
    });
    return c.json(page, 201);
  })

  /* ----- Schema + rows ----- */
  .get("/databases/:id", async (c) => {
    const { acc, database } = await access(c.var.user.id, c.req.param("id"));
    const rows = await getRows(database.page.id, database.properties);
    // People who can be picked in person properties: workspace members.
    const people = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, database.page.workspaceId));
    // Titles of related databases, for headers and pickers.
    const relatedIds = [
      ...new Set(database.properties.filter((p) => p.type === "relation").map((p) => p.config.databaseId as string)),
    ];
    const related = relatedIds.length
      ? await db
          .select({ id: pages.id, title: pages.title, icon: pages.icon })
          .from(pages)
          .where(inArray(pages.id, relatedIds))
      : [];
    return c.json({
      database: database.page,
      role: acc.role,
      properties: database.properties,
      views: database.views,
      rows,
      people,
      related,
    });
  })

  /** Rows of a related database, for relation pickers. */
  .get("/databases/:id/options", async (c) => {
    const { database } = await access(c.var.user.id, c.req.param("id"));
    const rows = await db
      .select({ id: pages.id, title: pages.title, icon: pages.icon })
      .from(pages)
      .where(and(eq(pages.parentId, database.page.id), eq(pages.type, "row")));
    return c.json(rows);
  })

  /* ----- Rows ----- */
  .post("/databases/:id/rows", async (c) => {
    const { acc, database } = await access(c.var.user.id, c.req.param("id"), true);
    const body = z
      .object({ title: z.string().max(500).optional(), values: z.record(z.string(), z.unknown()).optional() })
      .parse(await c.req.json().catch(() => ({})));
    const row = await createRowWithValues({
      database: database.page,
      properties: database.properties,
      title: body.title,
      values: body.values,
      userId: c.var.user.id,
    });
    emitDatabase(acc.workspaceId, database.page.id);
    const [full] = await getRows(database.page.id, database.properties, [row.id]);
    return c.json(full, 201);
  })

  .patch("/databases/:id/rows/:rowId", async (c) => {
    const { acc, database } = await access(c.var.user.id, c.req.param("id"), true);
    const rowId = c.req.param("rowId");
    const body = z
      .object({
        title: z.string().max(500).optional(),
        values: z.record(z.string(), z.unknown()).optional(),
        /** Manual order: place the row before this row id (null = at the end). */
        before: z.string().uuid().nullable().optional(),
      })
      .parse(await c.req.json());
    const [row] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, rowId), eq(pages.parentId, database.page.id)));
    if (!row) return c.json({ error: "Row not found" }, 404);

    let touched = [database.page.id];
    if (body.values)
      touched = await updateRowValues(database.page.id, database.properties, rowId, body.values, c.var.user.id);
    if (body.title !== undefined) {
      await db.update(pages).set({ title: body.title.trim(), updatedAt: new Date() }).where(eq(pages.id, rowId));
      await editDocument(rowId, c.var.user.id, (doc) => setTitle(doc, body.title!));
    }
    if (body.before !== undefined) {
      const all = await getRows(database.page.id, []);
      const others = all.filter((r) => r.id !== rowId);
      const index = body.before
        ? Math.max(
            0,
            others.findIndex((r) => r.id === body.before),
          )
        : others.length;
      await db
        .update(pages)
        .set({ position: await positionAt(acc.workspaceId, database.page.id, index, rowId) })
        .where(eq(pages.id, rowId));
    }
    for (const id of touched) emitDatabase(acc.workspaceId, id);
    const [full] = await getRows(database.page.id, database.properties, [rowId]);
    return c.json(full);
  })

  .delete("/databases/:id/rows/:rowId", async (c) => {
    const { acc, database } = await access(c.var.user.id, c.req.param("id"), true);
    const rowId = c.req.param("rowId");
    const [row] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, rowId), eq(pages.parentId, database.page.id)));
    if (!row) return c.json({ error: "Row not found" }, 404);
    await trashPage(rowId, acc.workspaceId);
    emitDatabase(acc.workspaceId, database.page.id);
    return c.json({ ok: true });
  })

  /* ----- Properties ----- */
  .post("/databases/:id/properties", async (c) => {
    const { acc, database } = await access(c.var.user.id, c.req.param("id"), true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        type: propertyType,
        config: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(await c.req.json());
    if (body.type === "relation") {
      const target = await getPageAccess(c.var.user.id, String(body.config?.databaseId ?? ""));
      if (!target || !canEdit(target.role))
        return c.json({ error: "You need edit access to the related database" }, 403);
    }
    const prop = await createProperty(database.page.id, body, database.page.title);
    emitDatabase(acc.workspaceId, database.page.id);
    if (prop.type === "relation" && prop.config.pairedPropertyId)
      emitDatabase(acc.workspaceId, prop.config.databaseId as string);
    return c.json(prop, 201);
  })

  /** Evaluates an expression on the first rows without saving it (formula editor preview). */
  .post("/databases/:id/formula-preview", async (c) => {
    const { database } = await access(c.var.user.id, c.req.param("id"));
    const body = z
      .object({ expression: z.string().max(5000), propertyId: z.string().optional() })
      .parse(await c.req.json());
    try {
      checkExpression(body.expression);
    } catch (e) {
      return c.json({ error: (e as Error).message, results: [] });
    }
    const temp = {
      id: "__preview__",
      databaseId: database.page.id,
      name: "__preview__",
      type: "formula" as const,
      config: { expression: body.expression },
      position: "zzzz",
      createdAt: new Date(),
    };
    const properties = database.properties.filter((p) => p.id !== body.propertyId).concat(temp);
    const rows = (await getRows(database.page.id, properties)).slice(0, 3);
    return c.json({
      error: null,
      results: rows.map((r) => ({ id: r.id, title: r.title, value: r.props.__preview__ })),
    });
  })

  .patch("/databases/:id/properties/:propId", async (c) => {
    const { acc, database } = await access(c.var.user.id, c.req.param("id"), true);
    let prop = database.properties.find((p) => p.id === c.req.param("propId"));
    if (!prop) return c.json({ error: "Property not found" }, 404);
    const body = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        type: propertyType.optional(),
        options: z.array(option).max(200).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        /** Place before this property id (null = last). */
        before: z.string().nullable().optional(),
      })
      .parse(await c.req.json());
    if (body.type && body.type !== prop.type) prop = await convertProperty(prop, body.type);
    const patch: Partial<typeof dbProperties.$inferInsert> = {};
    if (body.name) patch.name = body.name;
    if (body.options || body.config) {
      const config = { ...prop.config, ...(body.config ?? {}) };
      if (body.options) config.options = body.options;
      // Structural keys are not editable through config.
      if (prop.type === "relation") {
        config.databaseId = prop.config.databaseId;
        config.pairedPropertyId = prop.config.pairedPropertyId;
      }
      if (prop.type === "formula") checkExpression(config.expression);
      patch.config = config;
      if (body.options) {
        // Clear values that point to removed options.
        const keep = new Set(body.options.map((o) => o.id));
        const rows = await db
          .select({ id: pages.id, props: pages.props })
          .from(pages)
          .where(and(eq(pages.parentId, database.page.id), eq(pages.type, "row")));
        for (const r of rows) {
          const v = r.props[prop.id];
          if (v === undefined) continue;
          const next = Array.isArray(v) ? v.filter((x) => keep.has(x)) : keep.has(v as string) ? v : null;
          if (JSON.stringify(next) === JSON.stringify(v)) continue;
          const props = { ...r.props };
          if (next === null || (Array.isArray(next) && !next.length)) delete props[prop.id];
          else props[prop.id] = next;
          await db.update(pages).set({ props }).where(eq(pages.id, r.id));
        }
      }
    }
    if (body.before !== undefined) {
      const ordered = database.properties.filter((p) => p.id !== prop!.id);
      const i = body.before ? ordered.findIndex((p) => p.id === body.before) : ordered.length;
      const { generateKeyBetween } = await import("fractional-indexing");
      const prev = ordered[i - 1]?.position ?? null;
      const next = ordered[i]?.position ?? null;
      patch.position = prev && next && prev >= next ? generateKeyBetween(prev, null) : generateKeyBetween(prev, next);
    }
    if (Object.keys(patch).length)
      [prop] = await db.update(dbProperties).set(patch).where(eq(dbProperties.id, prop.id)).returning();
    emitDatabase(acc.workspaceId, database.page.id);
    return c.json(prop);
  })

  .delete("/databases/:id/properties/:propId", async (c) => {
    const { acc, database } = await access(c.var.user.id, c.req.param("id"), true);
    const prop = database.properties.find((p) => p.id === c.req.param("propId"));
    if (!prop) return c.json({ error: "Property not found" }, 404);
    const ids = [prop.id];
    if (prop.type === "relation" && prop.config.pairedPropertyId) ids.push(prop.config.pairedPropertyId as string);
    // Rollups built on a deleted relation go too.
    const dependants = await db.select().from(dbProperties).where(eq(dbProperties.type, "rollup"));
    for (const d of dependants) if (ids.includes(d.config.relationPropertyId as string)) ids.push(d.id);
    await db.delete(dbProperties).where(inArray(dbProperties.id, ids));
    emitDatabase(acc.workspaceId, database.page.id);
    if (prop.type === "relation") emitDatabase(acc.workspaceId, prop.config.databaseId as string);
    return c.json({ ok: true, deleted: ids });
  })

  /* ----- Views ----- */
  .post("/databases/:id/views", async (c) => {
    const { acc, database } = await access(c.var.user.id, c.req.param("id"), true);
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        type: z.enum(VIEW_TYPES),
        config: viewConfig.optional(),
      })
      .parse(await c.req.json());
    const [view] = await db
      .insert(dbViews)
      .values({
        databaseId: database.page.id,
        name: body.name,
        type: body.type,
        config: body.config ?? {},
        position: await nextViewPosition(database.page.id),
      })
      .returning();
    emitDatabase(acc.workspaceId, database.page.id);
    return c.json(view, 201);
  })

  .patch("/databases/:id/views/:viewId", async (c) => {
    const { acc, database } = await access(c.var.user.id, c.req.param("id"), true);
    const view = database.views.find((v) => v.id === c.req.param("viewId"));
    if (!view) return c.json({ error: "View not found" }, 404);
    const body = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        type: z.enum(VIEW_TYPES).optional(),
        config: viewConfig.optional(),
      })
      .parse(await c.req.json());
    const [updated] = await db
      .update(dbViews)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.type ? { type: body.type } : {}),
        ...(body.config ? { config: { ...view.config, ...body.config } } : {}),
      })
      .where(eq(dbViews.id, view.id))
      .returning();
    emitDatabase(acc.workspaceId, database.page.id);
    return c.json(updated);
  })

  .delete("/databases/:id/views/:viewId", async (c) => {
    const { acc, database } = await access(c.var.user.id, c.req.param("id"), true);
    if (database.views.length <= 1) return c.json({ error: "A database needs at least one view" }, 400);
    await db
      .delete(dbViews)
      .where(and(eq(dbViews.id, c.req.param("viewId")), eq(dbViews.databaseId, database.page.id)));
    emitDatabase(acc.workspaceId, database.page.id);
    return c.json({ ok: true });
  });
