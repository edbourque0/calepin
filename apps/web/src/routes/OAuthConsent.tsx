import { useQuery } from "@tanstack/react-query";
import { CircleAlert, FilePen, KeyRound, PlugZap } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router";
import { Avatar, Button, Spinner } from "@/components/ui";
import { api, ApiError, type Me } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/**
 * OAuth authorization endpoint (/oauth/authorize): lets an MCP client such as Claude act on
 * Calepin as the signed-in person. The server checks the request and issues the code.
 */
export function OAuthConsent() {
  const { t } = useI18n();
  const request = Object.fromEntries(new URLSearchParams(window.location.search));
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me"), retry: false });
  const check = useQuery({
    queryKey: ["oauth-check", window.location.search],
    queryFn: () => api.post<{ clientName: string; redirectHost: string }>("/oauth/check", request),
    enabled: !!me.data,
    retry: false,
  });

  if (me.error instanceof ApiError && me.error.status === 401) {
    const here = window.location.pathname + window.location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
  }

  const decide = async (approve: boolean) => {
    setBusy(approve ? "allow" : "deny");
    setError(null);
    try {
      const { redirect } = await api.post<{ redirect: string }>("/oauth/decide", { ...request, approve });
      window.location.assign(redirect);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(null);
    }
  };

  let body;
  if (me.isLoading || check.isLoading) body = <Spinner />;
  else if (check.error || !check.data || !me.data)
    body = (
      <div className="flex flex-col items-center gap-3 text-center">
        <CircleAlert className="size-5 text-destructive" />
        <p className="text-sm text-muted-foreground">
          {check.error instanceof ApiError ? check.error.message : t("oauth.invalid")}
        </p>
      </div>
    );
  else {
    const { clientName, redirectHost } = check.data;
    const user = me.data.user;
    body = (
      <div className="flex w-full flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
            <PlugZap className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="heading">{t("oauth.title", { app: clientName })}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("oauth.subtitle", { host: redirectHost })}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2.5">
          <Avatar name={user.name} id={user.id} size={28} />
          <div className="min-w-0 text-sm">
            <div className="truncate font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
        </div>

        <ul className="flex flex-col gap-3 text-sm">
          <li className="flex gap-3">
            <FilePen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{t("oauth.scopeContent", { app: clientName })}</span>
          </li>
          <li className="flex gap-3">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{t("oauth.scopeRevoke")}</span>
          </li>
        </ul>

        {error && (
          <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
            <CircleAlert className="mt-px size-4 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="lg" className="flex-1" disabled={!!busy} onClick={() => decide(false)}>
            {busy === "deny" && <Spinner className="size-3.5" />}
            {t("oauth.deny")}
          </Button>
          <Button size="lg" className="flex-1" disabled={!!busy} onClick={() => decide(true)}>
            {busy === "allow" && <Spinner className="size-3.5" />}
            {t("oauth.allow")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-5 py-12">
      <span className="wordmark text-[22px]">Calepin</span>
      <div className="flex w-full max-w-[420px] justify-center rounded-lg border border-border bg-card p-6 shadow-sm">
        {body}
      </div>
    </div>
  );
}
