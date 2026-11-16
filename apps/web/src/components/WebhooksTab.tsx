import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useI18n, useRelativeTime } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { usePages, useWorkspace } from "@/lib/workspace";
import { CopyButton } from "./SharePanel";
import { Button, IconButton, Switch } from "./ui";
import { iconText } from "@/lib/icons";

const EVENTS = ["page.created", "page.updated", "page.deleted", "row.created", "row.updated", "row.deleted"] as const;

type Hook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  scopePageId: string | null;
  enabled: boolean;
  lastStatus: number | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
};

/** Workspace webhooks: owners pick a URL, events and an optional page or database scope. */
export function WebhooksTab() {
  const { t } = useI18n();
  const rel = useRelativeTime();
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const { data: pages = [] } = usePages();
  const key = ["webhooks", workspace.id];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<Hook[]>(`/workspaces/${workspace.id}/webhooks`) });
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [scope, setScope] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: () =>
      api.post<Hook & { secret: string }>(`/workspaces/${workspace.id}/webhooks`, {
        url: url.trim(),
        events,
        scopePageId: scope || null,
      }),
    onSuccess: (h) => {
      setSecret(h.secret);
      setUrl("");
      setEvents([]);
      setScope("");
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; enabled?: boolean }) => api.patch(`/webhooks/${id}`, body),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/webhooks/${id}`), onSuccess: refresh });
  const test = async (id: string) => {
    setTests((s) => ({ ...s, [id]: "…" }));
    const r = await api.post<{ status: number | null; error: string | null }>(`/webhooks/${id}/test`);
    setTests((s) => ({ ...s, [id]: r.error ? `✗ ${r.error}` : `✓ HTTP ${r.status}` }));
    refresh();
  };

  const scopes = pages.filter((p) => p.type !== "row");
  const toggle = (e: string) => setEvents((s) => (s.includes(e) ? s.filter((x) => x !== e) : [...s, e]));

  return (
    <div className="flex flex-col gap-5 pt-4">
      <p className="text-sm text-muted-foreground">{t("webhooks.intro")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) create.mutate();
        }}
        className="flex flex-col gap-3 rounded-lg border border-border p-3"
      >
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://n8n.example.com/webhook/…"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs placeholder:text-muted-foreground"
        />
        <div className="flex flex-wrap gap-1.5">
          {EVENTS.map((e) => (
            <button
              type="button"
              key={e}
              onClick={() => toggle(e)}
              className={cn(
                "h-7 rounded-md border px-2 font-mono text-[11px]",
                events.includes(e)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{t("webhooks.allEvents")}</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
          aria-label={t("webhooks.scope")}
        >
          <option value="">{t("webhooks.wholeWorkspace")}</option>
          {scopes.map((p) => (
            <option key={p.id} value={p.id}>
              {iconText(p.icon) ? `${iconText(p.icon)} ` : ""}
              {p.title || t("page.untitled")}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" className="self-end" disabled={!url.trim() || create.isPending}>
          {t("webhooks.add")}
        </Button>
        {create.error && <span className="text-xs text-destructive">{String(create.error.message)}</span>}
      </form>

      {secret && (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
          <span className="text-[13px] font-medium">{t("webhooks.secret")}</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{secret}</code>
            <CopyButton text={secret} label={t("common.copy")} />
          </div>
        </div>
      )}

      {data?.length === 0 && <span className="text-sm text-muted-foreground">{t("webhooks.empty")}</span>}
      {data && data.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {data.map((h) => (
            <li key={h.id} className="flex items-start gap-3 px-3 py-2.5">
              <Webhook className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">{h.url}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {h.events.length ? h.events.join(", ") : t("webhooks.everything")}
                  {h.scopePageId && ` · ${scopes.find((p) => p.id === h.scopePageId)?.title || t("page.untitled")}`}
                </div>
                <div className="mt-0.5 text-xs">
                  {tests[h.id] ? (
                    <span>{tests[h.id]}</span>
                  ) : h.lastDeliveryAt ? (
                    <span className={h.lastError ? "text-destructive" : "text-muted-foreground"}>
                      {h.lastError ?? `HTTP ${h.lastStatus}`} · {rel(h.lastDeliveryAt)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t("webhooks.never")}</span>
                  )}
                </div>
              </div>
              <Switch
                checked={h.enabled}
                label={t("webhooks.enabled")}
                onCheckedChange={(enabled) => update.mutate({ id: h.id, enabled })}
              />
              <IconButton label={t("webhooks.test")} onClick={() => test(h.id)}>
                <Send className="size-4" />
              </IconButton>
              <IconButton
                label={t("webhooks.delete")}
                className="hover:text-destructive"
                onClick={() => confirm(t("webhooks.deleteConfirm")) && remove.mutate(h.id)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("webhooks.signature")}</p>
    </div>
  );
}
