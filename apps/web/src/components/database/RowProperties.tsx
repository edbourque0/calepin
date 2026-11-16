import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "@/components/ui";
import { useDatabase, useDatabaseActions } from "@/lib/database";
import { useI18n } from "@/lib/i18n";
import { EditableValue, PropertyIcon } from "./cells";
import { AddPropertyMenu, PropertyMenu } from "./PropertyMenu";
import { useOptionAdder } from "./TableView";

/** Property values of a database row, shown above the row page's content. */
export function RowProperties({ databaseId, rowId }: { databaseId: string; rowId: string }) {
  const { t } = useI18n();
  const { data } = useDatabase(databaseId);
  const actions = useDatabaseActions(databaseId);
  const [menu, setMenu] = useState<string | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const addOption = useOptionAdder(databaseId);
  if (!data) return <div className="h-24" />;
  const row = data.rows.find((r) => r.id === rowId);
  if (!row) return null;
  const canEdit = data.role !== "viewer";
  const menuProp = data.properties.find((p) => p.id === menu);

  return (
    <div className="mt-4 flex flex-col gap-0.5 border-b border-border pb-4">
      {data.properties.map((p) => (
        <div key={p.id} className="flex min-h-9 items-start gap-2">
          <button
            disabled={!canEdit}
            onClick={(e) => {
              anchor.current = e.currentTarget;
              setMenu(p.id);
            }}
            className="flex h-9 w-40 shrink-0 items-center gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-accent disabled:hover:bg-transparent max-sm:w-32"
          >
            <PropertyIcon type={p.type} />
            <span className="truncate">{p.name}</span>
          </button>
          <div className="min-w-0 flex-1 text-sm">
            <EditableValue
              variant="field"
              prop={p}
              row={row}
              data={data}
              canEdit={canEdit}
              onAddOption={addOption}
              onChange={(value) => actions.updateRow.mutate({ rowId, values: { [p.id]: value } })}
            />
          </div>
        </div>
      ))}
      {canEdit && (
        <button
          ref={addRef}
          onClick={() => setAdding(true)}
          className="flex h-8 items-center gap-2 self-start rounded-sm px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" />
          {t("db.addProperty")}
        </button>
      )}
      <Popover anchor={addRef} open={adding} onClose={() => setAdding(false)}>
        <AddPropertyMenu data={data} onClose={() => setAdding(false)} />
      </Popover>
      {menuProp && (
        <Popover anchor={anchor} open onClose={() => setMenu(null)}>
          <PropertyMenu key={menuProp.id} data={data} prop={menuProp} onClose={() => setMenu(null)} />
        </Popover>
      )}
    </div>
  );
}
