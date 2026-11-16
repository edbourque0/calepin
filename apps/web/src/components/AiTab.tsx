import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button, Spinner, Switch } from "./ui";

type Provider = "ollama" | "openai" | "anthropic" | "custom";
type AiInfo = {
  enabled: boolean;
  provider: Provider;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  presets: Record<Provider, { baseUrl: string; model: string }>;
};

const input =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs placeholder:text-muted-foreground";
const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "ollama", label: "Ollama" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Other (OpenAI-compatible)" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
    </label>
  );
}

/** Admin settings for the AI assistant (any OpenAI-compatible chat completions API). */
export function AiTab() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-ai"], queryFn: () => api.get<AiInfo>("/admin/ai") });
  const [form, setForm] = useState<Omit<AiInfo, "hasKey" | "presets"> & { apiKey: string }>();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !form)
      setForm({ enabled: data.enabled, provider: data.provider, baseUrl: data.baseUrl, model: data.model, apiKey: "" });
  }, [data, form]);

  if (!data || !form)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );

  const set = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch });
    setStatus(null);
  };
  const pickProvider = (provider: Provider) => {
    const preset = data.presets[provider];
    set({ provider, baseUrl: preset.baseUrl || form.baseUrl, model: preset.model || form.model });
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; reply?: string; error?: string }>("/admin/ai/test", form);
      setStatus({ ok: true, text: t("ai.testOk", { reply: r.reply ?? "" }) });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.put("/admin/ai", form);
      setStatus({ ok: true, text: t("ai.saved") });
      setForm({ ...form, apiKey: "" });
      qc.invalidateQueries({ queryKey: ["admin-ai"] });
      qc.invalidateQueries({ queryKey: ["config"] });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
      <p className="text-sm text-muted-foreground">{t("ai.intro")}</p>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t("ai.enabled")}</span>
        <Switch checked={form.enabled} label={t("ai.enabled")} onCheckedChange={(enabled) => set({ enabled })} />
      </div>
      <Field label={t("ai.provider")}>
        <select value={form.provider} onChange={(e) => pickProvider(e.target.value as Provider)} className={input}>
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("ai.baseUrl")}>
        <input value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} className={input} />
      </Field>
      <Field label={t("ai.model")}>
        <input value={form.model} onChange={(e) => set({ model: e.target.value })} className={input} />
      </Field>
      {form.provider !== "ollama" && (
        <Field label={t("ai.apiKey")}>
          <input
            type="password"
            autoComplete="off"
            value={form.apiKey}
            placeholder={data.hasKey ? t("ai.keyKept") : "sk-…"}
            onChange={(e) => set({ apiKey: e.target.value })}
            className={input}
          />
        </Field>
      )}
      {status && (
        <div
          className={`flex items-start gap-2 rounded-md px-3 py-2 text-[13px] ${status.ok ? "bg-muted" : "bg-destructive/10 text-destructive"}`}
        >
          {status.ok ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="min-w-0 break-words">{status.text}</span>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={test}>
          {t("ai.test")}
        </Button>
        <Button size="sm" disabled={busy} onClick={save}>
          {t("ai.save")}
        </Button>
      </div>
    </div>
  );
}
