import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DatabaseBackup,
  HardDrive,
  Download,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, type ApiToken, type Members, type Role } from "@/lib/api";
import { type Lang, useI18n, useRelativeTime } from "@/lib/i18n";
import { type ThemePref, useTheme } from "@/lib/theme";
import { useWorkspace } from "@/lib/workspace";
import { BackupsTab } from "./BackupsTab";
import { StorageTab } from "./StorageTab";
import { WebhooksTab } from "./WebhooksTab";
import { AiTab } from "./AiTab";
import { CopyButton, RoleSelect } from "./SharePanel";
import { Avatar, Button, Dialog, IconButton, Spinner, Tabs } from "./ui";

type Tab = "general" | "workspace" | "tokens" | "webhooks" | "ai" | "storage" | "backups";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("general");
  const { me, workspace } = useWorkspace();
  const isOwner = me.workspaces.find((w) => w.id === workspace.id)?.role === "owner";
  useEffect(() => {
    if (open) setTab("general");
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-3xl">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <h2 className="heading">{t("settings.title")}</h2>
        <IconButton label={t("common.cancel")} onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="overflow-x-auto px-5 pt-4 [&_[role=tab]]:whitespace-nowrap">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "general", label: t("settings.tabGeneral"), icon: <Settings2 /> },
            { value: "workspace", label: t("settings.tabWorkspace"), icon: <Users /> },
            { value: "tokens", label: t("settings.tabTokens"), icon: <KeyRound /> },
            ...(isOwner ? [{ value: "webhooks" as const, label: t("webhooks.tab"), icon: <Webhook /> }] : []),
            ...(me.isAdmin
              ? [
                  { value: "ai" as const, label: t("ai.tab"), icon: <Sparkles /> },
                  { value: "storage" as const, label: t("storage.tab"), icon: <HardDrive /> },
                  { value: "backups" as const, label: t("backup.tab"), icon: <DatabaseBackup /> },
                ]
              : []),
          ]}
        />
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-5 pb-5">
        {tab === "general" && <GeneralTab />}
        {tab === "workspace" && <WorkspaceTab onClose={onClose} />}
        {tab === "tokens" && <TokensTab />}
        {tab === "webhooks" && <WebhooksTab />}
        {tab === "ai" && <AiTab />}
        {tab === "storage" && <StorageTab />}
        {tab === "backups" && <BackupsTab />}
      </div>
    </Dialog>
  );
}

/* ---------- General ---------- */

function GeneralTab() {
  const { t, lang, setLang } = useI18n();
  const { pref, setPref } = useTheme();
  return (
    <div className="divide-y divide-border">
      <Row label={t("settings.theme")}>
        <Tabs<ThemePref>
          value={pref}
          onChange={setPref}
          items={[
            { value: "system", label: t("settings.system"), icon: <Monitor /> },
            { value: "light", label: t("settings.light"), icon: <Sun /> },
            { value: "dark", label: t("settings.dark"), icon: <Moon /> },
          ]}
        />
      </Row>
      <Row label={t("settings.language")}>
        <Tabs<Lang>
          value={lang}
          onChange={setLang}
          items={[
            { value: "fr", label: "Français" },
            { value: "en", label: "English" },
          ]}
        />
      </Row>
    </div>
  );
}

/* ---------- Workspace: name, members, invitations ---------- */

function WorkspaceTab({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { workspace, me } = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ["members", workspace.id];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<Members>(`/workspaces/${workspace.id}/members`) });
  const [name, setName] = useState(workspace.name);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const owner = workspace.role === "owner";
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const roleOptions = [
    { value: "owner" as const, label: t("members.owner") },
    { value: "editor" as const, label: t("members.editor") },
    { value: "viewer" as const, label: t("members.viewer") },
  ];

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === workspace.name) return;
    await api.patch(`/workspaces/${workspace.id}`, { name: trimmed });
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  const invite = useMutation({
    mutationFn: (body: { email?: string; role: Role }) =>
      api.post<{ status: "added" | "invited"; url?: string }>(`/workspaces/${workspace.id}/invites`, body),
    onSuccess: (res) => {
      setEmail("");
      if (res.status === "added") {
        setMessage(t("members.added"));
        setLink(null);
      } else {
        setMessage(t("share.inviteLink"));
        setLink(res.url ?? null);
      }
      refresh();
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api.patch(`/workspaces/${workspace.id}/members/${userId}`, { role }),
    onSuccess: refresh,
    onError: (e: Error) => setMessage(e.message),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`/workspaces/${workspace.id}/members/${userId}`),
    onSuccess: async (_d, userId) => {
      if (userId === me.user.id) {
        await qc.invalidateQueries({ queryKey: ["me"] });
        onClose();
        navigate("/");
      } else refresh();
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/invites/${id}`), onSuccess: refresh });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate({ email: email.trim() || undefined, role });
  };

  return (
    <div className="flex flex-col gap-5 pt-4">
      {owner && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("settings.workspace")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs"
          />
        </label>
      )}

      <section className="flex items-center gap-3 rounded-lg border border-border p-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{t("export.workspace")}</div>
          <div className="text-[13px] text-muted-foreground">{t("export.workspaceHint")}</div>
        </div>
        <a href={`/api/workspaces/${workspace.id}/export`} download>
          <Button variant="outline" size="sm">
            <Download />
            {t("export.download")}
          </Button>
        </a>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("members.title")}</h3>
        {owner && (
          <form onSubmit={submit} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("members.invitePlaceholder")}
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-xs placeholder:text-muted-foreground"
            />
            <RoleSelect value={role} options={roleOptions} onChange={setRole} />
            <Button type="submit" disabled={invite.isPending}>
              {t("share.invite")}
            </Button>
          </form>
        )}
        {message && (
          <div className="flex flex-col gap-2 rounded-md bg-muted p-3 text-[13px]">
            <span>{message}</span>
            {link && (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{link}</span>
                <CopyButton text={link} label={t("share.copy")} />
              </div>
            )}
          </div>
        )}
        {!data ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.members.map((m) => {
              const self = m.userId === me.user.id;
              return (
                <li key={m.userId} className="flex items-center gap-3">
                  <Avatar name={m.name} id={m.userId} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {m.name} {self && <span className="font-normal text-muted-foreground">({t("members.you")})</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  <RoleSelect
                    value={m.role}
                    options={roleOptions}
                    disabled={!owner}
                    onChange={(r) => changeRole.mutate({ userId: m.userId, role: r })}
                  />
                  {(owner || self) && (
                    <IconButton
                      label={self ? t("members.leave") : t("members.remove")}
                      onClick={() => remove.mutate(m.userId)}
                    >
                      {self ? <LogOut className="size-4" /> : <X className="size-4" />}
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {data && data.invites.length > 0 && (
          <>
            <h4 className="pt-2 text-xs font-medium text-muted-foreground">{t("members.pending")}</h4>
            <ul className="flex flex-col gap-2">
              {data.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{i.email ?? i.url}</span>
                  <span className="text-xs text-muted-foreground">
                    {roleOptions.find((o) => o.value === i.role)?.label}
                  </span>
                  <CopyButton text={i.url} label={t("common.copy")} />
                  <IconButton label={t("members.revoke")} onClick={() => revoke.mutate(i.id)}>
                    <X className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/* ---------- API tokens + MCP ---------- */

function TokensTab() {
  const { t } = useI18n();
  const rel = useRelativeTime();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["tokens"], queryFn: () => api.get<ApiToken[]>("/tokens") });
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const mcpUrl = `${window.location.origin}/mcp`;

  const create = useMutation({
    mutationFn: (n: string) => api.post<ApiToken & { token: string }>("/tokens", { name: n }),
    onSuccess: (res) => {
      setCreated(res.token);
      setName("");
      qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });

  const config = JSON.stringify(
    {
      mcpServers: {
        calepin: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${created ?? "<token>"}` } },
      },
    },
    null,
    2,
  );

  return (
    <div className="flex flex-col gap-5 pt-4">
      <p className="text-sm text-muted-foreground">{t("tokens.intro")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("tokens.namePlaceholder")}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-xs placeholder:text-muted-foreground"
        />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {t("tokens.create")}
        </Button>
      </form>

      {created && (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
          <span className="text-[13px] font-medium">{t("tokens.copyNow")}</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{created}</code>
            <CopyButton text={created} label={t("common.copy")} />
          </div>
        </div>
      )}

      {data?.length === 0 && <p className="text-sm text-muted-foreground">{t("tokens.empty")}</p>}
      {data && data.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {data.map((tk) => (
            <li key={tk.id} className="flex items-center gap-3 px-3 py-2.5">
              <KeyRound className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{tk.name}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{tk.prefix}…</span> ·{" "}
                  {tk.lastUsedAt ? t("tokens.lastUsed", { when: rel(tk.lastUsedAt) }) : t("tokens.never")}
                </div>
              </div>
              <IconButton
                label={t("tokens.revoke")}
                className="hover:text-destructive"
                onClick={() => revoke.mutate(tk.id)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("tokens.mcp")}</h3>
        <p className="text-[13px] text-muted-foreground">{t("tokens.mcpOauthHint")}</p>
        <p className="text-[13px] text-muted-foreground">{t("tokens.mcpHint")}</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">{mcpUrl}</code>
          <CopyButton text={mcpUrl} label={t("common.copy")} />
        </div>
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5">{config}</pre>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
