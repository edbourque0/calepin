import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { CornerDownLeft, FileText, Plus, Search } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, type SearchResult } from "@/lib/api";
import { useI18n, useRelativeTime } from "@/lib/i18n";
import { usePageActions, usePageIndex, useWorkspace } from "@/lib/workspace";
import { Dialog, Kbd, Spinner } from "./ui";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Renders a server snippet where \u0002…\u0003 marks matched words. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("\u0002") ? (
          <mark key={i} className="rounded-[3px] bg-highlight px-0.5 text-foreground">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const rel = useRelativeTime();
  const { workspace } = useWorkspace();
  const index = usePageIndex();
  const { create } = usePageActions();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 120);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", workspace.id, dq],
    queryFn: () => api.get<SearchResult[]>(`/workspaces/${workspace.id}/search?q=${encodeURIComponent(dq)}`),
    enabled: open,
    placeholderData: (prev) => prev,
  });

  const go = (id: string) => {
    navigate(`/p/${id}`);
    onClose();
  };

  const createPage = async () => {
    const page = await create.mutateAsync({ title: q.trim() });
    go(page.id);
  };

  const path = (id: string, parentId: string | null) =>
    parentId
      ? index
          .ancestors(id)
          .map((a) => a.title || t("page.untitled"))
          .join(" / ")
      : "";

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <Command shouldFilter={false} loop className="flex max-h-[60vh] flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder={t("search.placeholder")}
            className="h-12 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
          />
          {isFetching && <Spinner className="size-3.5" />}
          <Kbd>esc</Kbd>
        </div>
        <Command.List className="overflow-y-auto px-2 pt-1 pb-2">
          <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
            {t("search.empty")}
          </Command.Empty>
          {data && data.length > 0 && (
            <Command.Group
              heading={dq ? t("search.results") : t("search.recent")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {data.map((r) => (
                <Command.Item
                  key={r.id}
                  value={r.id}
                  onSelect={() => go(r.id)}
                  className="group flex min-h-9 cursor-pointer items-start gap-2 rounded-sm px-2 py-2 data-[selected=true]:bg-accent"
                >
                  <span className="flex size-5 items-center justify-center text-muted-foreground">
                    {r.icon ? (
                      <span className="text-base leading-none">{r.icon}</span>
                    ) : (
                      <FileText className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {r.title || t("page.untitled")}
                      </span>
                      {r.parentId && (
                        <span className="truncate text-xs text-muted-foreground">{path(r.id, r.parentId)}</span>
                      )}
                    </span>
                    {r.snippet && (
                      <span className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">
                        <Snippet text={r.snippet} />
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums group-data-[selected=true]:hidden">
                    {rel(r.updatedAt)}
                  </span>
                  <CornerDownLeft className="mt-1 hidden size-3.5 text-muted-foreground group-data-[selected=true]:block" />
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {dq && (
            <Command.Item
              value="__create"
              onSelect={createPage}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm data-[selected=true]:bg-accent [&_svg]:text-muted-foreground"
            >
              <Plus className="size-4" />
              {t("search.create", { q: q.trim() })}
            </Command.Item>
          )}
        </Command.List>
      </Command>
    </Dialog>
  );
}
