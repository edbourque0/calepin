import {
  ArrowUpDown,
  ArrowUpRight,
  CalendarDays,
  ChartGantt,
  ChevronDown,
  Columns3,
  Eye,
  Filter as FilterIcon,
  Kanban,
  LayoutGrid,
  Plus,
  Settings2,
  Table2,
  Trash2,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Button, Popover, Spinner } from "@/components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { api, type DatabaseData, type View, type ViewConfig, type ViewType } from "@/lib/api";
import { applyView, dbKey, useDatabase, useDatabaseActions, valuesFromFilters } from "@/lib/database";
import { useI18n } from "@/lib/i18n";
import { cn, storage } from "@/lib/utils";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { GalleryView } from "./GalleryView";
import { TableView } from "./TableView";
import { TimelineView } from "./TimelineView";
import { FilterMenu, GroupMenu, PropertiesMenu, SortMenu } from "./ViewMenus";
import { LayoutMenu } from "./ViewSettings";

const VIEW_TYPES: ViewType[] = ["table", "board", "gallery", "calendar", "timeline"];
const ICONS: Record<ViewType, typeof Table2> = {
  table: Table2,
  list: Table2,
  board: Kanban,
  gallery: LayoutGrid,
  calendar: CalendarDays,
  timeline: ChartGantt,
};
const viewIcon = (type: ViewType, className = "size-3.5") => {
  const Icon = ICONS[type] ?? Table2;
  return <Icon className={className} />;
};
const viewLabel = (type: ViewType) => `db.view.${type === "list" ? "table" : type}`;

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
export function DatabaseView({ databaseId, inline = false }: { databaseId: string; inline?: boolean }) {
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
  if (error || !data || !view)
    return (
      <div className="py-4 text-sm text-muted-foreground">{inline ? t("db.inlineMissing") : String(error ?? "")}</div>
    );

  const canEdit = data.role !== "viewer";
  const change = (config: ViewConfig) => actions.updateView.mutate({ viewId: view.id, config });
  const filters = view.config.filters ?? [];
  const sorts = view.config.sorts ?? [];

  const configFor = (type: ViewType): ViewConfig => {
    if (type === "board")
      return {
        groupBy:
          view.config.groupBy ?? data.properties.find((p) => p.type === "status" || p.type === "select")?.id ?? null,
      };
    if (type === "calendar" || type === "timeline")
      return { dateProperty: data.properties.find((p) => p.type === "date")?.id ?? view.config.dateProperty ?? null };
    return {};
  };
  const addView = async (type: ViewType) => {
    const v = await actions.addView.mutateAsync({ name: t(viewLabel(type)), type, config: configFor(type) });
    setViewId(v.id);
    setAddingView(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {inline && <InlineTitle data={data} canEdit={canEdit} />}
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
            {(view.type === "calendar" || view.type === "timeline" || view.type === "gallery") && (
              <ToolbarButton icon={<Settings2 />} label={t("db.layout")}>
                {() => <LayoutMenu data={data} view={view} onChange={change} />}
              </ToolbarButton>
            )}
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
        {VIEW_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => addView(type)}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent [&_svg]:text-muted-foreground"
          >
            {viewIcon(type, "size-4")}
            {t(viewLabel(type))}
          </button>
        ))}
      </Popover>

      {viewMenu && (
        <Popover anchor={viewMenuAnchor} open onClose={() => setViewMenu(null)} className="w-60">
          <ViewMenu
            view={viewMenu}
            canDelete={data.views.length > 1}
            onRename={(name) => actions.updateView.mutate({ viewId: viewMenu.id, name })}
            onType={(type) => {
              actions.updateView.mutate({ viewId: viewMenu.id, type, config: configFor(type) });
              setViewMenu(null);
            }}
            onDelete={() => {
              actions.deleteView.mutate(viewMenu.id);
              setViewMenu(null);
            }}
          />
        </Popover>
      )}

      {data.rows.length > 0 && rows.length === 0 && filters.length ? (
        <div className="py-8 text-center text-sm text-muted-foreground">{t("db.noMatch")}</div>
      ) : view.type === "board" ? (
        <BoardView data={data} view={view} rows={rows} canEdit={canEdit} />
      ) : view.type === "gallery" ? (
        <GalleryView data={data} view={view} rows={rows} canEdit={canEdit} />
      ) : view.type === "calendar" ? (
        <CalendarView data={data} view={view} rows={rows} canEdit={canEdit} />
      ) : view.type === "timeline" ? (
        <TimelineView data={data} view={view} rows={rows} canEdit={canEdit} />
      ) : (
        <TableView
          data={data}
          view={view}
          rows={rows}
          canEdit={canEdit}
          onHideProperty={(id) => change({ hidden: [...(view.config.hidden ?? []), id] })}
        />
      )}
      <div className="text-xs text-muted-foreground tabular-nums">{t("db.rows", { n: rows.length })}</div>
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
      {VIEW_TYPES.map((type) => (
        <button
          key={type}
          onClick={() => onType(type)}
          className={cn(
            "flex h-8 items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent",
            view.type === type && "font-medium",
          )}
        >
          {viewIcon(type)}
          {t(viewLabel(type))}
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

/** Title of an embedded database: editable in place, with a link to open it full page. */
function InlineTitle({ data, canEdit }: { data: DatabaseData; canEdit: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [title, setTitle] = useState(data.database.title);
  const save = async () => {
    const next = title.trim();
    if (next === data.database.title) return;
    await api.patch(`/pages/${data.database.id}`, { title: next });
    qc.invalidateQueries({ queryKey: dbKey(data.database.id) });
  };
  return (
    <div className="flex items-center gap-1.5">
      {data.database.icon ? (
        <span className="text-lg">{data.database.icon}</span>
      ) : (
        <Table2 className="size-4 shrink-0 text-muted-foreground" />
      )}
      <input
        value={title}
        readOnly={!canEdit}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder={t("page.untitled")}
        aria-label={t("db.databaseName")}
        className="min-w-0 flex-1 bg-transparent text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
      />
      <Link
        to={`/p/${data.database.id}`}
        title={t("db.openFullPage")}
        aria-label={t("db.openFullPage")}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ArrowUpRight className="size-4" />
      </Link>
    </div>
  );
}
