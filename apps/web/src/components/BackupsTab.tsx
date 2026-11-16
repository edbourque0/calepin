import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Cloud, Download, HardDrive, Lock, LockOpen, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { localeOf, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button, IconButton, Spinner, Switch } from "./ui";

type BackupInfo = {
  settings: { enabled: boolean; hour: number; retention: number };
  targets: { id: "local" | "s3"; label: string; configured: boolean }[];
  encrypted: boolean;
  timeZone: string;
  files: { target: "local" | "s3"; name: string; size: number; date: string }[];
  runs: {
    id: string;
    kind: "scheduled" | "manual" | "before-restore";
    status: "running" | "success" | "error";
    fileName: string | null;
    size: number | null;
    error: string | null;
    startedAt: string;
  }[];
};

const size = (n: number) =>
  n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;

/** Instance backups: schedule, destinations, files (download / restore / delete) and recent runs. */
export function BackupsTab() {
  const { t, lang } = useI18n();
  const locale = localeOf(lang);
  const qc = useQueryClient();
  const key = ["admin-backups"];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<BackupInfo>("/admin/backups") });
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const fail = (e: unknown) => setMessage({ text: e instanceof ApiError ? e.message : String(e), error: true });

  const updateSettings = useMutation({
    mutationFn: (s: Partial<BackupInfo["settings"]>) => api.patch("/admin/backups/settings", s),
    onSuccess: refresh,
  });
  const runNow = useMutation({
    mutationFn: () => api.post<BackupInfo["runs"][number]>("/admin/backups"),
    onSuccess: (run) => {
      setMessage(
        run.status === "success"
          ? { text: t("backup.done", { name: run.fileName ?? "" }) }
          : { text: t("backup.failed", { error: run.error ?? "" }), error: true },
      );
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (f: { target: string; name: string }) =>
      api.delete(`/admin/backups/${f.target}/${encodeURIComponent(f.name)}`),
    onSuccess: refresh,
  });

  const afterRestore = (r: { safetyBackup: string }) => {
    setMessage({ text: t("backup.restored", { name: r.safetyBackup }) });
    refresh();
  };
  const restore = useMutation({
    mutationFn: (f: { target: string; name: string }) =>
      api.post<{ safetyBackup: string }>(`/admin/backups/${f.target}/${encodeURIComponent(f.name)}/restore`, {
        confirm: "RESTORE",
      }),
    onSuccess: afterRestore,
    onError: fail,
  });
  const restoreUpload = useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch("/api/admin/restore-upload", {
        method: "POST",
        credentials: "include",
        headers: { "x-confirm": "RESTORE", "Content-Type": "application/octet-stream" },
        body: file,
      });
      const body = await res.json();
      if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
      return body as { safetyBackup: string };
    },
    onSuccess: afterRestore,
    onError: fail,
  });

  const confirmRestore = () => prompt(t("backup.restorePrompt")) === "RESTORE";
  const busy = runNow.isPending || restore.isPending || restoreUpload.isPending;

  if (isLoading || !data)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );

  return (
    <div className="flex flex-col gap-5 pt-4">
      <p className="text-sm text-muted-foreground">{t("backup.intro")}</p>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{t("backup.enabled")}</span>
          <Switch
            checked={data.settings.enabled}
            label={t("backup.enabled")}
            onCheckedChange={(enabled) => updateSettings.mutate({ enabled })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("backup.hour")}</span>
            <select
              value={data.settings.hour}
              onChange={(e) => updateSettings.mutate({ hour: Number(e.target.value) })}
              className="h-8 rounded-md border border-input bg-background px-2 shadow-xs"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">{data.timeZone}</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("backup.retention")}</span>
            <input
              type="number"
              min={1}
              max={365}
              defaultValue={data.settings.retention}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (n >= 1 && n !== data.settings.retention) updateSettings.mutate({ retention: n });
              }}
              className="h-8 w-16 rounded-md border border-input bg-background px-2 text-right shadow-xs"
            />
            <span className="text-muted-foreground">{t("backup.retentionSuffix")}</span>
          </label>
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-[13px]">
          {data.targets.map((tg) => (
            <div key={tg.id} className="flex items-center gap-2">
              {tg.id === "local" ? (
                <HardDrive className="size-4 text-muted-foreground" />
              ) : (
                <Cloud className="size-4 text-muted-foreground" />
              )}
              <span className="font-medium">{tg.id === "local" ? t("backup.local") : t("backup.s3")}</span>
              <span
                className={cn("truncate font-mono text-xs", tg.configured ? "text-muted-foreground" : "text-warning")}
              >
                {tg.configured ? tg.label : t("backup.notConfigured")}
              </span>
            </div>
          ))}
          <div className={cn("flex items-center gap-2", data.encrypted ? "text-success" : "text-warning")}>
            {data.encrypted ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
            {data.encrypted ? t("backup.encrypted") : t("backup.notEncrypted")}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => runNow.mutate()} disabled={busy}>
          {runNow.isPending && <Spinner className="size-3.5" />}
          {runNow.isPending ? t("backup.running") : t("backup.now")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
          {restoreUpload.isPending ? <Spinner className="size-3.5" /> : <Upload />}
          {t("backup.restoreFile")}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".gz,.enc"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f && confirmRestore()) restoreUpload.mutate(f);
          }}
        />
      </div>

      {message && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-md bg-muted p-3 text-[13px]",
            message.error && "text-destructive",
          )}
        >
          {message.error && <CircleAlert className="mt-px size-4 shrink-0" />}
          {message.text}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("backup.files")}</h3>
        {data.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("backup.none")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {data.files.slice(0, 50).map((f) => (
              <li key={`${f.target}:${f.name}`} className="flex items-center gap-2 px-3 py-2">
                {f.target === "local" ? (
                  <HardDrive className="size-4 text-muted-foreground" />
                ) : (
                  <Cloud className="size-4 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm tabular-nums">{new Date(f.date).toLocaleString(locale)}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {f.name} · {size(f.size)}
                  </div>
                </div>
                <a href={`/api/admin/backups/${f.target}/${encodeURIComponent(f.name)}`} download>
                  <IconButton label={t("backup.download")}>
                    <Download className="size-4" />
                  </IconButton>
                </a>
                <IconButton
                  label={t("backup.restore")}
                  disabled={busy}
                  onClick={() => confirmRestore() && restore.mutate(f)}
                >
                  <RotateCcw className="size-4" />
                </IconButton>
                <IconButton label={t("nav.delete")} className="hover:text-destructive" onClick={() => remove.mutate(f)}>
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.runs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("backup.lastRuns")}</h3>
          <ul className="flex flex-col gap-1 text-[13px]">
            {data.runs.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="w-36 shrink-0 text-muted-foreground tabular-nums">
                  {new Date(r.startedAt).toLocaleString(locale)}
                </span>
                <span className="w-28 shrink-0">{t(`backup.kind.${r.kind}`)}</span>
                <span
                  className={cn(
                    "font-medium",
                    r.status === "success"
                      ? "text-success"
                      : r.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                >
                  {t(`backup.status.${r.status}`)}
                </span>
                {r.error && (
                  <span className="truncate text-muted-foreground" title={r.error}>
                    {r.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
