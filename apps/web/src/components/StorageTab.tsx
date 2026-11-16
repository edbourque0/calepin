import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Cloud, HardDrive } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button, Spinner, Switch, Tabs } from "./ui";

type Preset = "wasabi" | "aws" | "other";
type StorageInfo = {
  provider: "local" | "s3";
  preset: Preset;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  prefix: string;
  useForBackups: boolean;
  hasSecret: boolean;
  envBackupBucket: boolean;
  maxUploadMb: number;
  usage: { storage: "local" | "s3"; count: number; size: number }[];
};

const WASABI_REGIONS = [
  "ca-central-1",
  "us-east-1",
  "us-east-2",
  "us-central-1",
  "us-west-1",
  "us-west-2",
  "eu-central-1",
  "eu-central-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-south-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-southeast-2",
];

const endpointFor = (preset: Preset, region: string) =>
  preset === "wasabi"
    ? `https://s3.${region}.wasabisys.com`
    : preset === "aws"
      ? `https://s3.${region}.amazonaws.com`
      : "";

const formatSize = (n: number) =>
  n > 1_073_741_824
    ? `${(n / 1_073_741_824).toFixed(1)} Go`
    : n > 1_048_576
      ? `${(n / 1_048_576).toFixed(1)} Mo`
      : `${Math.ceil(n / 1024)} Ko`;

const input =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs placeholder:text-muted-foreground";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Admin settings for uploaded files: local disk or a private S3-compatible bucket (Wasabi preset). */
export function StorageTab() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-storage"], queryFn: () => api.get<StorageInfo>("/admin/storage") });
  const [form, setForm] = useState<StorageInfo | null>(null);
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);

  useEffect(() => {
    if (data && !form)
      setForm({
        ...data,
        region: data.region || "ca-central-1",
        endpoint: data.endpoint || endpointFor(data.preset, data.region || "ca-central-1"),
      });
  }, [data, form]);

  if (!form || !data)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );

  const set = (patch: Partial<StorageInfo>) => {
    setStatus(null);
    setForm((f) => {
      const next = { ...f!, ...patch };
      // Wasabi and AWS endpoints follow the region.
      if ((patch.region !== undefined || patch.preset !== undefined) && next.preset !== "other")
        next.endpoint = endpointFor(next.preset, next.region);
      return next;
    });
  };

  const payload = () => ({
    provider: form.provider,
    preset: form.preset,
    endpoint: form.endpoint,
    region: form.region,
    bucket: form.bucket,
    accessKeyId: form.accessKeyId,
    secretAccessKey: secret,
    prefix: form.prefix,
    useForBackups: form.useForBackups,
  });

  const test = async () => {
    setBusy("test");
    try {
      await api.post("/admin/storage/test", payload());
      setStatus({ ok: true, text: t("storage.testOk") });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await api.put("/admin/storage", payload());
      setSecret("");
      setStatus({ ok: true, text: t("storage.saved") });
      qc.invalidateQueries({ queryKey: ["admin-storage"] });
      qc.invalidateQueries({ queryKey: ["admin-backups"] });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const s3 = form.provider === "s3";

  return (
    <div className="flex flex-col gap-5 pt-4">
      <p className="text-sm text-muted-foreground">{t("storage.intro")}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={form.provider}
          onChange={(provider) => set({ provider })}
          items={[
            { value: "local" as const, label: t("storage.local"), icon: <HardDrive /> },
            { value: "s3" as const, label: t("storage.s3"), icon: <Cloud /> },
          ]}
        />
        <span className="text-xs text-muted-foreground">
          {data.usage
            .map(
              (u) =>
                `${u.storage === "s3" ? "S3" : t("storage.local")} : ${t("storage.usage", { count: u.count, size: formatSize(u.size) })}`,
            )
            .join(" · ")}
        </span>
      </div>

      {s3 && (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("storage.preset")}>
              <select value={form.preset} onChange={(e) => set({ preset: e.target.value as Preset })} className={input}>
                <option value="wasabi">{t("storage.wasabi")}</option>
                <option value="aws">{t("storage.aws")}</option>
                <option value="other">{t("storage.other")}</option>
              </select>
            </Field>
            <Field label={t("storage.region")}>
              {form.preset === "wasabi" ? (
                <select value={form.region} onChange={(e) => set({ region: e.target.value })} className={input}>
                  {WASABI_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.region}
                  onChange={(e) => set({ region: e.target.value })}
                  placeholder="us-east-1"
                  className={input}
                />
              )}
            </Field>
          </div>
          <Field label={t("storage.endpoint")}>
            <input
              value={form.endpoint}
              readOnly={form.preset !== "other"}
              onChange={(e) => set({ endpoint: e.target.value })}
              placeholder="https://minio.example.com"
              className={cn(
                input,
                "font-mono text-[13px]",
                form.preset !== "other" && "bg-muted text-muted-foreground",
              )}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("storage.bucket")}>
              <input
                value={form.bucket}
                onChange={(e) => set({ bucket: e.target.value })}
                placeholder="calepin"
                className={input}
              />
            </Field>
            <Field label={t("storage.prefix")}>
              <input
                value={form.prefix}
                onChange={(e) => set({ prefix: e.target.value })}
                placeholder="calepin/"
                className={cn(input, "font-mono text-[13px]")}
              />
            </Field>
            <Field label={t("storage.accessKey")}>
              <input
                value={form.accessKeyId}
                onChange={(e) => set({ accessKeyId: e.target.value })}
                autoComplete="off"
                className={cn(input, "font-mono text-[13px]")}
              />
            </Field>
            <Field
              label={t("storage.secretKey")}
              hint={data.hasSecret && !secret ? t("storage.secretKept") : undefined}
            >
              <input
                type="password"
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  setStatus(null);
                }}
                autoComplete="new-password"
                placeholder={data.hasSecret ? "••••••••••••" : ""}
                className={cn(input, "font-mono text-[13px]")}
              />
            </Field>
          </div>
          {form.preset === "wasabi" && <p className="text-xs text-muted-foreground">{t("storage.wasabiHint")}</p>}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-sm">
              {data.envBackupBucket ? (
                <span className="text-muted-foreground">{t("storage.envBackups")}</span>
              ) : (
                t("storage.useForBackups")
              )}
            </span>
            {!data.envBackupBucket && (
              <Switch
                checked={form.useForBackups}
                label={t("storage.useForBackups")}
                onCheckedChange={(useForBackups) => set({ useForBackups })}
              />
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("storage.limit", { n: data.maxUploadMb })}</p>

      {status && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-md bg-muted p-3 text-[13px]",
            status.ok ? "text-success" : "text-destructive",
          )}
        >
          {status.ok ? (
            <CircleCheck className="mt-px size-4 shrink-0" />
          ) : (
            <CircleAlert className="mt-px size-4 shrink-0" />
          )}
          <span className="text-foreground">{status.text}</span>
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={save} disabled={!!busy}>
          {busy === "save" && <Spinner className="size-3.5" />}
          {t("storage.save")}
        </Button>
        {s3 && (
          <Button variant="outline" onClick={test} disabled={!!busy}>
            {busy === "test" && <Spinner className="size-3.5" />}
            {t("storage.test")}
          </Button>
        )}
      </div>
    </div>
  );
}
