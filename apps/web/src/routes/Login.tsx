import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Spinner } from "@/components/ui";
import { api, type AppConfig } from "@/lib/api";
import { authClient, OIDC_PROVIDER_ID } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n";

export function Login() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: () => api.get<AppConfig>("/config") });
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name.trim() || email.split("@")[0]! });
    setBusy(false);
    if (res.error) {
      setError(res.error.message || t("auth.error"));
      return;
    }
    await qc.invalidateQueries({ queryKey: ["me"] });
    navigate("/", { replace: true });
  };

  const sso = () => authClient.signIn.social({ provider: OIDC_PROVIDER_ID, callbackURL: "/" });

  const input =
    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground";

  return (
    <div className="flex min-h-full items-center justify-center px-5 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <h1 className="wordmark text-[28px] leading-9">Calepin</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("app.tagline")}</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          {config?.oidc && (
            <>
              <Button variant="outline" className="w-full" onClick={sso}>
                <KeyRound className="size-4" />
                {t("auth.continueWith", { name: config.oidc.name })}
              </Button>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("auth.or")}
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}
          <form onSubmit={submit} className="flex flex-col gap-3">
            {mode === "signUp" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t("auth.name")}</span>
                <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t("auth.email")}</span>
              <input
                className={input}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t("auth.password")}</span>
              <input
                className={input}
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              />
            </label>
            {error && (
              <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
                <CircleAlert className="mt-px size-4 shrink-0" />
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
              {busy && <Spinner className="size-3.5" />}
              {mode === "signIn" ? t("auth.signIn") : t("auth.signUp")}
            </Button>
          </form>
        </div>

        {config?.allowSignup && (
          <p className="mt-5 text-center text-sm text-muted-foreground">
            {mode === "signIn" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
            <button
              onClick={() => {
                setMode(mode === "signIn" ? "signUp" : "signIn");
                setError(null);
              }}
              className="font-medium text-foreground underline decoration-input underline-offset-4 hover:decoration-foreground"
            >
              {mode === "signIn" ? t("auth.signUp") : t("auth.signIn")}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
