import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { diffLines } from "diff";
import { History, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { localeOf, useI18n } from "@/lib/i18n";
import { cn, colorFor, initials } from "@/lib/utils";
import { Button, IconButton, Spinner, Tabs } from "./ui";

type VersionSummary = {
  id: string;
  title: string;
  kind: "auto" | "manual" | "before-agent" | "before-restore";
  createdAt: string;
  authors: { id: string; name: string }[];
};
type VersionDetail = { id: string; title: string; createdAt: string; markdown: string; html: string };

function dayLabel(iso: string, locale: string, t: (k: string) => string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return t("history.today");
  if (d.toDateString() === yesterday.toDateString()) return t("history.yesterday");
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
}

/** Side sheet listing a page's versions, with preview, line diff against now, and restore. */
export function HistoryPanel({ pageId, canEdit, onClose }: { pageId: string; canEdit: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const locale = localeOf(lang);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "diff">("preview");
  const [notice, setNotice] = useState<string | null>(null);

  const versions = useQuery({
    queryKey: ["versions", pageId],
    queryFn: () => api.get<VersionSummary[]>(`/pages/${pageId}/versions`),
  });
  useEffect(() => {
    if (!selected && versions.data?.length) setSelected(versions.data[0]!.id);
  }, [versions.data, selected]);

  const detail = useQuery({
    queryKey: ["version", pageId, selected],
    queryFn: () => api.get<VersionDetail>(`/pages/${pageId}/versions/${selected}`),
    enabled: !!selected,
  });
  const current = useQuery({
    queryKey: ["page-markdown", pageId],
    queryFn: () => api.get<{ markdown: string }>(`/pages/${pageId}/markdown`),
    enabled: mode === "diff",
  });

  const save = useMutation({
    mutationFn: () => api.post<{ id: string | null; unchanged: boolean }>(`/pages/${pageId}/versions`),
    onSuccess: (r) => {
      setNotice(r.unchanged ? t("history.unchanged") : t("history.saved"));
      qc.invalidateQueries({ queryKey: ["versions", pageId] });
      if (r.id) setSelected(r.id);
    },
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.post(`/pages/${pageId}/versions/${id}/restore`),
    onSuccess: () => {
      const v = versions.data?.find((x) => x.id === selected);
      setNotice(t("history.restored", { date: v ? new Date(v.createdAt).toLocaleString(locale) : "" }));
      qc.invalidateQueries({ queryKey: ["versions", pageId] });
      qc.invalidateQueries({ queryKey: ["page-markdown", pageId] });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const out: { label: string; items: VersionSummary[] }[] = [];
    for (const v of versions.data ?? []) {
      const label = dayLabel(v.createdAt, locale, t);
      const last = out.at(-1);
      if (last?.label === label) last.items.push(v);
      else out.push({ label, items: [v] });
    }
    return out;
  }, [versions.data, locale, t]);

  const changes = useMemo(
    () => (detail.data && current.data ? diffLines(detail.data.markdown + "\n", current.data.markdown + "\n") : null),
    [detail.data, current.data],
  );

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside className="animate-pop flex h-full w-full max-w-[980px] flex-col border-l border-border bg-popover shadow-lg">
        <header className="flex h-14 items-center gap-2 border-b border-border px-4">
          <History className="size-4 text-muted-foreground" />
          <h2 className="heading flex-1">{t("history.title")}</h2>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              <Save />
              <span className="max-sm:hidden">{t("history.saveNow")}</span>
            </Button>
          )}
          <IconButton label={t("common.cancel")} onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </header>
        {notice && (
          <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-[13px]">
            <span className="flex-1">{notice}</span>
            <button
              onClick={() => setNotice(null)}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div className="flex min-h-0 flex-1 max-md:flex-col">
          <nav className="w-64 shrink-0 overflow-y-auto border-r border-border p-2 max-md:max-h-56 max-md:w-full max-md:border-r-0 max-md:border-b">
            {versions.isLoading && (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            )}
            {versions.data?.length === 0 && (
              <p className="px-2 py-4 text-[13px] text-muted-foreground">{t("history.empty")}</p>
            )}
            {groups.map((g) => (
              <div key={g.label} className="mb-2">
                <div className="caps-label px-2 pt-2 pb-1">{g.label}</div>
                {g.items.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelected(v.id)}
                    className={cn(
                      "relative flex w-full flex-col gap-1 rounded-sm px-2 py-1.5 text-left hover:bg-accent",
                      selected === v.id && "bg-accent",
                    )}
                  >
                    {selected === v.id && (
                      <span className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-r-[2px] bg-ribbon" />
                    )}
                    <span className="flex items-center gap-2 text-sm">
                      <span className="font-medium tabular-nums">
                        {new Date(v.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {v.kind !== "auto" && <span className="tag tag-gray">{t(`history.kind.${v.kind}`)}</span>}
                    </span>
                    {v.authors.length > 0 && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="flex [&>*+*]:-ml-1">
                          {v.authors.slice(0, 3).map((a) => (
                            <span
                              key={a.id}
                              className="inline-flex size-4 items-center justify-center rounded-full border-[1.5px] bg-muted text-[7px] font-semibold text-foreground"
                              style={{ borderColor: colorFor(a.id) }}
                            >
                              {initials(a.name)}
                            </span>
                          ))}
                        </span>
                        <span className="truncate">{v.authors.map((a) => a.name).join(", ")}</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <section className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
                  <Tabs
                    value={mode}
                    onChange={setMode}
                    items={[
                      { value: "preview" as const, label: t("history.preview") },
                      { value: "diff" as const, label: t("history.diff") },
                    ]}
                  />
                  <span className="flex-1" />
                  {canEdit && (
                    <Button
                      size="sm"
                      disabled={restore.isPending}
                      onClick={() => confirm(t("history.restoreConfirm")) && restore.mutate(selected)}
                    >
                      <RotateCcw />
                      {t("history.restore")}
                    </Button>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-10">
                  {detail.isLoading || (mode === "diff" && current.isLoading) ? (
                    <div className="flex justify-center py-10">
                      <Spinner />
                    </div>
                  ) : mode === "preview" && detail.data ? (
                    <article className="mx-auto max-w-[720px]">
                      <h1 className="page-title mb-6 text-[32px] leading-10">
                        {detail.data.title || t("page.untitled")}
                      </h1>
                      <div className="prose-preview" dangerouslySetInnerHTML={{ __html: detail.data.html }} />
                    </article>
                  ) : changes ? (
                    <div className="mx-auto max-w-[760px]">
                      <p className="mb-4 text-[13px] text-muted-foreground">{t("history.diffHint")}</p>
                      {changes.every((c) => !c.added && !c.removed) ? (
                        <p className="text-sm text-muted-foreground">{t("history.noDiff")}</p>
                      ) : (
                        <pre className="overflow-x-auto rounded-lg border border-border font-mono text-[13px] leading-6">
                          {changes.flatMap((part, i) =>
                            part.value
                              .replace(/\n$/, "")
                              .split("\n")
                              .map((line, j) => (
                                <div
                                  key={`${i}-${j}`}
                                  className={cn(
                                    "px-3 whitespace-pre-wrap",
                                    part.added && "tag-green",
                                    part.removed && "tag-rose line-through decoration-[1px]",
                                    !part.added && !part.removed && "text-muted-foreground",
                                  )}
                                >
                                  <span className="mr-3 inline-block w-3 select-none">
                                    {part.added ? "+" : part.removed ? "−" : " "}
                                  </span>
                                  {line || " "}
                                </div>
                              )),
                          )}
                        </pre>
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">{t("history.select")}</p>
            )}
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
