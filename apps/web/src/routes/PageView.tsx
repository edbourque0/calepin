import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Cloud,
  CloudOff,
  Download,
  Ellipsis,
  FileText,
  Globe,
  History,
  Lock,
  RefreshCw,
  Share2,
  SmilePlus,
  Sparkles,
} from "lucide-react";
import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type * as Y from "yjs";
import { TopBar } from "@/components/AppShell";
import type { EditorHandle } from "@/components/Editor";

const Editor = lazy(() => import("@/components/Editor").then((m) => ({ default: m.Editor })));
import { EmojiPicker } from "@/components/EmojiPicker";
import { DatabaseView } from "@/components/database/DatabaseView";
import { RowProperties } from "@/components/database/RowProperties";
import { SharePanel } from "@/components/SharePanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { AiPanel } from "@/components/AiPanel";
import { openAiPanel, useAiEnabled } from "@/lib/ai";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
import { Button, IconButton, Kbd, MenuItem, Popover, Spinner } from "@/components/ui";
import { type Collab, type SyncStatus, TITLE_TEXT, usePresence, useCollab } from "@/lib/collab";
import { useI18n } from "@/lib/i18n";
import { cn, initials, storage } from "@/lib/utils";
import { api, type PageMeta, type PageSummary } from "@/lib/api";
import { usePageActions, usePageIndex, usePages, useSharedIndex, useSharedPages, useWorkspace } from "@/lib/workspace";

export const lastPageStore = storage<string | null>("last-page", null);

type Crumb = { id: string; title: string; icon: string | null };
type Resolved = { page: PageSummary; crumbs: Crumb[]; canShare: boolean };

/**
 * Finds the page in the current workspace tree, in "Shared with me", or asks the server
 * (a link to a page in another workspace, or one shared through a parent).
 */
function useResolvedPage(pageId: string | undefined): { resolved: Resolved | null; loading: boolean } {
  const { workspace, me, setWorkspace } = useWorkspace();
  const { isLoading: loadingPages } = usePages();
  const { isLoading: loadingShared } = useSharedPages();
  const index = usePageIndex();
  const shared = useSharedIndex();
  const inTree = pageId ? index.byId.get(pageId) : undefined;
  const inShared = pageId && !inTree ? shared.byId.get(pageId) : undefined;
  const meta = useQuery({
    queryKey: ["page", pageId],
    queryFn: () => api.get<PageMeta>(`/pages/${pageId}`),
    enabled: !!pageId && !loadingPages && !loadingShared && !inTree && !inShared,
    retry: false,
  });

  // A page from another workspace I belong to: switch to that workspace.
  useEffect(() => {
    const m = meta.data;
    if (m?.isMember && m.workspaceId !== workspace.id && me.workspaces.some((w) => w.id === m.workspaceId))
      setWorkspace(m.workspaceId);
  }, [meta.data, workspace.id, me.workspaces, setWorkspace]);

  if (!pageId) return { resolved: null, loading: false };
  if (inTree)
    return {
      resolved: { page: inTree, crumbs: [...index.ancestors(pageId), inTree], canShare: true },
      loading: false,
    };
  if (inShared)
    return {
      resolved: { page: inShared, crumbs: [...shared.ancestors(pageId), inShared], canShare: true },
      loading: false,
    };
  if (loadingPages || loadingShared || meta.isLoading) return { resolved: null, loading: true };
  if (!meta.data) return { resolved: null, loading: false };
  return {
    resolved: { page: meta.data, crumbs: [...meta.data.ancestors, meta.data], canShare: true },
    loading: false,
  };
}

export function PageView() {
  const { pageId } = useParams();
  const { t } = useI18n();
  const { resolved, loading } = useResolvedPage(pageId);

  useEffect(() => {
    if (resolved) lastPageStore.set(resolved.page.id);
  }, [resolved?.page.id]);

  if (loading) return <FullSpinner />;
  if (!resolved) return <NotFound message={t("page.notFound")} />;
  return <CollabPage key={resolved.page.id} resolved={resolved} />;
}

function CollabPage({ resolved }: { resolved: Resolved }) {
  const { t } = useI18n();
  const pageId = resolved.page.id;
  const isDatabase = resolved.page.type === "database";
  const { collab, status, readOnly, denied, ready } = useCollab(pageId);
  const editorRef = useRef<EditorHandle>(null);
  const wantFocus = useRef(false);
  const focusEditor = () => {
    if (editorRef.current) editorRef.current.focusStart();
    else wantFocus.current = true; // editor chunk still loading: focus as soon as it mounts
  };
  const onEditorReady = (handle: EditorHandle) => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    handle.focusStart();
  };

  const aiEnabled = useAiEnabled();
  const [aiOpen, setAiOpen] = useState(false);
  useEffect(() => {
    if (!aiEnabled) return;
    const open = () => setAiOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAiOpen((o) => !o);
      }
    };
    window.addEventListener("calepin:ai", open);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("calepin:ai", open);
      window.removeEventListener("keydown", onKey);
    };
  }, [aiEnabled]);

  if (denied) return <NotFound message={t("page.notFound")} />;

  return (
    <>
      {aiOpen && (
        <AiPanel
          pageId={pageId}
          workspaceId={resolved.page.workspaceId}
          editor={isDatabase ? null : editorRef.current}
          canEdit={!readOnly}
          onClose={() => setAiOpen(false)}
        />
      )}
      <PageTopBar resolved={resolved} status={status} readOnly={readOnly} collab={collab} />
      <article
        className={cn(
          "mx-auto w-full px-6 pt-10 md:px-12 md:pt-16",
          isDatabase ? "max-w-[1240px] pb-24" : "max-w-[816px] pb-[40vh]",
        )}
      >
        {collab && ready ? (
          <>
            <PageHeader page={resolved.page} doc={collab.doc} readOnly={readOnly} onEnter={focusEditor} />
            {isDatabase ? (
              <div className="mt-6">
                <DatabaseView databaseId={pageId} />
              </div>
            ) : (
              <>
                {resolved.page.type === "row" && resolved.page.parentId && (
                  <RowProperties databaseId={resolved.page.parentId} rowId={pageId} />
                )}
                <div className="-mx-[54px] mt-3 max-md:-mx-6">
                  <Suspense fallback={<div className="h-6" />}>
                    <Editor
                      ref={editorRef}
                      pageId={pageId}
                      workspaceId={resolved.page.workspaceId}
                      collab={collab}
                      readOnly={readOnly}
                      onReady={onEditorReady}
                    />
                  </Suspense>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="space-y-4 pt-4">
            <div className="h-11 w-2/3 animate-pulse rounded-lg bg-accent" />
            <div className="h-4 w-full animate-pulse rounded bg-accent" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-accent" />
          </div>
        )}
      </article>
    </>
  );
}

function PageTopBar({
  resolved,
  status,
  readOnly,
  collab,
}: {
  resolved: Resolved;
  status: SyncStatus;
  readOnly: boolean;
  collab: Collab | null;
}) {
  const { t } = useI18n();
  const crumbs = resolved.crumbs;
  const people = usePresence(collab?.provider);
  const shareBtn = useRef<HTMLButtonElement>(null);
  const [sharing, setSharing] = useState(false);

  return (
    <TopBar
      right={
        <>
          {people.length > 0 && (
            <div
              className="flex items-center [&>*+*]:-ml-1"
              role="group"
              aria-label={people.map((p) => p.name).join(", ")}
            >
              {people.slice(0, 4).map((p) => (
                <span
                  key={p.clientId}
                  title={p.name}
                  className="inline-flex size-6 items-center justify-center rounded-full border-2 bg-muted text-[9px] font-semibold text-foreground shadow-[0_0_0_2px_var(--background)]"
                  style={{ borderColor: p.color }}
                >
                  {initials(p.name)}
                </span>
              ))}
              {people.length > 4 && (
                <span className="inline-flex size-6 items-center justify-center rounded-full border-2 border-border bg-muted text-[9px] text-muted-foreground shadow-[0_0_0_2px_var(--background)]">
                  +{people.length - 4}
                </span>
              )}
            </div>
          )}
          <StatusBadge status={status} readOnly={readOnly} />
          <PageMenu resolved={resolved} readOnly={readOnly} />
          {resolved.canShare && (
            <>
              <Button ref={shareBtn} variant="ghost" size="sm" onClick={() => setSharing((s) => !s)}>
                {resolved.page.publicSlug ? <Globe className="text-ribbon" /> : <Share2 />}
                <span className="max-sm:hidden">{t("share.button")}</span>
              </Button>
              <Popover anchor={shareBtn} open={sharing} onClose={() => setSharing(false)} align="end" className="p-0">
                <SharePanel pageId={resolved.page.id} />
              </Popover>
            </>
          )}
        </>
      }
    >
      {crumbs.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground max-sm:hidden" />}
          <Link
            to={`/p/${c.id}`}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-sm transition-colors hover:bg-accent",
              i === crumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground max-sm:hidden",
            )}
          >
            {c.icon && <span className="leading-none">{c.icon}</span>}
            <span className="truncate">{c.title || t("page.untitled")}</span>
          </Link>
        </Fragment>
      ))}
    </TopBar>
  );
}

function PageMenu({ resolved, readOnly }: { resolved: Resolved; readOnly: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const isDb = resolved.page.type === "database";
  const ai = useAiEnabled();
  return (
    <>
      <IconButton ref={ref} label={t("page.more")} onClick={() => setOpen((o) => !o)}>
        <Ellipsis className="size-4" />
      </IconButton>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" className="w-60">
        {ai && (
          <MenuItem
            icon={<Sparkles className="size-4" />}
            onClick={() => {
              setOpen(false);
              openAiPanel();
            }}
          >
            {t("ai.title")}
            <Kbd className="ml-auto">{isMac ? "⌘J" : "Ctrl J"}</Kbd>
          </MenuItem>
        )}
        {!isDb && (
          <MenuItem
            icon={<History className="size-4" />}
            onClick={() => {
              setOpen(false);
              setHistory(true);
            }}
          >
            {t("page.history")}
          </MenuItem>
        )}
        <a href={`/api/pages/${resolved.page.id}/export`} download onClick={() => setOpen(false)}>
          <MenuItem icon={<Download className="size-4" />}>{isDb ? t("page.exportCsv") : t("page.exportMd")}</MenuItem>
        </a>
      </Popover>
      {history && <HistoryPanel pageId={resolved.page.id} canEdit={!readOnly} onClose={() => setHistory(false)} />}
    </>
  );
}

/** SaveStatus from the design system: status is never colour alone — icon + word. */
function StatusBadge({ status, readOnly }: { status: SyncStatus; readOnly: boolean }) {
  const { t } = useI18n();
  if (readOnly)
    return (
      <span role="status" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Lock className="size-3.5" />
        {t("status.readOnly")}
      </span>
    );
  const map = {
    synced: {
      icon: <Cloud className="size-3.5" />,
      label: t("status.saved"),
      detail: t("status.savedDetail"),
      tone: "text-success",
    },
    saving: {
      icon: <RefreshCw className="size-3.5 animate-spin" />,
      label: t("status.saving"),
      detail: t("status.saving"),
      tone: "text-muted-foreground",
    },
    connecting: {
      icon: <RefreshCw className="size-3.5 animate-spin" />,
      label: t("status.connecting"),
      detail: t("status.connecting"),
      tone: "text-muted-foreground",
    },
    offline: {
      icon: <CloudOff className="size-3.5" />,
      label: t("status.offline"),
      detail: t("status.offlineDetail"),
      tone: "text-warning",
    },
  }[status];
  return (
    <span role="status" title={map.detail} className={cn("flex items-center gap-1.5 text-xs font-medium", map.tone)}>
      {map.icon}
      <span className="max-sm:hidden">{status === "offline" ? map.detail : map.label}</span>
    </span>
  );
}

/* ---------- Icon + collaborative title ---------- */

function useYText(text: Y.Text) {
  const [value, setValue] = useState(() => text.toString());
  useEffect(() => {
    const update = () => setValue(text.toString());
    text.observe(update);
    update();
    return () => text.unobserve(update);
  }, [text]);
  return value;
}

function PageHeader({
  page,
  doc,
  readOnly,
  onEnter,
}: {
  page: PageSummary;
  doc: Y.Doc;
  readOnly: boolean;
  onEnter: () => void;
}) {
  const { t } = useI18n();
  const pageId = page.id;
  const qc = useQueryClient();
  const { patchLocal, setIcon } = usePageActions();
  const ytext = doc.getText(TITLE_TEXT);
  const title = useYText(ytext);
  const area = useRef<HTMLTextAreaElement>(null);
  const iconBtn = useRef<HTMLButtonElement>(null);
  const [picker, setPicker] = useState(false);

  // Mirror the live title into the sidebar, breadcrumbs and browser tab.
  useEffect(() => {
    patchLocal(pageId, { title: title.trim() });
    qc.setQueryData<PageMeta>(["page", pageId], (old) => (old ? { ...old, title: title.trim() } : old));
    document.title = `${title.trim() || t("page.untitled")} · Calepin`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, pageId]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // Focus the title on brand-new pages.
  useEffect(() => {
    if (!title && !readOnly) area.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (value: string) => {
    const clean = value.replace(/\n/g, "");
    doc.transact(() => {
      // Apply the minimal diff so concurrent edits elsewhere in the title are preserved.
      const old = ytext.toString();
      let start = 0;
      while (start < old.length && start < clean.length && old[start] === clean[start]) start++;
      let endOld = old.length;
      let endNew = clean.length;
      while (endOld > start && endNew > start && old[endOld - 1] === clean[endNew - 1]) {
        endOld--;
        endNew--;
      }
      if (endOld > start) ytext.delete(start, endOld - start);
      if (endNew > start) ytext.insert(start, clean.slice(start, endNew));
    });
  };

  const pick = (icon: string | null) => {
    setIcon.mutate({ id: pageId, icon });
    qc.setQueryData<PageMeta>(["page", pageId], (old) => (old ? { ...old, icon } : old));
    setPicker(false);
  };

  return (
    <div className="group/header">
      {page?.icon ? (
        <button
          ref={iconBtn}
          disabled={readOnly}
          onClick={() => setPicker(true)}
          className="mb-3 flex size-[72px] items-center justify-center rounded-lg text-[56px] leading-none transition-colors hover:bg-accent"
        >
          {page.icon}
        </button>
      ) : (
        !readOnly && (
          <div className="mb-1 h-8">
            <button
              ref={iconBtn}
              onClick={() => setPicker(true)}
              className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground opacity-0 transition-all group-hover/header:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 max-md:opacity-100"
            >
              <SmilePlus className="size-4" />
              {t("page.addIcon")}
            </button>
          </div>
        )
      )}
      <Popover anchor={iconBtn} open={picker} onClose={() => setPicker(false)}>
        <EmojiPicker
          onPick={pick}
          onRemove={page?.icon ? () => pick(null) : undefined}
          removeLabel={t("page.removeIcon")}
        />
      </Popover>
      <textarea
        ref={area}
        rows={1}
        value={title}
        readOnly={readOnly}
        placeholder={t("page.titlePlaceholder")}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || (e.key === "ArrowDown" && e.currentTarget.selectionStart === title.length)) {
            e.preventDefault();
            onEnter();
          }
        }}
        className="page-title block w-full resize-none overflow-hidden bg-transparent text-foreground outline-none placeholder:text-muted-foreground/50 focus-visible:outline-none max-md:text-[32px] max-md:leading-[40px]"
      />
    </div>
  );
}

function FullSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

function NotFound({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <>
      <TopBar />
      <div className="flex flex-col items-center justify-center gap-4 px-6 pt-[20vh] text-center">
        <span className="flex size-12 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm">
          <FileText className="size-5" />
        </span>
        <p className="text-muted-foreground">{message}</p>
        <Link to="/">
          <Button variant="outline" size="sm">
            {t("page.backHome")}
          </Button>
        </Link>
      </div>
    </>
  );
}
