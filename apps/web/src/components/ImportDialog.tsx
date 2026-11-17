import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, FileUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useMatch } from "react-router";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { pagesKey, usePageIndex, useWorkspace } from "@/lib/workspace";
import { PageIcon } from "./PageIcon";
import { Button, Dialog, IconButton } from "./ui";

type Job = {
  id: string;
  status: "running" | "done" | "error";
  step: string;
  done: number;
  total: number;
  error?: string;
  result?: {
    pages: number;
    databases: number;
    rows: number;
    files: number;
    roots: { id: string; title: string; type: "page" | "database" }[];
    warnings: string[];
  };
};

/** Imports a Notion export, Markdown / Obsidian folder (zip), Markdown file or CSV into the workspace. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const index = usePageIndex();
  const match = useMatch("/p/:id");
  const currentId = match?.params.id;
  const current = currentId ? index.byId.get(currentId) : undefined;
  const [file, setFile] = useState<File | null>(null);
  const [inside, setInside] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setJob(null);
      setError(null);
      setInside(false);
    }
  }, [open]);

  // Poll the background job.
  useEffect(() => {
    if (job?.status !== "running") return;
    const h = setTimeout(async () => {
      try {
        const next = await api.get<Job>(`/imports/${job.id}`);
        setJob(next);
        if (next.status !== "running") qc.invalidateQueries({ queryKey: pagesKey(workspace.id) });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 700);
    return () => clearTimeout(h);
  }, [job, qc, workspace.id]);

  const start = async () => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const parent = inside && current ? `?parent=${current.id}` : "";
      const res = await fetch(`/api/workspaces/${workspace.id}/import${parent}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
        body: file,
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? res.statusText);
      setJob({ id: data.id, status: "running", step: "reading", done: 0, total: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (!/\.(zip|md|markdown|txt|csv)$/i.test(f.name)) return setError(t("import.badType"));
    setFile(f);
  };

  const running = uploading || job?.status === "running";
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <Dialog open={open} onClose={() => !running && onClose()} className="max-w-lg">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <FileUp className="size-4 text-muted-foreground" />
        <h2 className="heading flex-1">{t("import.title")}</h2>
        <IconButton label={t("common.cancel")} onClick={onClose} disabled={running}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex flex-col gap-4 p-5">
        {!job && (
          <>
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files[0]);
              }}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center transition-colors hover:bg-accent/50",
                dragging && "border-ring bg-accent",
              )}
            >
              <FileUp className="size-6 text-muted-foreground" strokeWidth={1.5} />
              {file ? (
                <span className="text-sm font-medium break-all">
                  {file.name} <span className="font-normal text-muted-foreground">({formatSize(file.size)})</span>
                </span>
              ) : (
                <span className="text-sm">{t("import.drop")}</span>
              )}
              <span className="text-xs text-muted-foreground">{t("import.formats")}</span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".zip,.md,.markdown,.txt,.csv"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <ul className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Notion</span> — {t("import.notion")}
              </li>
              <li>
                <span className="font-medium text-foreground">Obsidian / Markdown</span> — {t("import.markdown")}
              </li>
              <li>
                <span className="font-medium text-foreground">CSV</span> — {t("import.csv")}
              </li>
            </ul>
            {current && (
              <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t("import.destination")}>
                <span className="text-[13px] font-medium">{t("import.destination")}</span>
                {[false, true].map((v) => (
                  <label key={String(v)} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      checked={inside === v}
                      onChange={() => setInside(v)}
                      className="accent-primary"
                    />
                    {v ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        {t("import.inside")}
                        <PageIcon icon={current.icon} type={current.type} size={14} />
                        <span className="truncate font-medium">{current.title || t("page.untitled")}</span>
                      </span>
                    ) : (
                      t("import.topLevel", { workspace: workspace.name })
                    )}
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {job?.status === "running" && (
          <div className="flex flex-col gap-2 py-4">
            <div className="flex justify-between text-sm">
              <span>{t(`import.step.${job.step}`)}</span>
              {job.total > 0 && (
                <span className="text-muted-foreground tabular-nums">
                  {job.done} / {job.total}
                </span>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full bg-ribbon transition-all", !job.total && "w-1/3 animate-pulse")}
                style={job.total ? { width: `${pct}%` } : undefined}
              />
            </div>
          </div>
        )}

        {job?.status === "done" && job.result && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 text-sm">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-ribbon" />
              <span>
                {t("import.done", {
                  pages: job.result.pages,
                  databases: job.result.databases,
                  rows: job.result.rows,
                  files: job.result.files,
                })}
              </span>
            </div>
            <ul className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border">
              {job.result.roots.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/p/${r.id}`}
                    onClick={onClose}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <PageIcon icon={null} type={r.type} size={14} />
                    <span className="truncate">{r.title || t("page.untitled")}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {job.result.warnings.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t("import.warnings", { n: job.result.warnings.length })}</summary>
                <ul className="mt-1 list-disc pl-5">
                  {job.result.warnings.slice(0, 50).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {(error || job?.status === "error") && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{error ?? job?.error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {job?.status === "done" || job?.status === "error" ? (
            <Button size="sm" onClick={onClose}>
              {t("common.done")}
            </Button>
          ) : (
            <Button size="sm" disabled={!file || running} onClick={start}>
              {running ? t("import.importing") : t("import.start")}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

const formatSize = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
