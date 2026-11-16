import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type DatabaseData,
  type Filter,
  type LinkedRow,
  type Property,
  type PropertyType,
  type Row,
  type SelectOption,
  type Sort,
  type View,
  type ViewConfig,
} from "./api";

export const dbKey = (id: string) => ["db", id] as const;

export function useDatabase(id: string) {
  return useQuery({ queryKey: dbKey(id), queryFn: () => api.get<DatabaseData>(`/databases/${id}`) });
}

/** Mutations for one database, with optimistic cell edits. */
export function useDatabaseActions(id: string) {
  const qc = useQueryClient();
  const key = dbKey(id);
  const set = (fn: (d: DatabaseData) => DatabaseData) => qc.setQueryData<DatabaseData>(key, (d) => (d ? fn(d) : d));
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const replaceRow = (row: Row) => set((d) => ({ ...d, rows: d.rows.map((r) => (r.id === row.id ? row : r)) }));

  const updateRow = useMutation({
    mutationFn: ({
      rowId,
      ...body
    }: {
      rowId: string;
      title?: string;
      values?: Record<string, unknown>;
      before?: string | null;
    }) => api.patch<Row>(`/databases/${id}/rows/${rowId}`, body),
    onMutate: ({ rowId, title, values }) =>
      set((d) => ({
        ...d,
        rows: d.rows.map((r) =>
          r.id === rowId
            ? { ...r, title: title ?? r.title, props: { ...r.props, ...optimisticValues(d.properties, values) } }
            : r,
        ),
      })),
    onSuccess: replaceRow,
    onError: refresh,
  });

  const addRow = useMutation({
    mutationFn: (body: { title?: string; values?: Record<string, unknown> }) =>
      api.post<Row>(`/databases/${id}/rows`, body),
    onSuccess: (row) => set((d) => ({ ...d, rows: [...d.rows, row] })),
    onError: refresh,
  });

  const deleteRow = useMutation({
    mutationFn: (rowId: string) => api.delete(`/databases/${id}/rows/${rowId}`),
    onMutate: (rowId) => set((d) => ({ ...d, rows: d.rows.filter((r) => r.id !== rowId) })),
    onError: refresh,
  });

  const addProperty = useMutation({
    mutationFn: (body: { name: string; type: PropertyType; config?: Record<string, unknown> }) =>
      api.post<Property>(`/databases/${id}/properties`, body),
    onSuccess: refresh,
  });

  const updateProperty = useMutation({
    mutationFn: ({
      propId,
      ...body
    }: {
      propId: string;
      name?: string;
      type?: PropertyType;
      options?: SelectOption[];
      config?: Record<string, unknown>;
      before?: string | null;
    }) => api.patch<Property>(`/databases/${id}/properties/${propId}`, body),
    onMutate: ({ propId, name, options }) =>
      set((d) => ({
        ...d,
        properties: d.properties.map((p) =>
          p.id === propId ? { ...p, name: name ?? p.name, config: options ? { ...p.config, options } : p.config } : p,
        ),
      })),
    onSettled: refresh,
  });

  const deleteProperty = useMutation({
    mutationFn: (propId: string) => api.delete(`/databases/${id}/properties/${propId}`),
    onMutate: (propId) => set((d) => ({ ...d, properties: d.properties.filter((p) => p.id !== propId) })),
    onSettled: refresh,
  });

  const addView = useMutation({
    mutationFn: (body: { name: string; type: View["type"]; config?: ViewConfig }) =>
      api.post<View>(`/databases/${id}/views`, body),
    onSuccess: (view) => set((d) => ({ ...d, views: [...d.views, view] })),
  });

  const updateView = useMutation({
    mutationFn: ({ viewId, ...body }: { viewId: string; name?: string; type?: View["type"]; config?: ViewConfig }) =>
      api.patch<View>(`/databases/${id}/views/${viewId}`, body),
    onMutate: ({ viewId, name, type, config }) =>
      set((d) => ({
        ...d,
        views: d.views.map((v) =>
          v.id === viewId
            ? { ...v, name: name ?? v.name, type: type ?? v.type, config: { ...v.config, ...config } }
            : v,
        ),
      })),
    onError: refresh,
  });

  const deleteView = useMutation({
    mutationFn: (viewId: string) => api.delete(`/databases/${id}/views/${viewId}`),
    onMutate: (viewId) => set((d) => ({ ...d, views: d.views.filter((v) => v.id !== viewId) })),
    onError: refresh,
  });

  return { updateRow, addRow, deleteRow, addProperty, updateProperty, deleteProperty, addView, updateView, deleteView };
}

/** Immediate local value while the server confirms (relations keep their titles). */
function optimisticValues(properties: Property[], values?: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    const prop = properties.find((p) => p.id === k);
    if (!prop || prop.type === "relation") continue;
    out[k] = v;
  }
  return out;
}

/* ---------- Display helpers ---------- */

export const propertyOptions = (p: Property): SelectOption[] => p.config.options ?? [];

export function optionFor(p: Property, id: unknown) {
  return propertyOptions(p).find((o) => o.id === id);
}

export function formatNumber(p: Property, value: unknown, locale: string) {
  if (typeof value !== "number") return "";
  const fmt = p.config.format;
  if (fmt === "percent")
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(value / 100);
  if (fmt === "dollar") return new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

export function formatDate(value: unknown, locale: string, withTime = false) {
  if (typeof value !== "string" || !value) return "";
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

/** Plain text of a value, used for sorting, text filters and copy. */
export function textOf(p: Property | "title", row: Row): string {
  if (p === "title") return row.title;
  const v = row.props[p.id];
  if (v === null || v === undefined) return "";
  switch (p.type) {
    case "select":
    case "status":
      return optionFor(p, v)?.name ?? "";
    case "multi_select":
      return (v as string[]).map((id) => optionFor(p, id)?.name ?? "").join(", ");
    case "relation":
      return (v as LinkedRow[]).map((r) => r.title).join(", ");
    case "rollup":
      return Array.isArray(v) ? v.join(", ") : String(v);
    case "checkbox":
      return v ? "1" : "";
    default:
      return String(v);
  }
}

const isEmptyValue = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/* ---------- Filters & sorts (client side) ---------- */

export type FilterOp = { op: string; needsValue: boolean };

export function filterOps(type: PropertyType | "title"): string[] {
  switch (type) {
    case "number":
      return ["eq", "neq", "gt", "lt", "gte", "lte", "is_empty", "is_not_empty"];
    case "checkbox":
      return ["is_checked", "is_not_checked"];
    case "select":
    case "status":
      return ["is", "is_not", "is_empty", "is_not_empty"];
    case "multi_select":
    case "person":
    case "relation":
      return ["contains", "not_contains", "is_empty", "is_not_empty"];
    case "date":
    case "created_time":
    case "last_edited_time":
      return ["date_is", "before", "after", "is_empty", "is_not_empty"];
    default:
      return ["contains", "not_contains", "is", "is_not", "is_empty", "is_not_empty"];
  }
}

export const opNeedsValue = (op: string) => !["is_empty", "is_not_empty", "is_checked", "is_not_checked"].includes(op);

function matches(filter: Filter, row: Row, properties: Property[]): boolean {
  const prop = filter.propertyId === "title" ? "title" : properties.find((p) => p.id === filter.propertyId);
  if (!prop) return true;
  const raw = prop === "title" ? row.title : row.props[prop.id];
  const type = prop === "title" ? "text" : prop.type;
  const fv = filter.value;
  if (opNeedsValue(filter.op) && (fv === undefined || fv === null || fv === "")) return true; // incomplete filter
  switch (filter.op) {
    case "is_empty":
      return isEmptyValue(raw);
    case "is_not_empty":
      return !isEmptyValue(raw);
    case "is_checked":
      return raw === true;
    case "is_not_checked":
      return raw !== true;
  }
  if (type === "number" || (type === "rollup" && typeof raw === "number")) {
    const n = typeof raw === "number" ? raw : Number.NaN;
    const target = Number(fv);
    switch (filter.op) {
      case "eq":
        return n === target;
      case "neq":
        return n !== target;
      case "gt":
        return n > target;
      case "lt":
        return n < target;
      case "gte":
        return n >= target;
      case "lte":
        return n <= target;
    }
  }
  if (type === "select" || type === "status") {
    if (filter.op === "is") return raw === fv;
    if (filter.op === "is_not") return raw !== fv;
  }
  if (type === "multi_select" || type === "person" || type === "relation") {
    const list = ((raw as unknown[]) ?? []).map((x) => (typeof x === "object" && x ? (x as LinkedRow).id : x));
    if (filter.op === "contains") return list.includes(fv);
    if (filter.op === "not_contains") return !list.includes(fv);
  }
  if (type === "date" || type === "created_time" || type === "last_edited_time") {
    const d = typeof raw === "string" ? raw.slice(0, 10) : "";
    const t = String(fv).slice(0, 10);
    if (filter.op === "date_is") return d === t;
    if (filter.op === "before") return !!d && d < t;
    if (filter.op === "after") return !!d && d > t;
  }
  const text = (prop === "title" ? row.title : textOf(prop, row)).toLowerCase();
  const q = String(fv).toLowerCase();
  switch (filter.op) {
    case "contains":
      return text.includes(q);
    case "not_contains":
      return !text.includes(q);
    case "is":
      return text === q;
    case "is_not":
      return text !== q;
  }
  return true;
}

function compare(a: Row, b: Row, sort: Sort, properties: Property[]): number {
  const prop = sort.propertyId === "title" ? "title" : properties.find((p) => p.id === sort.propertyId);
  if (!prop) return 0;
  let av: unknown;
  let bv: unknown;
  if (prop !== "title" && (prop.type === "number" || prop.type === "rollup")) {
    av = a.props[prop.id];
    bv = b.props[prop.id];
  } else if (prop !== "title" && (prop.type === "select" || prop.type === "status")) {
    // Order of options, like Notion.
    const ids = propertyOptions(prop).map((o) => o.id);
    av = a.props[prop.id] ? ids.indexOf(a.props[prop.id] as string) : null;
    bv = b.props[prop.id] ? ids.indexOf(b.props[prop.id] as string) : null;
  } else if (prop !== "title" && prop.type === "checkbox") {
    av = a.props[prop.id] ? 1 : 0;
    bv = b.props[prop.id] ? 1 : 0;
  } else {
    av = textOf(prop, a).toLowerCase() || null;
    bv = textOf(prop, b).toLowerCase() || null;
  }
  // Empty values always last.
  if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
  if (bv === null || bv === undefined) return -1;
  const r =
    typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true });
  return sort.dir === "asc" ? r : -r;
}

export function applyView(rows: Row[], view: View, properties: Property[]) {
  const filters = view.config.filters ?? [];
  const mode = view.config.filterMode ?? "and";
  let out = filters.length
    ? rows.filter((r) =>
        mode === "and"
          ? filters.every((f) => matches(f, r, properties))
          : filters.some((f) => matches(f, r, properties)),
      )
    : [...rows];
  const sorts = view.config.sorts ?? [];
  if (sorts.length)
    out = out.sort((a, b) => {
      for (const s of sorts) {
        const r = compare(a, b, s, properties);
        if (r !== 0) return r;
      }
      return 0;
    });
  return out;
}

/** Values to give a new row so it shows up in a filtered view (e.g. "Status is Done"). */
export function valuesFromFilters(view: View, properties: Property[]) {
  const values: Record<string, unknown> = {};
  for (const f of view.config.filters ?? []) {
    const p = properties.find((x) => x.id === f.propertyId);
    if (!p || f.value === undefined || f.value === "") continue;
    if ((p.type === "select" || p.type === "status") && f.op === "is") values[p.id] = f.value;
    if (p.type === "multi_select" && f.op === "contains") values[p.id] = [f.value];
    if (p.type === "checkbox" && f.op === "is_checked") values[p.id] = true;
  }
  return values;
}

export const TYPE_ORDER: PropertyType[] = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "person",
  "url",
  "email",
  "phone",
  "relation",
  "rollup",
  "created_time",
  "last_edited_time",
];

export const READ_ONLY_TYPES: PropertyType[] = ["rollup", "created_time", "last_edited_time"];
