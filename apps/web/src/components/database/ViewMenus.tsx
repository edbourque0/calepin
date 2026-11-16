import { Eye, EyeOff, Plus, X } from "lucide-react";
import type { DatabaseData, Filter, Property, Sort, View, ViewConfig } from "@/lib/api";
import { filterOps, opNeedsValue, propertyOptions } from "@/lib/database";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PropertyIcon } from "./cells";

const selectCls = "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-[13px] shadow-xs";

type MenuProps = { data: DatabaseData; view: View; onChange: (config: ViewConfig) => void };

function propertyChoices(data: DatabaseData, t: (k: string) => string) {
  return [{ id: "title", name: t("db.titleColumn"), type: "text" as const }, ...data.properties];
}

/* ---------- Filters ---------- */

function FilterValue({
  prop,
  filter,
  onChange,
}: {
  prop: Property | undefined;
  filter: Filter;
  onChange: (v: unknown) => void;
}) {
  const { t } = useI18n();
  if (!opNeedsValue(filter.op)) return null;
  const type = prop?.type ?? "text";
  if (prop && (type === "select" || type === "status" || type === "multi_select"))
    return (
      <select
        value={(filter.value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={cn(selectCls, "flex-1")}
      >
        <option value="">—</option>
        {propertyOptions(prop).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  if (type === "date" || type === "created_time" || type === "last_edited_time")
    return (
      <input
        type="date"
        value={(filter.value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={cn(selectCls, "flex-1")}
      />
    );
  return (
    <input
      value={(filter.value as string) ?? ""}
      inputMode={type === "number" ? "decimal" : undefined}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("db.value")}
      className={cn(selectCls, "min-w-0 flex-1 placeholder:text-muted-foreground")}
    />
  );
}

export function FilterMenu({ data, view, onChange }: MenuProps) {
  const { t } = useI18n();
  const filters = view.config.filters ?? [];
  const mode = view.config.filterMode ?? "and";
  const choices = propertyChoices(data, t).filter((p) => p.type !== "relation" || true);
  const set = (next: Filter[]) => onChange({ filters: next });
  const update = (i: number, patch: Partial<Filter>) => set(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="flex w-[min(520px,calc(100vw-24px))] flex-col gap-2 p-2">
      {filters.map((f, i) => {
        const prop = data.properties.find((p) => p.id === f.propertyId);
        const ops = filterOps(f.propertyId === "title" ? "title" : (prop?.type ?? "text"));
        return (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-10 shrink-0 text-xs text-muted-foreground">
              {i === 0 ? (
                t("db.where")
              ) : i === 1 ? (
                <select
                  value={mode}
                  onChange={(e) => onChange({ filterMode: e.target.value as "and" | "or" })}
                  className="bg-transparent"
                >
                  <option value="and">{t("db.and")}</option>
                  <option value="or">{t("db.or")}</option>
                </select>
              ) : (
                t(mode === "and" ? "db.and" : "db.or")
              )}
            </span>
            <select
              value={f.propertyId}
              onChange={(e) => {
                const p = choices.find((c) => c.id === e.target.value);
                update(i, {
                  propertyId: e.target.value,
                  op: filterOps(p?.id === "title" ? "title" : (p?.type ?? "text"))[0]!,
                  value: undefined,
                });
              }}
              className={cn(selectCls, "w-36")}
            >
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select value={f.op} onChange={(e) => update(i, { op: e.target.value })} className={cn(selectCls, "w-36")}>
              {ops.map((op) => (
                <option key={op} value={op}>
                  {t(`op.${op}`)}
                </option>
              ))}
            </select>
            <FilterValue prop={prop} filter={f} onChange={(v) => update(i, { value: v })} />
            <button
              aria-label="Remove"
              onClick={() => set(filters.filter((_, j) => j !== i))}
              className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
      <button
        onClick={() => set([...filters, { propertyId: "title", op: "contains", value: "" }])}
        className="flex h-8 items-center gap-2 self-start rounded-sm px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-4" />
        {t("db.addFilter")}
      </button>
    </div>
  );
}

/* ---------- Sorts ---------- */

export function SortMenu({ data, view, onChange }: MenuProps) {
  const { t } = useI18n();
  const sorts = view.config.sorts ?? [];
  const choices = propertyChoices(data, t);
  const set = (next: Sort[]) => onChange({ sorts: next });
  return (
    <div className="flex w-[min(380px,calc(100vw-24px))] flex-col gap-2 p-2">
      {sorts.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select
            value={s.propertyId}
            onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, propertyId: e.target.value } : x)))}
            className={cn(selectCls, "flex-1")}
          >
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={s.dir}
            onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x)))}
            className={cn(selectCls, "w-32")}
          >
            <option value="asc">{t("db.asc")}</option>
            <option value="desc">{t("db.desc")}</option>
          </select>
          <button
            aria-label="Remove"
            onClick={() => set(sorts.filter((_, j) => j !== i))}
            className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          set([...sorts, { propertyId: sorts.length ? (data.properties[0]?.id ?? "title") : "title", dir: "asc" }])
        }
        className="flex h-8 items-center gap-2 self-start rounded-sm px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-4" />
        {t("db.addSort")}
      </button>
    </div>
  );
}

/* ---------- Visible properties ---------- */

export function PropertiesMenu({ data, view, onChange }: MenuProps) {
  const { t } = useI18n();
  const hidden = view.config.hidden ?? [];
  return (
    <div className="flex w-64 flex-col p-1">
      {data.properties.map((p) => {
        const off = hidden.includes(p.id);
        return (
          <button
            key={p.id}
            onClick={() => onChange({ hidden: off ? hidden.filter((h) => h !== p.id) : [...hidden, p.id] })}
            className="flex h-8 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent"
          >
            <PropertyIcon type={p.type} className="text-muted-foreground" />
            <span className={cn("flex-1 truncate", off && "text-muted-foreground")}>{p.name}</span>
            {off ? <EyeOff className="size-4 text-muted-foreground" /> : <Eye className="size-4" />}
          </button>
        );
      })}
      {!data.properties.length && <p className="px-2 py-2 text-sm text-muted-foreground">{t("db.properties")} —</p>}
    </div>
  );
}

/* ---------- Group by (board) ---------- */

export function GroupMenu({ data, view, onChange }: MenuProps) {
  const { t } = useI18n();
  const groupable = data.properties.filter((p) => p.type === "select" || p.type === "status");
  return (
    <div className="flex w-60 flex-col p-1">
      <span className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{t("db.groupBy")}</span>
      {groupable.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange({ groupBy: p.id })}
          className={cn(
            "flex h-8 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent",
            view.config.groupBy === p.id && "bg-accent font-medium",
          )}
        >
          <PropertyIcon type={p.type} className="text-muted-foreground" />
          {p.name}
        </button>
      ))}
      {!groupable.length && <p className="px-2 py-2 text-[13px] text-muted-foreground">{t("db.needSelect")}</p>}
    </div>
  );
}
