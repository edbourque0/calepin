import { Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "@/components/ui";
import type { DatabaseData, Property, Row, SelectOption, View } from "@/lib/api";
import { READ_ONLY_TYPES, useDatabaseActions, valuesFromFilters } from "@/lib/database";
import { type CalcFn, calcsFor, calculate } from "@/lib/calc";
import { localeOf, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { EditableValue, PropertyIcon, TitleCell } from "./cells";
import { AddPropertyMenu, PropertyMenu } from "./PropertyMenu";

/** Column width by type, before any resizing. */
const widthOf = (p: Property) =>
  p.type === "checkbox"
    ? 90
    : p.type === "number" || p.type === "date"
      ? 150
      : p.type === "multi_select" || p.type === "relation"
        ? 240
        : 190;

export function useOptionAdder(databaseId: string) {
  const actions = useDatabaseActions(databaseId);
  // Resolves once the server knows the option, so the row value set next refers to an existing option.
  return (prop: Property, option: SelectOption) =>
    actions.updateProperty.mutateAsync({ propId: prop.id, addOptions: [option] });
}

export function TableView({
  data,
  view,
  rows,
  canEdit,
  onHideProperty,
  onCalculation,
}: {
  data: DatabaseData;
  view: View;
  rows: Row[];
  canEdit: boolean;
  onHideProperty: (id: string) => void;
  onCalculation: (columnId: string, fn: CalcFn | null) => void;
}) {
  const { t } = useI18n();
  const actions = useDatabaseActions(data.database.id);
  const addOption = useOptionAdder(data.database.id);
  const hidden = view.config.hidden ?? [];
  const columns = data.properties.filter((p) => !hidden.includes(p.id));
  const [menu, setMenu] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newRowId, setNewRowId] = useState<string | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const menuProp = data.properties.find((p) => p.id === menu);

  const addRow = async () => {
    const row = await actions.addRow.mutateAsync({ values: valuesFromFilters(view, data.properties) });
    setNewRowId(row.id);
  };

  return (
    <div className="overflow-x-auto pb-2">
      {menuProp && (
        <Popover anchor={menuAnchor} open onClose={() => setMenu(null)}>
          <PropertyMenu
            key={menuProp.id}
            data={data}
            prop={menuProp}
            onHide={() => onHideProperty(menuProp.id)}
            onClose={() => setMenu(null)}
          />
        </Popover>
      )}
      <table className="w-max min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 z-[1] w-[160px] min-w-[160px] bg-background p-0 text-left font-normal sm:w-[280px] sm:min-w-[280px]">
              <span className="flex h-[34px] items-center gap-1.5 px-2 text-[13px] text-muted-foreground">
                <PropertyIcon type="title" />
                {t("db.titleColumn")}
              </span>
            </th>
            {columns.map((p) => (
              <th
                key={p.id}
                className="border-l border-border p-0 text-left font-normal"
                style={{ width: widthOf(p), minWidth: widthOf(p) }}
              >
                <button
                  disabled={!canEdit}
                  onClick={(e) => {
                    menuAnchor.current = e.currentTarget;
                    setMenu(p.id);
                  }}
                  className="flex h-[34px] w-full items-center gap-1.5 px-2 text-[13px] whitespace-nowrap text-muted-foreground hover:bg-accent disabled:hover:bg-transparent"
                >
                  <PropertyIcon type={p.type} />
                  <span className="truncate">{p.name}</span>
                </button>
              </th>
            ))}
            {canEdit && (
              <th className="w-10 border-l border-border p-0">
                <button
                  ref={addRef}
                  aria-label={t("db.addProperty")}
                  title={t("db.addProperty")}
                  onClick={() => setAdding(true)}
                  className="flex h-[34px] w-10 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-4" />
                </button>
                <Popover anchor={addRef} open={adding} onClose={() => setAdding(false)} align="end">
                  <AddPropertyMenu data={data} onClose={() => setAdding(false)} />
                </Popover>
              </th>
            )}
            <th className="w-full p-0" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group/row border-b border-border hover:bg-accent/50">
              <td className="sticky left-0 z-[1] bg-background p-0 align-top group-hover/row:bg-[color-mix(in_oklch,var(--accent)_50%,var(--background))]">
                <TitleCell
                  row={row}
                  canEdit={canEdit}
                  autoEdit={row.id === newRowId}
                  onRename={(title) => actions.updateRow.mutate({ rowId: row.id, title })}
                >
                  {canEdit && (
                    <button
                      aria-label={t("db.deleteRow")}
                      title={t("db.deleteRow")}
                      onClick={() => actions.deleteRow.mutate(row.id)}
                      className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover/title:opacity-100 hover:bg-accent hover:text-destructive focus-visible:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </TitleCell>
              </td>
              {columns.map((p) => (
                <td
                  key={p.id}
                  className={cn(
                    "border-l border-border p-0 align-top",
                    READ_ONLY_TYPES.includes(p.type) && "bg-muted/40",
                  )}
                >
                  <EditableValue
                    prop={p}
                    row={row}
                    data={data}
                    canEdit={canEdit}
                    onAddOption={addOption}
                    onChange={(value) => actions.updateRow.mutate({ rowId: row.id, values: { [p.id]: value } })}
                  />
                </td>
              ))}
              {canEdit && <td className="border-l border-border" />}
              <td />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="group/calc">
            <td className="sticky left-0 z-[1] bg-background p-0">
              <CalcCell column="title" view={view} rows={rows} canEdit={canEdit} onChange={onCalculation} />
            </td>
            {columns.map((p) => (
              <td key={p.id} className="p-0">
                <CalcCell column={p} view={view} rows={rows} canEdit={canEdit} onChange={onCalculation} />
              </td>
            ))}
            {canEdit && <td />}
            <td />
          </tr>
        </tfoot>
      </table>
      {canEdit && (
        <button
          onClick={addRow}
          className="sticky left-0 flex h-9 items-center gap-2 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-4" />
          {t("db.newRow")}
        </button>
      )}
    </div>
  );
}

/** A cell of the totals row: the chosen calculation, or "Calculate" on hover to pick one. */
function CalcCell({
  column,
  view,
  rows,
  canEdit,
  onChange,
}: {
  column: Property | "title";
  view: View;
  rows: Row[];
  canEdit: boolean;
  onChange: (columnId: string, fn: CalcFn | null) => void;
}) {
  const { t, lang } = useI18n();
  const id = column === "title" ? "title" : column.id;
  const fn = view.config.calculations?.[id] ?? null;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const groups = calcsFor(column, rows);
  const valid = fn && groups.flat().includes(fn) ? fn : null;
  if (!valid && !canEdit) return <div className="h-8" />;

  return (
    <>
      <button
        ref={ref}
        disabled={!canEdit}
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-8 w-full items-center justify-end gap-1.5 px-2 text-[13px] whitespace-nowrap hover:bg-accent disabled:hover:bg-transparent",
          !valid && "opacity-0 group-hover/calc:opacity-100 focus-visible:opacity-100",
          open && "opacity-100",
        )}
      >
        {valid ? (
          <>
            <span className="caps-label">{t(`calc.short.${valid}`)}</span>
            <span className="font-medium tabular-nums">{calculate(valid, column, rows, localeOf(lang))}</span>
          </>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground">
            {t("calc.calculate")}
            <ChevronDown className="size-3" />
          </span>
        )}
      </button>
      <Popover
        anchor={ref}
        open={open}
        onClose={() => setOpen(false)}
        align="end"
        className="max-h-80 w-56 overflow-y-auto"
      >
        {[[null] as (CalcFn | null)[], ...groups].map((group, i) => (
          <div key={i} className={cn("flex flex-col", i > 0 && "mt-1 border-t border-border pt-1")}>
            {group.map((g) => (
              <button
                key={g ?? "none"}
                onClick={() => {
                  onChange(id, g);
                  setOpen(false);
                }}
                className="flex h-8 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent"
              >
                <span className="flex-1">{t(g ? `calc.${g}` : "calc.none")}</span>
                {g !== null && rows.length > 0 && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {calculate(g, column, rows, localeOf(lang))}
                  </span>
                )}
                {(valid ?? null) === g && <Check className="size-3.5" />}
              </button>
            ))}
          </div>
        ))}
      </Popover>
    </>
  );
}
