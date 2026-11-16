import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { db } from "../db/index.js";
import { dbProperties, dbRelations, dbViews, pages, type PropertyType, user, type ViewType } from "../db/schema.js";
import { emitWorkspace } from "./events.js";
import { positionAt } from "./tree.js";

/* ---------- Types ---------- */

export const TAG_COLORS = ["gray", "amber", "green", "blue", "rose"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export type SelectOption = { id: string; name: string; color: TagColor };

export type Property = typeof dbProperties.$inferSelect;
export type RollupFn =
  | "count"
  | "count_values"
  | "count_unique"
  | "sum"
  | "average"
  | "min"
  | "max"
  | "show_original"
  | "percent_checked"
  | "earliest"
  | "latest";

export const PROPERTY_TYPES: PropertyType[] = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone",
  "person",
  "relation",
  "rollup",
  "created_time",
  "last_edited_time",
];

const READ_ONLY: PropertyType[] = ["rollup", "created_time", "last_edited_time"];
export const isReadOnly = (type: PropertyType) => READ_ONLY.includes(type);

export class DatabaseError extends Error {}

const shortId = () => Math.random().toString(36).slice(2, 10);

export function options(prop: Pick<Property, "config">): SelectOption[] {
  return Array.isArray(prop.config.options) ? (prop.config.options as SelectOption[]) : [];
}

/* ---------- Loading ---------- */

export async function getDatabase(databaseId: string) {
  const [page] = await db
    .select({
      id: pages.id,
      workspaceId: pages.workspaceId,
      parentId: pages.parentId,
      title: pages.title,
      icon: pages.icon,
      type: pages.type,
      deletedAt: pages.deletedAt,
    })
    .from(pages)
    .where(eq(pages.id, databaseId));
  if (!page || page.type !== "database") return null;
  const properties = await db
    .select()
    .from(dbProperties)
    .where(eq(dbProperties.databaseId, databaseId))
    .orderBy(sql`${dbProperties.position} COLLATE "C"`, asc(dbProperties.createdAt));
  const views = await db
    .select()
    .from(dbViews)
    .where(eq(dbViews.databaseId, databaseId))
    .orderBy(sql`${dbViews.position} COLLATE "C"`, asc(dbViews.createdAt));
  return { page, properties, views };
}

export type RowRecord = {
  id: string;
  title: string;
  icon: string | null;
  position: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  props: Record<string, unknown>;
};

async function loadRows(where: ReturnType<typeof and>) {
  return db
    .select({
      id: pages.id,
      databaseId: pages.parentId,
      title: pages.title,
      icon: pages.icon,
      position: pages.position,
      createdAt: pages.createdAt,
      updatedAt: pages.updatedAt,
      createdBy: pages.createdBy,
      updatedBy: pages.updatedBy,
      props: pages.props,
    })
    .from(pages)
    .where(where)
    .orderBy(sql`${pages.position} COLLATE "C"`, asc(pages.createdAt));
}

export type LinkedRow = { id: string; title: string; icon: string | null };

/**
 * Rows of a database with every value resolved: relations become [{id, title, icon}],
 * rollups are computed, created/edited times filled in.
 */
export async function getRows(databaseId: string, properties: Property[], onlyRowIds?: string[]) {
  const rows = await loadRows(
    and(
      eq(pages.parentId, databaseId),
      eq(pages.type, "row"),
      isNull(pages.deletedAt),
      onlyRowIds ? inArray(pages.id, onlyRowIds) : undefined,
    ),
  );
  if (rows.length === 0) return [];
  const rowIds = rows.map((r) => r.id);

  // Relation links for every relation property of this database.
  const relationProps = properties.filter((p) => p.type === "relation");
  const links = relationProps.length
    ? await db
        .select({
          propertyId: dbRelations.propertyId,
          fromRow: dbRelations.fromRow,
          toRow: dbRelations.toRow,
          title: pages.title,
          icon: pages.icon,
          position: dbRelations.position,
        })
        .from(dbRelations)
        .innerJoin(pages, and(eq(pages.id, dbRelations.toRow), isNull(pages.deletedAt)))
        .where(
          and(
            inArray(
              dbRelations.propertyId,
              relationProps.map((p) => p.id),
            ),
            inArray(dbRelations.fromRow, rowIds),
          ),
        )
        .orderBy(sql`${dbRelations.position} COLLATE "C"`)
    : [];
  const linksBy = new Map<string, LinkedRow[]>(); // `${propertyId}:${rowId}`
  for (const l of links) {
    const k = `${l.propertyId}:${l.fromRow}`;
    const arr = linksBy.get(k) ?? [];
    arr.push({ id: l.toRow, title: l.title, icon: l.icon });
    linksBy.set(k, arr);
  }

  // Data needed for rollups: target rows' values and the target property definitions.
  const rollups = properties.filter((p) => p.type === "rollup");
  const targetRows = new Map<string, Awaited<ReturnType<typeof loadRows>>[number]>();
  const targetProps = new Map<string, Property>();
  if (rollups.length) {
    const targetIds = [...new Set(links.map((l) => l.toRow))];
    if (targetIds.length) for (const r of await loadRows(inArray(pages.id, targetIds))) targetRows.set(r.id, r);
    const targetPropIds = rollups.map((r) => r.config.targetPropertyId as string).filter((id) => id && id !== "title");
    if (targetPropIds.length)
      for (const p of await db.select().from(dbProperties).where(inArray(dbProperties.id, targetPropIds)))
        targetProps.set(p.id, p);
  }

  return rows.map((row) => {
    const props: Record<string, unknown> = {};
    for (const prop of properties) {
      switch (prop.type) {
        case "relation":
          props[prop.id] = linksBy.get(`${prop.id}:${row.id}`) ?? [];
          break;
        case "rollup":
          props[prop.id] = computeRollup(
            prop,
            linksBy.get(`${prop.config.relationPropertyId}:${row.id}`) ?? [],
            targetRows,
            targetProps,
          );
          break;
        case "created_time":
          props[prop.id] = row.createdAt.toISOString();
          break;
        case "last_edited_time":
          props[prop.id] = row.updatedAt.toISOString();
          break;
        default:
          props[prop.id] = row.props[prop.id] ?? null;
      }
    }
    return { ...row, databaseId, props } satisfies RowRecord & { databaseId: string };
  });
}

/* ---------- Rollups ---------- */

function displayValue(
  prop: Property | undefined,
  row: { title: string; props: Record<string, unknown> },
  propId: string,
): unknown {
  if (propId === "title") return row.title;
  if (!prop) return null;
  const v = row.props[propId];
  if (prop.type === "select" || prop.type === "status") return options(prop).find((o) => o.id === v)?.name ?? null;
  if (prop.type === "multi_select")
    return Array.isArray(v) ? v.map((id) => options(prop).find((o) => o.id === id)?.name).filter(Boolean) : [];
  return v ?? null;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

export function computeRollup(
  prop: Property,
  linked: LinkedRow[],
  targetRows: Map<string, { title: string; props: Record<string, unknown>; createdAt: Date; updatedAt: Date }>,
  targetProps: Map<string, Property>,
): unknown {
  const fn = (prop.config.fn as RollupFn) ?? "count";
  const targetPropId = (prop.config.targetPropertyId as string) ?? "title";
  const tp = targetProps.get(targetPropId);
  const values = linked
    .map((l) => targetRows.get(l.id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => {
      if (tp?.type === "created_time") return r.createdAt.toISOString();
      if (tp?.type === "last_edited_time") return r.updatedAt.toISOString();
      return displayValue(tp, r, targetPropId);
    });
  const flat = values.flatMap((v) => (Array.isArray(v) ? v : [v]));
  const nums = flat.map((v) => (typeof v === "number" ? v : Number.NaN)).filter((n) => Number.isFinite(n));
  const dates = flat.filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)).sort();
  switch (fn) {
    case "count":
      return linked.length;
    case "count_values":
      return values.filter((v) => !isEmpty(v)).length;
    case "count_unique":
      return new Set(flat.filter((v) => !isEmpty(v)).map(String)).size;
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "average":
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case "min":
      return nums.length ? Math.min(...nums) : null;
    case "max":
      return nums.length ? Math.max(...nums) : null;
    case "percent_checked":
      return values.length ? values.filter((v) => v === true).length / values.length : null;
    case "earliest":
      return dates[0] ?? null;
    case "latest":
      return dates.at(-1) ?? null;
    case "show_original":
    default:
      return flat.filter((v) => !isEmpty(v)).map((v) => (typeof v === "boolean" ? (v ? "✓" : "✗") : String(v)));
  }
}

/* ---------- Values ---------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Validates and normalises a value for a property. Select values may be given as option ids
 * or names; unknown names create new options when `createOptions` is true (the property is updated).
 */
export async function normalizeValue(prop: Property, value: unknown, createOptions = true): Promise<unknown> {
  if (value === undefined) return undefined;
  if (value === null || value === "") return prop.type === "checkbox" ? false : null;
  switch (prop.type) {
    case "text":
    case "url":
    case "email":
    case "phone":
      return String(value).slice(0, 10_000);
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
      if (!Number.isFinite(n)) throw new DatabaseError(`"${prop.name}" expects a number`);
      return n;
    }
    case "checkbox":
      return value === true || value === "true" || value === 1 || value === "1" || value === "yes";
    case "date": {
      const s = String(value).trim();
      if (!DATE_RE.test(s)) throw new DatabaseError(`"${prop.name}" expects a date like 2026-11-16`);
      return s;
    }
    case "select":
    case "status": {
      const [id] = await resolveOptions(prop, [String(value)], createOptions);
      return id ?? null;
    }
    case "multi_select": {
      const list = Array.isArray(value)
        ? value.map(String)
        : String(value)
            .split(",")
            .map((s) => s.trim());
      return resolveOptions(prop, list.filter(Boolean), createOptions);
    }
    case "person": {
      const list = (Array.isArray(value) ? value : [value]).map(String);
      return [...new Set(list)].slice(0, 50);
    }
    default:
      throw new DatabaseError(`"${prop.name}" can't be set directly`);
  }
}

async function resolveOptions(prop: Property, inputs: string[], create: boolean): Promise<string[]> {
  const opts = [...options(prop)];
  const ids: string[] = [];
  let changed = false;
  for (const input of inputs) {
    const found = opts.find((o) => o.id === input) ?? opts.find((o) => o.name.toLowerCase() === input.toLowerCase());
    if (found) ids.push(found.id);
    else if (create) {
      const option = { id: shortId(), name: input.slice(0, 100), color: TAG_COLORS[opts.length % TAG_COLORS.length]! };
      opts.push(option);
      ids.push(option.id);
      changed = true;
    } else throw new DatabaseError(`"${input}" is not an option of "${prop.name}"`);
  }
  if (changed) {
    prop.config = { ...prop.config, options: opts };
    await db.update(dbProperties).set({ config: prop.config }).where(eq(dbProperties.id, prop.id));
  }
  return [...new Set(ids)];
}

/** Replaces the links of a relation property on one row, keeping the paired property in sync. */
export async function setRelation(prop: Property, rowId: string, targetIds: string[]) {
  const targetDb = prop.config.databaseId as string;
  const pairedId = (prop.config.pairedPropertyId as string | null) ?? null;
  const wanted = [...new Set(targetIds)];
  if (wanted.length) {
    const valid = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(inArray(pages.id, wanted), eq(pages.parentId, targetDb), eq(pages.type, "row")));
    if (valid.length !== wanted.length) throw new DatabaseError(`Some rows don't belong to the related database`);
  }
  const current = await db
    .select({ toRow: dbRelations.toRow })
    .from(dbRelations)
    .where(and(eq(dbRelations.propertyId, prop.id), eq(dbRelations.fromRow, rowId)));
  const have = new Set(current.map((c) => c.toRow));
  const removed = [...have].filter((id) => !wanted.includes(id));
  const added = wanted.filter((id) => !have.has(id));

  await db.transaction(async (tx) => {
    if (removed.length) {
      await tx
        .delete(dbRelations)
        .where(
          and(eq(dbRelations.propertyId, prop.id), eq(dbRelations.fromRow, rowId), inArray(dbRelations.toRow, removed)),
        );
      if (pairedId)
        await tx
          .delete(dbRelations)
          .where(
            and(
              eq(dbRelations.propertyId, pairedId),
              eq(dbRelations.toRow, rowId),
              inArray(dbRelations.fromRow, removed),
            ),
          );
    }
    // Keep the order given by the caller.
    let pos: string | null = null;
    for (const id of wanted) {
      pos = generateKeyBetween(pos, null);
      if (added.includes(id)) {
        await tx
          .insert(dbRelations)
          .values({ propertyId: prop.id, fromRow: rowId, toRow: id, position: pos })
          .onConflictDoNothing();
        if (pairedId)
          await tx
            .insert(dbRelations)
            .values({ propertyId: pairedId, fromRow: id, toRow: rowId, position: "a0" })
            .onConflictDoNothing();
      } else {
        await tx
          .update(dbRelations)
          .set({ position: pos })
          .where(and(eq(dbRelations.propertyId, prop.id), eq(dbRelations.fromRow, rowId), eq(dbRelations.toRow, id)));
      }
    }
  });
  return { pairedDatabaseId: pairedId ? targetDb : null };
}

/* ---------- Schema changes ---------- */

export async function nextPropertyPosition(databaseId: string) {
  const [last] = await db
    .select({ position: dbProperties.position })
    .from(dbProperties)
    .where(eq(dbProperties.databaseId, databaseId))
    .orderBy(sql`${dbProperties.position} COLLATE "C" DESC`)
    .limit(1);
  return generateKeyBetween(last?.position ?? null, null);
}

export async function nextViewPosition(databaseId: string) {
  const [last] = await db
    .select({ position: dbViews.position })
    .from(dbViews)
    .where(eq(dbViews.databaseId, databaseId))
    .orderBy(sql`${dbViews.position} COLLATE "C" DESC`)
    .limit(1);
  return generateKeyBetween(last?.position ?? null, null);
}

export function defaultConfig(type: PropertyType, config: Record<string, unknown> = {}): Record<string, unknown> {
  switch (type) {
    case "select":
    case "multi_select":
      return { options: [], ...config };
    case "status":
      return {
        options: [
          { id: "todo", name: "À faire", color: "gray" },
          { id: "doing", name: "En cours", color: "blue" },
          { id: "done", name: "Terminé", color: "green" },
        ],
        ...config,
      };
    case "number":
      return { format: "number", ...config };
    case "rollup":
      return { fn: "count", targetPropertyId: "title", ...config };
    default:
      return config;
  }
}

export async function createProperty(
  databaseId: string,
  input: { name: string; type: PropertyType; config?: Record<string, unknown> },
  databaseTitle: string,
) {
  const config = defaultConfig(input.type, input.config);
  if (input.type === "relation") {
    const target = await getDatabase(String(config.databaseId ?? ""));
    if (!target || target.page.deletedAt) throw new DatabaseError("Choose the database to relate to");
    const [db0] = await db.select({ ws: pages.workspaceId }).from(pages).where(eq(pages.id, databaseId));
    if (target.page.workspaceId !== db0?.ws) throw new DatabaseError("Relations must stay in the same workspace");
  }
  if (input.type === "rollup") {
    const [rel] = await db
      .select()
      .from(dbProperties)
      .where(eq(dbProperties.id, String(config.relationPropertyId ?? "")));
    if (!rel || rel.databaseId !== databaseId || rel.type !== "relation")
      throw new DatabaseError("A rollup needs a relation of this database");
  }
  const twoWay = input.type === "relation" && config.twoWay !== false;
  delete config.twoWay;
  const [prop] = await db
    .insert(dbProperties)
    .values({
      databaseId,
      name: input.name,
      type: input.type,
      config: { ...config, pairedPropertyId: null },
      position: await nextPropertyPosition(databaseId),
    })
    .returning();
  if (twoWay) {
    const targetId = config.databaseId as string;
    const [paired] = await db
      .insert(dbProperties)
      .values({
        databaseId: targetId,
        name: (databaseTitle || "Relation").slice(0, 100),
        type: "relation",
        config: { databaseId, pairedPropertyId: prop!.id },
        position: await nextPropertyPosition(targetId),
      })
      .returning();
    prop!.config = { ...prop!.config, pairedPropertyId: paired!.id };
    await db.update(dbProperties).set({ config: prop!.config }).where(eq(dbProperties.id, prop!.id));
  }
  return prop!;
}

/** Best-effort conversion of stored values when a property changes type. */
export async function convertProperty(prop: Property, to: PropertyType) {
  const from = prop.type;
  if (from === to) return prop;
  const special: PropertyType[] = ["relation", "rollup"];
  if (special.includes(from) || special.includes(to))
    throw new DatabaseError("Relations and rollups can't change type: delete and recreate the property");

  const rows = await db
    .select({ id: pages.id, props: pages.props })
    .from(pages)
    .where(and(eq(pages.parentId, prop.databaseId), eq(pages.type, "row")));
  const nextProp: Property = {
    ...prop,
    type: to,
    config: defaultConfig(
      to,
      to === "multi_select" || to === "select" || to === "status" ? { options: options(prop) } : {},
    ),
  };
  if ((to === "select" || to === "status") && from === "multi_select") nextProp.config.options = options(prop);

  for (const row of rows) {
    const v = row.props[prop.id];
    let next: unknown = null;
    if (v !== null && v !== undefined) {
      const asText = Array.isArray(v)
        ? v.map((id) => options(prop).find((o) => o.id === id)?.name ?? id).join(", ")
        : from === "select" || from === "status"
          ? (options(prop).find((o) => o.id === v)?.name ?? "")
          : String(v);
      try {
        if (to === "text" || to === "url" || to === "email" || to === "phone") next = asText;
        else if ((from === "select" || from === "status") && to === "multi_select") next = [v];
        else if (from === "multi_select" && (to === "select" || to === "status"))
          next = Array.isArray(v) ? (v[0] ?? null) : null;
        else if ((from === "select" || from === "status") && (to === "select" || to === "status")) next = v;
        else if (to === "created_time" || to === "last_edited_time") next = null;
        else next = await normalizeValue(nextProp, asText, true);
      } catch {
        next = null;
      }
    }
    const props = { ...row.props };
    if (next === null || next === undefined) delete props[prop.id];
    else props[prop.id] = next;
    await db.update(pages).set({ props }).where(eq(pages.id, row.id));
  }
  const [updated] = await db
    .update(dbProperties)
    .set({ type: to, config: nextProp.config })
    .where(eq(dbProperties.id, prop.id))
    .returning();
  return updated!;
}

/* ---------- Creating databases and rows ---------- */

export async function createDatabase(input: {
  workspaceId: string;
  parentId: string | null;
  title: string;
  icon?: string | null;
  userId: string;
  properties?: { name: string; type: PropertyType; config?: Record<string, unknown> }[];
  viewName?: string;
}) {
  const [page] = await db
    .insert(pages)
    .values({
      workspaceId: input.workspaceId,
      parentId: input.parentId,
      position: await positionAt(input.workspaceId, input.parentId),
      type: "database",
      title: input.title.trim(),
      icon: input.icon ?? null,
      createdBy: input.userId,
      updatedBy: input.userId,
    })
    .returning();
  let pos: string | null = null;
  for (const p of input.properties ?? []) {
    if (p.type === "relation" || p.type === "rollup") continue;
    pos = generateKeyBetween(pos, null);
    await db.insert(dbProperties).values({
      databaseId: page!.id,
      name: p.name,
      type: p.type,
      config: defaultConfig(p.type, p.config),
      position: pos,
    });
  }
  await db
    .insert(dbViews)
    .values({ databaseId: page!.id, name: input.viewName ?? "Table", type: "table", position: "a0" });
  emitWorkspace(input.workspaceId);
  return page!;
}

/**
 * Creates a row and applies values; if a value is invalid the row is removed again,
 * so a failed call leaves nothing behind.
 */
export async function createRowWithValues(input: {
  database: { id: string; workspaceId: string };
  properties: Property[];
  title?: string;
  values?: Record<string, unknown>;
  userId: string;
}) {
  const row = await createRow(input);
  if (input.values && Object.keys(input.values).length) {
    try {
      await updateRowValues(input.database.id, input.properties, row.id, input.values, input.userId);
    } catch (e) {
      await db.delete(pages).where(eq(pages.id, row.id));
      throw e;
    }
  }
  return row;
}

export async function createRow(input: {
  database: { id: string; workspaceId: string };
  title?: string;
  props?: Record<string, unknown>;
  userId: string;
}) {
  const [row] = await db
    .insert(pages)
    .values({
      workspaceId: input.database.workspaceId,
      parentId: input.database.id,
      position: await positionAt(input.database.workspaceId, input.database.id),
      type: "row",
      title: input.title?.trim() ?? "",
      props: input.props ?? {},
      createdBy: input.userId,
      updatedBy: input.userId,
    })
    .returning({ id: pages.id });
  return row!;
}

/** Applies a set of property values (by property id or name) to a row. */
export async function updateRowValues(
  databaseId: string,
  properties: Property[],
  rowId: string,
  values: Record<string, unknown>,
  userId: string,
) {
  const [row] = await db
    .select({ props: pages.props })
    .from(pages)
    .where(and(eq(pages.id, rowId), eq(pages.parentId, databaseId)));
  if (!row) throw new DatabaseError("Row not found in this database");
  const props = { ...row.props };
  const touchedDatabases = new Set<string>([databaseId]);
  for (const [key, raw] of Object.entries(values)) {
    const prop =
      properties.find((p) => p.id === key) ?? properties.find((p) => p.name.toLowerCase() === key.toLowerCase());
    if (!prop) throw new DatabaseError(`Unknown property "${key}"`);
    if (isReadOnly(prop.type)) throw new DatabaseError(`"${prop.name}" is computed and can't be edited`);
    if (prop.type === "relation") {
      const ids =
        raw === null
          ? []
          : (Array.isArray(raw) ? raw : [raw]).map((v) =>
              typeof v === "object" && v ? (v as LinkedRow).id : String(v),
            );
      const { pairedDatabaseId } = await setRelation(prop, rowId, ids);
      if (pairedDatabaseId) touchedDatabases.add(pairedDatabaseId);
      continue;
    }
    const v = await normalizeValue(prop, raw);
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete props[prop.id];
    else props[prop.id] = v;
  }
  await db.update(pages).set({ props, updatedAt: new Date(), updatedBy: userId }).where(eq(pages.id, rowId));
  return [...touchedDatabases];
}

/** Display names for people referenced by person properties. */
export async function peopleNames(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export type { ViewType };

/* ---------- Plain-text values (exports, agents) ---------- */

export function personIds(properties: Property[], rows: { props: Record<string, unknown> }[]) {
  const ids = new Set<string>();
  for (const p of properties)
    if (p.type === "person")
      for (const r of rows) for (const id of (r.props[p.id] as string[] | null) ?? []) ids.add(id);
  return [...ids];
}

export function formatValue(prop: Property, value: unknown, people: Map<string, string>): string {
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
