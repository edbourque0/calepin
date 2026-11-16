import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "@/components/ui";
import type { DatabaseData, Property, Row, SelectOption, View } from "@/lib/api";
import { propertyOptions, READ_ONLY_TYPES, useDatabaseActions, valuesFromFilters } from "@/lib/database";
import { useI18n } from "@/lib/i18n";
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
  return (prop: Property, option: SelectOption) =>
    actions.updateProperty.mutate({ propId: prop.id, options: [...propertyOptions(prop), option] });
}

export function TableView({
  data,
  view,
  rows,
  canEdit,
  onHideProperty,
}: {
  data: DatabaseData;
  view: View;
  rows: Row[];
  canEdit: boolean;
  onHideProperty: (id: string) => void;
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
            <th className="sticky left-0 z-[1] w-[280px] min-w-[280px] bg-background p-0 text-left font-normal">
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
