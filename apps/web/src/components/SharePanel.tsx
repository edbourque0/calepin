import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, Link2, Lock, Users, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api, type Sharing } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { pagesKey, useWorkspace } from "@/lib/workspace";
import { Avatar, Button, IconButton, Spinner, Switch } from "./ui";

/** Copies text and shows a short confirmation. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? <Check /> : <Copy />}
      {done ? t("common.copied") : label}
    </Button>
  );
}

export function RoleSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-8 rounded-md border border-transparent bg-transparent pr-1 pl-2 text-[13px] text-muted-foreground hover:bg-accent disabled:opacity-60"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** The SharePanel pattern from the design system: invite people, see who has access, publish to the web. */
export function SharePanel({ pageId }: { pageId: string }) {
  const { t } = useI18n();
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const key = ["sharing", pageId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<Sharing>(`/pages/${pageId}/sharing`) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [notice, setNotice] = useState<{ text: string; url?: string } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const invite = useMutation({
    mutationFn: (body: { email?: string; role: string }) =>
      api.post<{ status: "member" | "shared" | "invited"; url?: string }>(`/pages/${pageId}/shares`, body),
    onSuccess: (res) => {
      setEmail("");
      if (res.status === "member") setNotice({ text: t("share.alreadyMember") });
      else if (res.status === "shared") setNotice({ text: t("share.shared") });
      else setNotice({ text: t("share.inviteLink"), url: res.url });
      refresh();
    },
  });

  const setGuestRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/pages/${pageId}/shares/${userId}`, { role }),
    onSuccess: refresh,
  });
  const removeGuest = useMutation({
    mutationFn: (userId: string) => api.delete(`/pages/${pageId}/shares/${userId}`),
    onSuccess: refresh,
  });
  const revokeInvite = useMutation({ mutationFn: (id: string) => api.delete(`/invites/${id}`), onSuccess: refresh });
  const publish = useMutation({
    mutationFn: (on: boolean) => (on ? api.post(`/pages/${pageId}/publish`) : api.delete(`/pages/${pageId}/publish`)),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: pagesKey(workspace.id) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    invite.mutate({ email: email.trim(), role });
  };

  if (isLoading || !data)
    return (
      <div className="flex w-[400px] max-w-[calc(100vw-24px)] justify-center p-8">
        <Spinner />
      </div>
    );

  const manage = data.canManage;
  const roleOptions = [
    { value: "editor" as const, label: t("share.canEdit") },
    { value: "viewer" as const, label: t("share.canView") },
  ];
  const publicUrl = data.published ? `${window.location.origin}/s/${data.published.slug}` : null;

  return (
    <div className="flex w-[420px] max-w-[calc(100vw-24px)] flex-col gap-4 p-3">
      {manage ? (
        <form onSubmit={submit} className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("share.invitePlaceholder")}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-xs placeholder:text-muted-foreground"
          />
          <RoleSelect value={role} options={roleOptions} onChange={setRole} />
          <Button type="submit" disabled={!email.trim() || invite.isPending}>
            {t("share.invite")}
          </Button>
        </form>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t("share.readOnlyNote")}</p>
      )}

      {notice && (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3 text-[13px]">
          <div className="flex items-start gap-2">
            <span className="flex-1">{notice.text}</span>
            <button
              onClick={() => setNotice(null)}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {notice.url && (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{notice.url}</span>
              <CopyButton text={notice.url} label={t("share.copy")} />
            </div>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        <li className="flex items-center gap-3">
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Users className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {t("share.workspaceAccess", { name: data.workspace.name })}
            </div>
            <div className="text-xs text-muted-foreground">{t("share.members", { n: data.workspace.members })}</div>
          </div>
        </li>
        {data.guests.map((g) => {
          const inherited = g.pageId !== pageId;
          return (
            <li key={g.userId} className="flex items-center gap-3">
              <Avatar name={g.name} id={g.userId} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{g.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {inherited ? t("share.via", { page: g.pageTitle || t("page.untitled") }) : g.email}
                </div>
              </div>
              <RoleSelect
                value={g.role}
                options={roleOptions}
                disabled={!manage || inherited}
                onChange={(r) => setGuestRole.mutate({ userId: g.userId, role: r })}
              />
              {manage && !inherited && (
                <IconButton label={t("share.remove")} onClick={() => removeGuest.mutate(g.userId)}>
                  <X className="size-4" />
                </IconButton>
              )}
            </li>
          );
        })}
        {data.invites.map((i) => (
          <li key={i.id} className="flex items-center gap-3">
            <span className="flex size-7 items-center justify-center rounded-full border-2 border-dashed border-border text-muted-foreground">
              <Link2 className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{i.email ?? t("share.pending")}</div>
              <div className="text-xs text-muted-foreground">
                {t("share.pending")} · {i.role === "editor" ? t("share.canEdit") : t("share.canView")}
              </div>
            </div>
            {manage && (
              <>
                <IconButton
                  label={t("share.copy")}
                  onClick={() => {
                    navigator.clipboard.writeText(i.url);
                    setNotice({ text: t("share.copied") });
                  }}
                >
                  <Copy className="size-4" />
                </IconButton>
                <IconButton label={t("members.revoke")} onClick={() => revokeInvite.mutate(i.id)}>
                  <X className="size-4" />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ul>

      {manage && (
        <button
          type="button"
          onClick={() => invite.mutate({ role })}
          className="-mt-1 flex items-center gap-2 self-start rounded-sm px-1 text-[13px] text-muted-foreground underline decoration-input underline-offset-4 hover:text-foreground"
        >
          <Link2 className="size-3.5" />
          {t("share.linkOnly")}
        </button>
      )}

      <div className={cn("flex items-center gap-3 rounded-md p-3", data.published ? "bg-ribbon-soft" : "bg-muted")}>
        {data.published ? <Globe className="size-[18px] text-ribbon" /> : <Lock className="size-[18px]" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{data.published ? t("share.public") : t("share.private")}</div>
          <div className={cn("text-xs", data.published ? "text-foreground" : "text-muted-foreground")}>
            {data.published ? t("share.publicHint") : t("share.privateHint")}
          </div>
        </div>
        <Switch
          checked={!!data.published}
          disabled={!manage || publish.isPending}
          onCheckedChange={(on) => publish.mutate(on)}
          label={t("share.public")}
        />
      </div>
      {publicUrl && (
        <div className="-mt-2 flex items-center gap-2">
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            {publicUrl.replace(/^https?:\/\//, "")}
          </a>
          <CopyButton text={publicUrl} label={t("share.copy")} />
        </div>
      )}
    </div>
  );
}
