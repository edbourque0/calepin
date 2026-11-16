import { Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";
import type { DatabaseData, Row, View } from "@/lib/api";
import { useDatabaseActions, valuesFromFilters } from "@/lib/database";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CellValue } from "./cells";
import { PageIcon } from "@/components/PageIcon";

const GRID = {
  small: "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]",
  medium: "grid-cols-[repeat(auto-fill,minmax(240px,1fr))]",
  large: "grid-cols-[repeat(auto-fill,minmax(320px,1fr))]",
};
const COVER_H = { small: "h-28", medium: "h-36", large: "h-48" };

/** Cards with the first image of each row page as cover. */
export function GalleryView({
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
  const navigate = useNavigate();
  const actions = useDatabaseActions(data.database.id);
  const size = view.config.cardSize ?? "medium";
  const covers = view.config.cover !== "none";
  const shown = data.properties.filter((p) => !(view.config.hidden ?? []).includes(p.id));

  return (
    <div className={cn("grid gap-3", GRID[size])}>
      {rows.map((row) => (
        <article
          key={row.id}
          onClick={() => navigate(`/p/${row.id}`)}
          className="group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
        >
          {covers && (
            <div className={cn("relative shrink-0 overflow-hidden border-b border-border bg-muted", COVER_H[size])}>
              {row.cover ? (
                <img
                  src={row.cover}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-3xl text-muted-foreground/60">
                  <PageIcon icon={row.icon} size={30} className="opacity-70" />
                </div>
              )}
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1.5 p-2.5">
            <Link
              to={`/p/${row.id}`}
              onClick={(e) => e.stopPropagation()}
              className="flex min-w-0 items-center gap-1.5 text-sm font-medium"
            >
              {row.icon && !(covers && !row.cover) && <PageIcon icon={row.icon} size={14} />}
              <span className={cn("truncate", !row.title && "text-muted-foreground")}>
                {row.title || t("page.untitled")}
              </span>
            </Link>
            {shown.map((p) => {
              const v = row.props[p.id];
              if (v === null || v === undefined || v === false || (Array.isArray(v) && !v.length)) return null;
              return (
                <div key={p.id} className="flex min-w-0 overflow-hidden text-[13px]" title={p.name}>
                  <CellValue prop={p} row={row} data={data} />
                </div>
              );
            })}
          </div>
        </article>
      ))}
      {canEdit && (
        <button
          onClick={() => actions.addRow.mutate({ values: valuesFromFilters(view, data.properties) })}
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg border border-dashed border-border text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground",
            covers ? "min-h-48" : "min-h-20",
          )}
        >
          <Plus className="size-4" />
          {t("db.new")}
        </button>
      )}
    </div>
  );
}
