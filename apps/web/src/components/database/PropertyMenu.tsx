import { useQuery } from "@tanstack/react-query";
import { EyeOff, Plus, Trash2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui";
import { api, type DatabaseData, type Property, type PropertyType, type RollupFn, type SelectOption } from "@/lib/api";
import { propertyOptions, TYPE_ORDER, useDatabaseActions } from "@/lib/database";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { usePages } from "@/lib/workspace";
import { PropertyIcon, TAG_COLORS } from "./cells";
import { FormulaEditor } from "./FormulaEditor";
import { iconText } from "@/lib/icons";

const ROLLUP_FNS: RollupFn[] = [
  "count",
  "count_values",
  "count_unique",
  "sum",
  "average",
  "min",
  "max",
  "show_original",
  "percent_checked",
  "earliest",
  "latest",
];

const selectCls = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Options editor for select-like properties: rename, recolour, delete, add. */
function OptionsEditor({ options, onChange }: { options: SelectOption[]; onChange: (o: SelectOption[]) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const add = () => {
    if (!name.trim()) return;
    onChange([
      ...options,
      {
        id: Math.random().toString(36).slice(2, 10),
        name: name.trim(),
        color: TAG_COLORS[options.length % TAG_COLORS.length]!,
      },
    ]);
    setName("");
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{t("db.options")}</span>
      {options.map((o, i) => (
        <div key={o.id} className="flex items-center gap-1.5">
          <button
            type="button"
            title={o.color}
            aria-label={o.color}
            onClick={() => {
              const next = TAG_COLORS[(TAG_COLORS.indexOf(o.color) + 1) % TAG_COLORS.length]!;
              onChange(options.map((x, j) => (j === i ? { ...x, color: next } : x)));
            }}
            className={cn("size-5 shrink-0 rounded-[5px]", `tag-${o.color}`)}
          />
          <input
            defaultValue={o.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== o.name) onChange(options.map((x, j) => (j === i ? { ...x, name: v } : x)));
            }}
            className="h-7 min-w-0 flex-1 rounded-sm bg-transparent px-1.5 text-sm hover:bg-accent focus:bg-background"
          />
          <button
            type="button"
            aria-label="Delete"
            onClick={() => onChange(options.filter((_, j) => j !== i))}
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <Plus className="ml-1 size-4 text-muted-foreground" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={t("db.searchOrCreate")}
          className="h-7 min-w-0 flex-1 rounded-sm bg-transparent px-1.5 text-sm placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

function RollupFields({
  data,
  config,
  onChange,
}: {
  data: DatabaseData;
  config: { relationPropertyId?: string; targetPropertyId?: string; fn?: RollupFn };
  onChange: (c: { relationPropertyId?: string; targetPropertyId?: string; fn?: RollupFn }) => void;
}) {
  const { t } = useI18n();
  const relations = data.properties.filter((p) => p.type === "relation");
  const relation = relations.find((r) => r.id === config.relationPropertyId);
  const target = useQuery({
    queryKey: ["db", relation?.config.databaseId],
    queryFn: () => api.get<DatabaseData>(`/databases/${relation!.config.databaseId}`),
    enabled: !!relation,
  });
  if (!relations.length) return <div className="text-[13px] text-muted-foreground">{t("type.relation")} ?</div>;
  return (
    <>
      <Field label={t("db.rollupRelation")}>
        <select
          value={config.relationPropertyId ?? ""}
          onChange={(e) => onChange({ ...config, relationPropertyId: e.target.value, targetPropertyId: "title" })}
          className={selectCls}
        >
          <option value="" disabled>
            —
          </option>
          {relations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      {relation && (
        <Field label={t("db.rollupProperty")}>
          <select
            value={config.targetPropertyId ?? "title"}
            onChange={(e) => onChange({ ...config, targetPropertyId: e.target.value })}
            className={selectCls}
          >
            <option value="title">{t("db.titleColumn")}</option>
            {target.data?.properties
              .filter((p) => p.type !== "rollup" && p.type !== "relation" && p.type !== "formula")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      <Field label={t("db.rollupFn")}>
        <select
          value={config.fn ?? "count"}
          onChange={(e) => onChange({ ...config, fn: e.target.value as RollupFn })}
          className={selectCls}
        >
          {ROLLUP_FNS.map((f) => (
            <option key={f} value={f}>
              {t(`fn.${f}`)}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

/** Popover content for a column header: rename, change type, options, hide, delete. */
export function PropertyMenu({
  data,
  prop,
  onHide,
  onClose,
}: {
  data: DatabaseData;
  prop: Property;
  onHide?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const actions = useDatabaseActions(data.database.id);
  const [name, setName] = useState(prop.name);
  const structural = prop.type === "relation" || prop.type === "rollup" || prop.type === "formula";
  const related = data.related.find((r) => r.id === prop.config.databaseId);

  const saveName = () => {
    if (name.trim() && name.trim() !== prop.name) actions.updateProperty.mutate({ propId: prop.id, name: name.trim() });
  };

  return (
    <div
      className={cn("flex flex-col gap-3 p-2", prop.type === "formula" ? "w-[26rem] max-w-[calc(100vw-2rem)]" : "w-72")}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            saveName();
            onClose();
          }
        }}
        aria-label={t("db.propertyName")}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs"
      />
      <Field label={t("db.changeType")}>
        <select
          value={prop.type}
          disabled={structural}
          onChange={(e) => actions.updateProperty.mutate({ propId: prop.id, type: e.target.value as PropertyType })}
          className={selectCls}
        >
          {TYPE_ORDER.filter((tp) => structural || (tp !== "relation" && tp !== "rollup" && tp !== "formula")).map(
            (tp) => (
              <option key={tp} value={tp}>
                {t(`type.${tp}`)}
              </option>
            ),
          )}
        </select>
      </Field>
      {(prop.type === "select" || prop.type === "multi_select" || prop.type === "status") && (
        <OptionsEditor
          options={propertyOptions(prop)}
          onChange={(o) => actions.updateProperty.mutate({ propId: prop.id, options: o })}
        />
      )}
      {prop.type === "number" && (
        <Field label={t("db.format")}>
          <select
            value={prop.config.format ?? "number"}
            onChange={(e) => actions.updateProperty.mutate({ propId: prop.id, config: { format: e.target.value } })}
            className={selectCls}
          >
            <option value="number">{t("db.formatNumber")}</option>
            <option value="percent">{t("db.formatPercent")}</option>
            <option value="dollar">{t("db.formatDollar")}</option>
          </select>
        </Field>
      )}
      {prop.type === "relation" && (
        <div className="text-[13px] text-muted-foreground">
          {t("db.relatedTo")} : <span className="text-foreground">{related?.title || t("page.untitled")}</span>
        </div>
      )}
      {prop.type === "rollup" && (
        <RollupFields
          data={data}
          config={prop.config}
          onChange={(c) => actions.updateProperty.mutate({ propId: prop.id, config: c })}
        />
      )}
      {prop.type === "formula" && (
        <FormulaEditor
          data={data}
          propertyId={prop.id}
          initial={prop.config.expression ?? ""}
          saving={actions.updateProperty.isPending}
          submitLabel={t("db.saveFormula")}
          onSave={(expression) => {
            saveName();
            actions.updateProperty.mutate({ propId: prop.id, config: { expression } }, { onSuccess: onClose });
          }}
        />
      )}
      <div className="-mx-2 border-t border-border px-1 pt-1">
        {onHide && (
          <button
            onClick={() => {
              onHide();
              onClose();
            }}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent"
          >
            <EyeOff className="size-4 text-muted-foreground" />
            {t("db.hide")}
          </button>
        )}
        <button
          onClick={() => {
            if (!confirm(t("db.deletePropertyConfirm", { name: prop.name }))) return;
            actions.deleteProperty.mutate(prop.id);
            onClose();
          }}
          className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm text-destructive hover:bg-accent"
        >
          <Trash2 className="size-4" />
          {t("db.deleteProperty")}
        </button>
      </div>
    </div>
  );
}

/** Popover content for "+" in the header: name, type, and the extra settings some types need. */
export function AddPropertyMenu({ data, onClose }: { data: DatabaseData; onClose: () => void }) {
  const { t } = useI18n();
  const actions = useDatabaseActions(data.database.id);
  const { data: pages = [] } = usePages();
  const [type, setType] = useState<PropertyType>("text");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [twoWay, setTwoWay] = useState(true);
  const [rollup, setRollup] = useState<{ relationPropertyId?: string; targetPropertyId?: string; fn?: RollupFn }>({});
  const databases = pages.filter((p) => p.type === "database");

  const ready = type === "relation" ? !!target : type === "rollup" ? !!rollup.relationPropertyId : true;
  const create = async () => {
    const config =
      type === "relation"
        ? { databaseId: target, twoWay }
        : type === "rollup"
          ? { fn: "count", targetPropertyId: "title", ...rollup }
          : undefined;
    await actions.addProperty.mutateAsync({ name: name.trim() || t(`type.${type}`), type, config });
    onClose();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && type !== "formula") create();
      }}
      className={cn("flex flex-col gap-3 p-2", type === "formula" ? "w-[26rem] max-w-[calc(100vw-2rem)]" : "w-80")}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("db.propertyName")}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs placeholder:text-muted-foreground"
      />
      <div className="grid grid-cols-2 gap-0.5">
        {TYPE_ORDER.map((tp) => (
          <button
            type="button"
            key={tp}
            onClick={() => setType(tp)}
            className={cn(
              "flex h-8 items-center gap-2 rounded-sm px-2 text-left text-[13px] hover:bg-accent [&_svg]:text-muted-foreground",
              type === tp && "bg-accent font-medium",
            )}
          >
            <PropertyIcon type={tp} className="size-3.5" />
            <span className="truncate">{t(`type.${tp}`)}</span>
          </button>
        ))}
      </div>
      {type === "relation" && (
        <>
          <Field label={t("db.relatedTo")}>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className={selectCls}>
              <option value="" disabled>
                {t("db.chooseDb")}
              </option>
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {iconText(d.icon) ? `${iconText(d.icon)} ` : ""}
                  {d.title || t("page.untitled")}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={twoWay}
              onChange={(e) => setTwoWay(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            {t("db.twoWay")}
          </label>
        </>
      )}
      {type === "rollup" && <RollupFields data={data} config={rollup} onChange={setRollup} />}
      {type === "formula" ? (
        <FormulaEditor
          data={data}
          initial=""
          saving={actions.addProperty.isPending}
          submitLabel={t("db.addProperty")}
          onSave={async (expression) => {
            await actions.addProperty.mutateAsync({
              name: name.trim() || t("type.formula"),
              type: "formula",
              config: { expression },
            });
            onClose();
          }}
        />
      ) : (
        <Button type="submit" size="sm" disabled={!ready || actions.addProperty.isPending}>
          {t("db.addProperty")}
        </Button>
      )}
    </form>
  );
}
