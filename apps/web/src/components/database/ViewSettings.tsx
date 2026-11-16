import { CalendarX } from "lucide-react";
import type { ReactNode } from "react";
import type { DatabaseData, View, ViewConfig } from "@/lib/api";
import { DATE_TYPES, datePropertyOf } from "@/lib/database";
import { useI18n } from "@/lib/i18n";

const selectCls = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Shown by calendar and timeline views when the database has no date property. */
export function NeedsDate() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      <CalendarX className="size-5" />
      {t("db.needDate")}
    </div>
  );
}

/** Layout options of the current view: date properties (calendar, timeline) or covers (gallery). */
export function LayoutMenu({
  data,
  view,
  onChange,
}: {
  data: DatabaseData;
  view: View;
  onChange: (c: ViewConfig) => void;
}) {
  const { t } = useI18n();
  const dates = data.properties.filter((p) => DATE_TYPES.includes(p.type));
  const start = datePropertyOf(view, data.properties);

  return (
    <div className="flex w-64 flex-col gap-3 p-2">
      {(view.type === "calendar" || view.type === "timeline") &&
        (dates.length === 0 ? (
          <div className="text-[13px] text-muted-foreground">{t("db.needDate")}</div>
        ) : (
          <>
            <Field label={t("db.dateProperty")}>
              <select
                value={start?.id ?? ""}
                onChange={(e) => onChange({ dateProperty: e.target.value })}
                className={selectCls}
              >
                {dates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("db.endDateProperty")}>
              <select
                value={view.config.endDateProperty ?? ""}
                onChange={(e) => onChange({ endDateProperty: e.target.value || null })}
                className={selectCls}
              >
                <option value="">{t("db.none")}</option>
                {dates
                  .filter((p) => p.id !== start?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
          </>
        ))}
      {view.type === "gallery" && (
        <>
          <Field label={t("db.cover")}>
            <select
              value={view.config.cover ?? "content"}
              onChange={(e) => onChange({ cover: e.target.value as ViewConfig["cover"] })}
              className={selectCls}
            >
              <option value="content">{t("db.coverContent")}</option>
              <option value="none">{t("db.none")}</option>
            </select>
          </Field>
          <Field label={t("db.cardSize")}>
            <select
              value={view.config.cardSize ?? "medium"}
              onChange={(e) => onChange({ cardSize: e.target.value as ViewConfig["cardSize"] })}
              className={selectCls}
            >
              <option value="small">{t("db.sizeSmall")}</option>
              <option value="medium">{t("db.sizeMedium")}</option>
              <option value="large">{t("db.sizeLarge")}</option>
            </select>
          </Field>
        </>
      )}
    </div>
  );
}
