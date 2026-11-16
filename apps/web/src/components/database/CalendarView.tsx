import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { type DragEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, IconButton } from "@/components/ui";
import type { DatabaseData, Row, View } from "@/lib/api";
import {
  addDays,
  dateOfKey,
  datePropertyOf,
  daysBetween,
  keyOf,
  READ_ONLY_TYPES,
  rowSpan,
  shiftDate,
  useDatabaseActions,
  valuesFromFilters,
} from "@/lib/database";
import { localeOf, useI18n } from "@/lib/i18n";
import { cn, storage } from "@/lib/utils";
import { CellValue } from "./cells";
import { NeedsDate } from "./ViewSettings";
import { PageIcon } from "@/components/PageIcon";

/** Month grid; rows sit on their date (or span start → end). Drag a row to another day to move it. */
export function CalendarView({
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
  const { t, lang } = useI18n();
  const locale = localeOf(lang);
  const actions = useDatabaseActions(data.database.id);
  const navigate = useNavigate();
  const monthStore = useMemo(() => storage<string | null>(`cal:${view.id}`, null), [view.id]);
  const [month, setMonthState] = useState(() => monthStore.get() ?? keyOf(new Date()).slice(0, 7));
  const setMonth = (m: string) => {
    monthStore.set(m);
    setMonthState(m);
  };
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const dateProp = datePropertyOf(view, data.properties);
  const endProp = data.properties.find((p) => p.id === view.config.endDateProperty && p.id !== dateProp?.id);
  const movable = canEdit && !!dateProp && !READ_ONLY_TYPES.includes(dateProp.type);
  const weekStartsMonday = lang === "fr";

  const first = dateOfKey(`${month}-01`);
  const offset = (first.getDay() - (weekStartsMonday ? 1 : 0) + 7) % 7;
  const gridStart = addDays(`${month}-01`, -offset);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  const today = keyOf(new Date());

  const spans = useMemo(
    () =>
      rows
        .map((row) => ({ row, span: dateProp ? rowSpan(row, dateProp.id, endProp?.id) : null }))
        .filter((x): x is { row: Row; span: { start: string; end: string } } => !!x.span),
    [rows, dateProp, endProp],
  );
  const unscheduled = rows.length - spans.length;
  const byDay = (day: string) => spans.filter(({ span }) => span.start <= day && span.end >= day);

  if (!dateProp) return <NeedsDate />;

  const shownProps = data.properties.filter(
    (p) => p.id !== dateProp.id && p.id !== endProp?.id && !(view.config.hidden ?? []).includes(p.id),
  );

  const moveMonth = (n: number) => {
    const d = dateOfKey(`${month}-01`);
    d.setMonth(d.getMonth() + n);
    setMonth(keyOf(d).slice(0, 7));
  };

  const drop = (day: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const item = spans.find((s) => s.row.id === dragId);
    setDragId(null);
    if (!item || !movable) return;
    const delta = daysBetween(item.span.start, day);
    if (!delta) return;
    const values: Record<string, unknown> = { [dateProp.id]: shiftDate(item.row.props[dateProp.id], delta) };
    if (endProp && !READ_ONLY_TYPES.includes(endProp.type) && item.row.props[endProp.id])
      values[endProp.id] = shiftDate(item.row.props[endProp.id], delta);
    actions.updateRow.mutate({ rowId: item.row.id, values });
  };

  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    dateOfKey(days[i]!).toLocaleDateString(locale, { weekday: "short" }),
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="heading text-base capitalize">
          {first.toLocaleDateString(locale, { month: "long", year: "numeric" })}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {unscheduled > 0 && (
            <span className="mr-2 text-xs text-muted-foreground">{t("db.unscheduled", { n: unscheduled })}</span>
          )}
          <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>
            {t("db.today")}
          </Button>
          <IconButton label={t("db.previous")} onClick={() => moveMonth(-1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label={t("db.next")} onClick={() => moveMonth(1)}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px] overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-7 border-b border-border bg-muted/50">
            {weekdayNames.map((n) => (
              <div key={n} className="caps-label px-2 py-1.5">
                {n}
              </div>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b border-border last:border-b-0">
              {week.map((day) => {
                const items = byDay(day);
                const inMonth = day.startsWith(month);
                return (
                  <div
                    key={day}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      setOver(day);
                    }}
                    onDragLeave={() => setOver((o) => (o === day ? null : o))}
                    onDrop={drop(day)}
                    className={cn(
                      "group/day flex min-h-28 min-w-0 flex-col gap-1 border-r border-border p-1 last:border-r-0",
                      !inMonth && "bg-muted/40",
                      over === day && "bg-accent",
                    )}
                  >
                    <div className="flex h-6 items-center justify-between px-1">
                      {movable ? (
                        <button
                          aria-label={t("db.new")}
                          onClick={() =>
                            actions.addRow.mutate({
                              values: { ...valuesFromFilters(view, data.properties), [dateProp.id]: day },
                            })
                          }
                          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover/day:opacity-100 hover:bg-accent focus-visible:opacity-100"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      ) : (
                        <span />
                      )}
                      <span
                        className={cn(
                          "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums",
                          day === today
                            ? "bg-ribbon font-semibold text-ribbon-foreground"
                            : inMonth
                              ? "text-foreground"
                              : "text-muted-foreground",
                        )}
                      >
                        {Number(day.slice(8))}
                      </span>
                    </div>
                    {items.map(({ row, span }) => (
                      <div
                        key={row.id}
                        role="link"
                        tabIndex={0}
                        onClick={() => navigate(`/p/${row.id}`)}
                        onKeyDown={(e) => e.key === "Enter" && navigate(`/p/${row.id}`)}
                        draggable={movable}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(row.id);
                        }}
                        onDragEnd={() => setDragId(null)}
                        className={cn(
                          "flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border border-border bg-card px-1.5 py-1 text-xs shadow-xs hover:bg-accent",
                          span.start !== span.end && day !== span.start && "border-dashed",
                          dragId === row.id && "opacity-40",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1 font-medium">
                          <PageIcon icon={row.icon} size={12} />
                          <span className={cn("truncate", !row.title && "text-muted-foreground")}>
                            {row.title || t("page.untitled")}
                          </span>
                        </span>
                        {day === span.start &&
                          shownProps.slice(0, 2).map((p) => {
                            const v = row.props[p.id];
                            if (v === null || v === undefined || v === false || (Array.isArray(v) && !v.length))
                              return null;
                            return (
                              <span key={p.id} className="flex min-w-0 overflow-hidden" title={p.name}>
                                <CellValue prop={p} row={row} data={data} />
                              </span>
                            );
                          })}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
