import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui";
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
} from "@/lib/database";
import { localeOf, useI18n } from "@/lib/i18n";
import { cn, storage } from "@/lib/utils";
import { NeedsDate } from "./ViewSettings";
import { PageIcon } from "@/components/PageIcon";

type Scale = "day" | "week" | "month";
const DAY_PX: Record<Scale, number> = { day: 40, week: 18, month: 5 };
const ROW_H = 36;

type Drag = { rowId: string; mode: "move" | "end"; x0: number; delta: number };

/** Gantt-like timeline: one bar per row from its start to its end date. Drag to move, drag the edge to resize. */
export function TimelineView({
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
  const scaleStore = useMemo(() => storage<Scale>(`timeline:${view.id}`, "week"), [view.id]);
  const [scale, setScaleState] = useState<Scale>(scaleStore.get);
  const setScale = (s: Scale) => {
    scaleStore.set(s);
    setScaleState(s);
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const dateProp = datePropertyOf(view, data.properties);
  const endProp = data.properties.find((p) => p.id === view.config.endDateProperty && p.id !== dateProp?.id);
  const movable = canEdit && !!dateProp && !READ_ONLY_TYPES.includes(dateProp.type);
  const resizable = canEdit && !!endProp && !READ_ONLY_TYPES.includes(endProp.type);
  const px = DAY_PX[scale];
  const today = keyOf(new Date());

  const items = useMemo(
    () => rows.map((row) => ({ row, span: dateProp ? rowSpan(row, dateProp.id, endProp?.id) : null })),
    [rows, dateProp, endProp],
  );

  const { rangeStart, totalDays } = useMemo(() => {
    let min = addDays(today, -30);
    let max = addDays(today, 60);
    for (const { span } of items) {
      if (!span) continue;
      if (span.start < min) min = span.start;
      if (span.end > max) max = span.end;
    }
    // Start on a Monday-ish boundary for tidy headers.
    const start = addDays(min, -14 - ((dateOfKey(min).getDay() + 6) % 7));
    return { rangeStart: start, totalDays: daysBetween(start, addDays(max, 30)) };
  }, [items, today]);

  // Open on today.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, daysBetween(rangeStart, today) * px - el.clientWidth / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, view.id]);

  if (!dateProp) return <NeedsDate />;

  const days = Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i));
  const months: { key: string; from: number; count: number }[] = [];
  days.forEach((d, i) => {
    const k = d.slice(0, 7);
    if (months.at(-1)?.key === k) months.at(-1)!.count++;
    else months.push({ key: k, from: i, count: 1 });
  });

  const startDrag = (e: ReactPointerEvent, rowId: string, mode: Drag["mode"]) => {
    if (mode === "move" ? !movable : !resizable) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ rowId, mode, x0: e.clientX, delta: 0 });
  };
  const moveDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.x0) / px);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  };
  const endDrag = () => {
    if (!drag) return;
    const item = items.find((i) => i.row.id === drag.rowId);
    const moved = Math.abs(drag.delta) > 0;
    setDrag(null);
    if (!item?.span || !moved) {
      // A click without movement opens the row.
      return;
    }
    const values: Record<string, unknown> = {};
    if (drag.mode === "move") {
      values[dateProp.id] = shiftDate(item.row.props[dateProp.id], drag.delta);
      if (resizable && item.row.props[endProp!.id])
        values[endProp!.id] = shiftDate(item.row.props[endProp!.id], drag.delta);
    } else {
      const end = addDays(item.span.end, drag.delta);
      values[endProp!.id] = end < item.span.start ? item.span.start : end;
    }
    actions.updateRow.mutate({ rowId: drag.rowId, values });
  };

  const schedule = (row: Row, e: React.MouseEvent<HTMLDivElement>) => {
    if (!movable) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const day = addDays(rangeStart, Math.floor(x / px));
    actions.updateRow.mutate({ rowId: row.id, values: { [dateProp.id]: day } });
  };

  const width = totalDays * px;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTo({ left: daysBetween(rangeStart, today) * px - el.clientWidth / 3, behavior: "smooth" });
          }}
        >
          {t("db.today")}
        </Button>
        <div className="flex rounded-md border border-border p-0.5">
          {(["day", "week", "month"] as Scale[]).map((s) => (
            <button
              key={s}
              onClick={() => setScale(s)}
              className={cn(
                "h-7 rounded-[5px] px-2.5 text-xs font-medium",
                scale === s ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`db.scale.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex overflow-hidden rounded-lg border border-border">
        {/* Row names */}
        <div className="w-44 shrink-0 border-r border-border bg-background sm:w-56">
          <div className="h-14 border-b border-border bg-muted/50" />
          {items.map(({ row }) => (
            <Link
              key={row.id}
              to={`/p/${row.id}`}
              style={{ height: ROW_H }}
              className="flex items-center gap-1.5 border-b border-border px-2.5 text-[13px] last:border-b-0 hover:bg-accent"
            >
              <PageIcon icon={row.icon} size={14} />
              <span className={cn("truncate", !row.title && "text-muted-foreground")}>
                {row.title || t("page.untitled")}
              </span>
            </Link>
          ))}
        </div>
        {/* Time grid */}
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width }} className="relative">
            <div className="sticky top-0 z-10 h-14 border-b border-border bg-muted/50">
              <div className="relative h-7">
                {months.map((m) => (
                  <div
                    key={m.key}
                    style={{ left: m.from * px, width: m.count * px }}
                    className="absolute top-0 flex h-7 items-center truncate border-l border-border px-2 text-xs font-medium capitalize first:border-l-0"
                  >
                    {dateOfKey(`${m.key}-01`).toLocaleDateString(locale, {
                      month: scale === "month" ? "short" : "long",
                      year: "numeric",
                    })}
                  </div>
                ))}
              </div>
              <div className="relative h-7">
                {days.map((d, i) => {
                  const dow = dateOfKey(d).getDay();
                  const show =
                    scale === "day" || (scale === "week" && dow === 1) || (scale === "month" && d.endsWith("-01"));
                  if (!show) return null;
                  return (
                    <div
                      key={d}
                      style={{ left: i * px }}
                      className={cn(
                        "absolute top-0 flex h-7 items-center pl-1 text-[11px] text-muted-foreground tabular-nums",
                        d === today && "font-semibold text-ribbon",
                      )}
                    >
                      {Number(d.slice(8))}
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Weekends and today */}
            <div className="pointer-events-none absolute inset-x-0 top-14 bottom-0">
              {scale !== "month" &&
                days.map((d, i) =>
                  [0, 6].includes(dateOfKey(d).getDay()) ? (
                    <div key={d} style={{ left: i * px, width: px }} className="absolute inset-y-0 bg-muted/40" />
                  ) : null,
                )}
              <div
                style={{ left: daysBetween(rangeStart, today) * px + px / 2 }}
                className="absolute inset-y-0 w-px bg-ribbon"
              />
            </div>
            {items.map(({ row, span }) => {
              const d = drag?.rowId === row.id ? drag : null;
              let start = span?.start;
              let end = span?.end;
              if (span && d) {
                if (d.mode === "move") {
                  start = addDays(span.start, d.delta);
                  end = addDays(span.end, d.delta);
                } else {
                  end = addDays(span.end, d.delta);
                  if (end < span.start) end = span.start;
                }
              }
              return (
                <div
                  key={row.id}
                  style={{ height: ROW_H }}
                  onClick={(e) => !span && schedule(row, e)}
                  className={cn(
                    "relative border-b border-border last:border-b-0",
                    !span && movable && "cursor-copy hover:bg-accent/50",
                  )}
                  title={!span && movable ? t("db.clickToSchedule") : undefined}
                >
                  {start &&
                    end &&
                    (() => {
                      const left = daysBetween(rangeStart, start) * px;
                      const w = Math.max(px, (daysBetween(start, end) + 1) * px);
                      const outside = w < 96;
                      return (
                        <>
                          <div
                            onPointerDown={(e) => startDrag(e, row.id, "move")}
                            onPointerMove={moveDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={() => setDrag(null)}
                            style={{ left, width: w }}
                            className={cn(
                              "group/bar absolute top-1.5 flex h-6 items-center overflow-hidden rounded-md border border-ribbon/40 bg-ribbon-soft px-2 text-xs font-medium text-foreground shadow-xs select-none",
                              movable && "cursor-grab active:cursor-grabbing",
                              d && "shadow-md ring-2 ring-ring/30",
                            )}
                          >
                            {!outside && <span className="truncate">{row.title || t("page.untitled")}</span>}
                            {resizable && (
                              <span
                                onPointerDown={(e) => startDrag(e, row.id, "end")}
                                className="absolute inset-y-0 right-0 w-2 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 hover:bg-ribbon/30"
                              />
                            )}
                          </div>
                          {outside && (
                            <span
                              style={{ left: left + w + 6 }}
                              className="pointer-events-none absolute top-1.5 flex h-6 items-center text-xs whitespace-nowrap text-muted-foreground"
                            >
                              {row.title || t("page.untitled")}
                            </span>
                          )}
                        </>
                      );
                    })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
