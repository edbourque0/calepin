import { FileText, Plus } from "lucide-react";
import { type DragEvent, useState } from "react";
import { Link } from "react-router";
import type { DatabaseData, Row, SelectOption, View } from "@/lib/api";
import { propertyOptions, useDatabaseActions, valuesFromFilters } from "@/lib/database";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CellValue, Tag } from "./cells";

export function BoardView({
  data,
  view,
  rows,
  canEdit,
}: {
  data: DatabaseData;
  view: View;
  rows: Row[];
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const actions = useDatabaseActions(data.database.id);
  const groupable = data.properties.filter((p) => p.type === "select" || p.type === "status");
  const group = groupable.find((p) => p.id === view.config.groupBy) ?? groupable[0];
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  if (!group)
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        {t("db.needSelect")}
      </div>
    );

  const hidden = view.config.hidden ?? [];
  const shown = data.properties.filter((p) => p.id !== group.id && !hidden.includes(p.id));
  const columns: { key: string; option: SelectOption | null }[] = [
    { key: "__none", option: null },
    ...propertyOptions(group).map((o) => ({ key: o.id, option: o })),
  ];
  const rowsFor = (key: string) =>
    rows.filter((r) => {
      const v = r.props[group.id] as string | null | undefined;
      return key === "__none" ? !v || !propertyOptions(group).some((o) => o.id === v) : v === key;
    });

  const drop = (key: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    if (!dragId) return;
    actions.updateRow.mutate({ rowId: dragId, values: { [group.id]: key === "__none" ? null : key } });
    setDragId(null);
  };

  const add = (key: string) =>
    actions.addRow.mutate({
      values: { ...valuesFromFilters(view, data.properties), ...(key === "__none" ? {} : { [group.id]: key }) },
    });

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {columns.map(({ key, option }) => {
        const items = rowsFor(key);
        if (key === "__none" && items.length === 0) return null;
        return (
          <section
            key={key}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOver(key);
            }}
            onDragLeave={() => setOver((o) => (o === key ? null : o))}
            onDrop={drop(key)}
            className={cn(
              "flex w-[272px] shrink-0 flex-col gap-2 rounded-lg p-1.5 transition-colors",
              over === key ? "bg-accent" : "bg-muted/50",
            )}
          >
            <header className="flex h-8 items-center gap-2 px-1.5">
              {option ? (
                <Tag option={option} />
              ) : (
                <span className="text-[13px] text-muted-foreground">{t("db.noValue", { name: group.name })}</span>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
            </header>
            {items.map((row) => (
              <article
                key={row.id}
                draggable={canEdit}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(row.id);
                }}
                onDragEnd={() => setDragId(null)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 shadow-sm transition-shadow hover:shadow-md",
                  dragId === row.id && "opacity-40",
                )}
              >
                <Link to={`/p/${row.id}`} className="flex items-start gap-1.5 text-sm font-medium hover:underline">
                  {row.icon ? (
                    <span className="leading-5">{row.icon}</span>
                  ) : (
                    <FileText className="mt-0.5 size-[14px] shrink-0 text-muted-foreground" />
                  )}
                  <span className={cn("min-w-0", !row.title && "text-muted-foreground")}>
                    {row.title || t("page.untitled")}
                  </span>
                </Link>
                {shown.map((p) => {
                  const v = row.props[p.id];
                  if (v === null || v === undefined || v === false || (Array.isArray(v) && !v.length)) return null;
                  return (
                    <div key={p.id} className="flex min-w-0 text-[13px]" title={p.name}>
                      <CellValue prop={p} row={row} data={data} />
                    </div>
                  );
                })}
              </article>
            ))}
            {canEdit && (
              <button
                onClick={() => add(key)}
                className="flex h-8 items-center gap-2 rounded-sm px-1.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-4" />
                {t("db.new")}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
