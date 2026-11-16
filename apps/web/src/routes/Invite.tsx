import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Spinner } from "@/components/ui";
import { api, ApiError, type InviteInfo, type Me } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { storage } from "@/lib/utils";
import { PageIcon } from "@/components/PageIcon";

const workspaceStore = storage<string | null>("workspace", null);

/** Landing page for invitation links: preview, then sign in and accept. */
export function Invite() {
  const { token = "" } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const info = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.get<InviteInfo>(`/invites/${token}`),
    retry: false,
  });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me"), retry: false });
  const signedIn = !!me.data;

  // Lets the server accept a sign-up with this link even when public sign-up is closed.
  useEffect(() => {
    document.cookie = `calepin_invite=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24}; samesite=lax`;
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ workspaceId: string; pageId: string | null }>(`/invites/${token}/accept`);
      document.cookie = "calepin_invite=; path=/; max-age=0";
      if (!res.pageId) workspaceStore.set(res.workspaceId);
      await qc.invalidateQueries();
      navigate(res.pageId ? `/p/${res.pageId}` : "/", { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  const roleLabel = (role: string) =>
    ({ owner: t("members.owner"), editor: t("share.canEdit"), viewer: t("share.canView") })[role] ?? role;

  let body;
  if (info.isLoading || me.isLoading) body = <Spinner />;
  else if (!info.data?.valid)
    body = (
      <div className="flex flex-col items-center gap-3 text-center">
        <CircleAlert className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("invite.invalid")}</p>
        <Link to="/">
          <Button variant="outline" size="sm">
            {t("page.backHome")}
          </Button>
        </Link>
      </div>
    );
  else {
    const d = info.data;
    const inviter = d.inviter ?? t("invite.someone");
    const title =
      d.kind === "page"
        ? t("invite.titlePage", { inviter, page: d.page?.title || t("page.untitled") })
        : t("invite.titleWorkspace", { inviter, workspace: d.workspace });
    body = (
      <div className="flex w-full flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
            {d.kind === "page" ? <PageIcon icon={d.page?.icon} size={20} /> : <Users className="size-5" />}
          </span>
          <div>
            <h1 className="heading">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {d.workspace} · {t("invite.asRole", { role: roleLabel(d.role) })}
            </p>
          </div>
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
            <CircleAlert className="mt-px size-4 shrink-0" />
            {error}
          </p>
        )}
        {signedIn ? (
          <Button size="lg" onClick={accept} disabled={busy}>
            {busy && <Spinner className="size-3.5" />}
            {t("invite.accept")}
          </Button>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("invite.signInFirst")}</p>
            <div className="flex gap-2">
              <Link to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="flex-1">
                <Button size="lg" className="w-full">
                  {t("auth.signIn")}
                </Button>
              </Link>
              <Link to={`/login?mode=signUp&next=${encodeURIComponent(`/invite/${token}`)}`} className="flex-1">
                <Button size="lg" variant="outline" className="w-full">
                  {t("auth.signUp")}
                </Button>
              </Link>
            </div>
          </>
        )}
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
