import { ChevronRight, FileText, Plus, Trash2 } from "lucide-react";
import { type DragEvent, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import type { PageSummary, SharedPage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn, storage } from "@/lib/utils";
import { type PageIndex, usePageActions, usePageIndex, useSharedIndex, useWorkspace } from "@/lib/workspace";

const expandedStore = storage<string[]>("expanded", []);
type DropZone = "before" | "inside" | "after";

type TreeMode = "workspace" | "shared";

export function PageTree({ onNavigate, mode = "workspace" }: { onNavigate?: () => void; mode?: TreeMode }) {
  const workspaceIndex = usePageIndex();
  const sharedIndex = useSharedIndex();
  const index = mode === "shared" ? sharedIndex : workspaceIndex;
  const { canEdit } = useWorkspace();
  const editable = mode === "workspace" && canEdit;
  const [expanded, setExpanded] = useState(() => new Set(expandedStore.get()));
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);
  const { move } = usePageActions();

  const toggle = (id: string, open?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      expandedStore.set([...next]);
      return next;
    });
  };

  const isInside = (candidateId: string, ancestorId: string) =>
    candidateId === ancestorId || index.ancestors(candidateId).some((a) => a.id === ancestorId);

  const onDrop = () => {
    if (!dragId || !drop || isInside(drop.id, dragId)) return reset();
    const target = index.byId.get(drop.id);
    if (!target) return reset();
    if (drop.zone === "inside") {
      const kids = index.children(target.id).filter((p) => p.id !== dragId);
      move.mutate({ id: dragId, parentId: target.id, index: kids.length });
      toggle(target.id, true);
    } else {
      const siblings = index.children(target.parentId).filter((p) => p.id !== dragId);
      const i = siblings.findIndex((p) => p.id === target.id);
      move.mutate({ id: dragId, parentId: target.parentId, index: drop.zone === "before" ? i : i + 1 });
    }
    reset();
  };
  const reset = () => {
    setDragId(null);
    setDrop(null);
  };

  const roots = index.children(null);
  return (
    <div className="flex flex-col gap-px" onDragEnd={reset}>
      {roots.map((p) => (
        <TreeNode
          key={p.id}
          page={p}
          depth={0}
          index={index}
          expanded={expanded}
          toggle={toggle}
          dragId={dragId}
          drop={drop}
          setDragId={setDragId}
          setDrop={setDrop}
          onDrop={onDrop}
          onNavigate={onNavigate}
          editable={editable}
          mode={mode}
        />
      ))}
    </div>
  );
}

type NodeProps = {
  page: PageSummary;
  depth: number;
  index: PageIndex;
  expanded: Set<string>;
  toggle: (id: string, open?: boolean) => void;
  dragId: string | null;
  drop: { id: string; zone: DropZone } | null;
  setDragId: (id: string | null) => void;
  setDrop: (d: { id: string; zone: DropZone } | null) => void;
  onDrop: () => void;
  onNavigate?: () => void;
  /** Workspace tree and the user can edit: drag, delete, add subpages. */
  editable: boolean;
  mode: TreeMode;
};

function TreeNode(props: NodeProps) {
  const { page, depth, index, expanded, toggle, dragId, drop, setDragId, setDrop, onDrop, onNavigate, editable, mode } =
    props;
  const canAddChild = editable || (mode === "shared" && (page as SharedPage).role === "editor");
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pageId } = useParams();
  const { create, remove } = usePageActions();
  const children = index.children(page.id);
  const open = expanded.has(page.id);
  const dropZone = drop?.id === page.id ? drop.zone : null;

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!editable || !dragId || dragId === page.id) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const zone: DropZone = y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
    if (dropZone !== zone) setDrop({ id: page.id, zone });
  };

  const addChild = async () => {
    const created = await create.mutateAsync({ parentId: page.id, workspaceId: page.workspaceId });
    toggle(page.id, true);
    navigate(`/p/${created.id}`);
    onNavigate?.();
  };

  const onDelete = async () => {
    await remove.mutateAsync(page.id);
    if (pageId && (pageId === page.id || index.ancestors(pageId).some((a) => a.id === page.id))) navigate("/");
  };

  return (
    <div>
      <div
        draggable={editable}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", page.id);
          setDragId(page.id);
        }}
        onDragOver={onDragOver}
        onDrop={(e) => {
          e.preventDefault();
          onDrop();
        }}
        className={cn(
          "group relative rounded-sm",
          dropZone === "inside" && "bg-ribbon-soft ring-1 ring-ribbon/50",
          dragId === page.id && "opacity-40",
        )}
      >
        {dropZone === "before" && <span className="absolute inset-x-2 -top-px h-0.5 rounded bg-ribbon" />}
        {dropZone === "after" && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-ribbon" />}
        <NavLink
          to={`/p/${page.id}`}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "relative flex h-[30px] items-center gap-1.5 rounded-sm pr-1 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
              isActive && "bg-sidebar-accent font-medium",
            )
          }
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {({ isActive }) => (
            <>
              {/* The ribbon marks the current page. */}
              {isActive && (
                <span className="absolute top-[7px] bottom-[7px] -left-2 w-[3px] rounded-r-[2px] bg-ribbon" />
              )}
              <span
                role="button"
                aria-label={open ? "Collapse" : "Expand"}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggle(page.id);
                }}
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground",
                  children.length === 0 && "invisible",
                )}
              >
                <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
              </span>
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                {page.icon ? (
                  <span className="text-[14px] leading-none">{page.icon}</span>
                ) : (
                  <FileText className="size-4" />
                )}
              </span>
              <span className="flex-1 truncate">{page.title || t("page.untitled")}</span>
              <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                {editable && (
                  <span
                    role="button"
                    title={t("nav.delete")}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </span>
                )}
                {canAddChild && (
                  <span
                    role="button"
                    title={t("nav.addSubpage")}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addChild();
                    }}
                    className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="size-4" />
                  </span>
                )}
              </span>
            </>
          )}
        </NavLink>
      </div>
      {open && children.length > 0 && (
        <div className="flex flex-col gap-px">
          {children.map((c) => (
            <TreeNode key={c.id} {...props} page={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
