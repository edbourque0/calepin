import {
  ArrowUpDown,
  ChevronDown,
  Columns3,
  Eye,
  Filter as FilterIcon,
  Kanban,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Button, Popover, Spinner } from "@/components/ui";
import type { View, ViewConfig, ViewType } from "@/lib/api";
import { applyView, useDatabase, useDatabaseActions, valuesFromFilters } from "@/lib/database";
import { useI18n } from "@/lib/i18n";
import { cn, storage } from "@/lib/utils";
import { BoardView } from "./BoardView";
import { TableView } from "./TableView";
import { FilterMenu, GroupMenu, PropertiesMenu, SortMenu } from "./ViewMenus";

const viewIcon = (type: ViewType) =>
  type === "board" ? <Kanban className="size-3.5" /> : <Table2 className="size-3.5" />;

function ToolbarButton({
  icon,
  label,
  active,
  count,
  children,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  count?: number;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium hover:bg-accent [&_svg]:size-3.5",
          active ? "text-ribbon" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {icon}
        <span className="max-sm:hidden">{label}</span>
        {!!count && <span className="tabular-nums">{count}</span>}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end">
        {children(() => setOpen(false))}
      </Popover>
    </>
  );
}

/** A full-page database: view tabs, toolbar and the active view. */
export function DatabaseView({ databaseId }: { databaseId: string }) {
  const { t } = useI18n();
  const { data, isLoading, error } = useDatabase(databaseId);
  const actions = useDatabaseActions(databaseId);
  const viewStore = useMemo(() => storage<string | null>(`view:${databaseId}`, null), [databaseId]);
  const [viewId, setViewIdState] = useState(viewStore.get);
  const setViewId = (id: string) => {
    viewStore.set(id);
    setViewIdState(id);
  };
  const [viewMenu, setViewMenu] = useState<View | null>(null);
  const viewMenuAnchor = useRef<HTMLElement | null>(null);
  const addViewRef = useRef<HTMLButtonElement>(null);
  const [addingView, setAddingView] = useState(false);

  const view = data?.views.find((v) => v.id === viewId) ?? data?.views[0];
  const rows = useMemo(() => (data && view ? applyView(data.rows, view, data.properties) : []), [data, view]);

  if (isLoading)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  if (error || !data || !view) return <p className="py-10 text-sm text-muted-foreground">{String(error ?? "")}</p>;

  const canEdit = data.role !== "viewer";
  const change = (config: ViewConfig) => actions.updateView.mutate({ viewId: view.id, config });
  const filters = view.config.filters ?? [];
  const sorts = view.config.sorts ?? [];

  const addView = async (type: ViewType) => {
    const groupBy = data.properties.find((p) => p.type === "status" || p.type === "select")?.id ?? null;
    const v = await actions.addView.mutateAsync({
      name: type === "board" ? t("db.viewBoard") : t("db.viewTable"),
      type,
      config: type === "board" ? { groupBy } : {},
    });
    setViewId(v.id);
    setAddingView(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {data.views.map((v) => {
            const active = v.id === view.id;
            return (
              <div key={v.id} className="flex shrink-0 items-center">
                <button
                  role="tab"
                  aria-selected={active}
                  onClick={(e) => {
                    if (active && canEdit) {
                      viewMenuAnchor.current = e.currentTarget;
                      setViewMenu(v);
                    } else setViewId(v.id);
                  }}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {viewIcon(v.type)}
                  {v.name}
                  {active && canEdit && <ChevronDown className="size-3 text-muted-foreground" />}
                </button>
              </div>
            );
          })}
          {canEdit && (
            <button
              ref={addViewRef}
              aria-label={t("db.addView")}
              title={t("db.addView")}
              onClick={() => setAddingView(true)}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-0.5">
            <ToolbarButton
              icon={<FilterIcon />}
              label={t("db.filter")}
              active={filters.length > 0}
              count={filters.length}
            >
              {() => <FilterMenu data={data} view={view} onChange={change} />}
            </ToolbarButton>
            <ToolbarButton icon={<ArrowUpDown />} label={t("db.sort")} active={sorts.length > 0} count={sorts.length}>
              {() => <SortMenu data={data} view={view} onChange={change} />}
            </ToolbarButton>
            {view.type === "board" && (
              <ToolbarButton icon={<Columns3 />} label={t("db.group")}>
                {(close) => (
                  <GroupMenu
                    data={data}
                    view={view}
                    onChange={(c) => {
                      change(c);
                      close();
                    }}
                  />
                )}
              </ToolbarButton>
            )}
            <ToolbarButton
              icon={<Eye />}
              label={t("db.properties")}
              count={(view.config.hidden ?? []).length || undefined}
            >
              {() => <PropertiesMenu data={data} view={view} onChange={change} />}
            </ToolbarButton>
            <Button
              size="sm"
              className="ml-1"
              onClick={() => actions.addRow.mutate({ values: valuesFromFilters(view, data.properties) })}
            >
              <Plus />
              {t("db.new")}
            </Button>
          </div>
        )}
      </div>

      <Popover anchor={addViewRef} open={addingView} onClose={() => setAddingView(false)} className="w-48">
        <button
          onClick={() => addView("table")}
          className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent"
        >
          <Table2 className="size-4 text-muted-foreground" />
          {t("db.viewTable")}
        </button>
        <button
          onClick={() => addView("board")}
          className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent"
        >
          <Kanban className="size-4 text-muted-foreground" />
          {t("db.viewBoard")}
        </button>
      </Popover>

      {viewMenu && (
        <Popover anchor={viewMenuAnchor} open onClose={() => setViewMenu(null)} className="w-60">
          <ViewMenu
            view={viewMenu}
            canDelete={data.views.length > 1}
            onRename={(name) => actions.updateView.mutate({ viewId: viewMenu.id, name })}
            onType={(type) => {
              const groupBy =
                view.config.groupBy ??
                data.properties.find((p) => p.type === "status" || p.type === "select")?.id ??
                null;
              actions.updateView.mutate({ viewId: viewMenu.id, type, config: type === "board" ? { groupBy } : {} });
              setViewMenu(null);
            }}
            onDelete={() => {
              actions.deleteView.mutate(viewMenu.id);
              setViewMenu(null);
            }}
          />
        </Popover>
      )}

      {data.rows.length === 0 ? (
        view.type === "table" ? (
          <TableView
            data={data}
            view={view}
            rows={rows}
            canEdit={canEdit}
            onHideProperty={(id) => change({ hidden: [...(view.config.hidden ?? []), id] })}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("db.noRows")}</p>
        )
      ) : rows.length === 0 && filters.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("db.noMatch")}</p>
      ) : view.type === "board" ? (
        <BoardView data={data} view={view} rows={rows} canEdit={canEdit} />
      ) : (
        <TableView
          data={data}
          view={view}
          rows={rows}
          canEdit={canEdit}
          onHideProperty={(id) => change({ hidden: [...(view.config.hidden ?? []), id] })}
        />
      )}
      <p className="text-xs text-muted-foreground tabular-nums">{t("db.rows", { n: rows.length })}</p>
    </div>
  );
}

function ViewMenu({
  view,
  canDelete,
  onRename,
  onType,
  onDelete,
}: {
  view: View;
  canDelete: boolean;
  onRename: (name: string) => void;
  onType: (type: ViewType) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(view.name);
  const save = () => name.trim() && name.trim() !== view.name && onRename(name.trim());
  return (
    <div className="flex flex-col gap-1">
      <input
        autoFocus
        value={name}
        aria-label={t("db.renameView")}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && save()}
        className="m-1 h-8 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs"
      />
      {(["table", "board"] as ViewType[]).map((type) => (
        <button
          key={type}
          onClick={() => onType(type)}
          className={cn(
            "flex h-8 items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent",
            view.type === type && "font-medium",
          )}
        >
          {viewIcon(type)}
          {type === "board" ? t("db.viewBoard") : t("db.viewTable")}
        </button>
      ))}
      {canDelete && (
        <button
          onClick={onDelete}
          className="flex h-8 items-center gap-2 rounded-sm px-2 text-sm text-destructive hover:bg-accent"
        >
          <Trash2 className="size-3.5" />
          {t("db.deleteView")}
        </button>
      )}
    </div>
  );
}
