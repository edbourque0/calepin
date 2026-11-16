import { useQueryClient } from "@tanstack/react-query";
import { ChevronsLeft, Home, LogOut, Plus, Search, Settings, Trash2 } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { usePageActions, useSharedPages, useWorkspace } from "@/lib/workspace";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { PageTree } from "./PageTree";
import { Avatar, IconButton, Kbd } from "./ui";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Sidebar({
  onCollapse,
  onNavigate,
  onSearch,
  onTrash,
  onSettings,
}: {
  onCollapse: () => void;
  onNavigate: () => void;
  onSearch: () => void;
  onTrash: () => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const { me, canEdit } = useWorkspace();
  const { data: shared } = useSharedPages();
  const { create } = usePageActions();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const newPage = async () => {
    const page = await create.mutateAsync({});
    navigate(`/p/${page.id}`);
    onNavigate();
  };

  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    navigate("/login");
  };

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar">
      <div className="flex h-14 items-center gap-1 pr-3 pl-2">
        <WorkspaceSwitcher onNavigate={onNavigate} />
        <IconButton label={t("nav.collapse")} onClick={onCollapse}>
          <ChevronsLeft className="size-4" />
        </IconButton>
      </div>

      <div className="mt-2 flex flex-col gap-px px-2">
        <button
          onClick={onSearch}
          className="mb-2 flex h-9 items-center gap-2 rounded-md border border-input bg-background pr-2 pl-2.5 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">{t("nav.search")}</span>
          <Kbd>{isMac ? "⌘K" : "Ctrl K"}</Kbd>
        </button>
        <NavItem to="/" icon={<Home className="size-4" />} onClick={onNavigate} end>
          {t("nav.home")}
        </NavItem>
      </div>

      <nav className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="flex items-center justify-between pr-0 pb-1 pl-2">
          <span className="caps-label">{t("nav.pages")}</span>
          {canEdit && (
            <IconButton label={t("nav.newPage")} onClick={newPage} className="size-6">
              <Plus className="size-4" />
            </IconButton>
          )}
        </div>
        <PageTree onNavigate={onNavigate} />
        {canEdit && (
          <button
            onClick={newPage}
            className="mt-px flex h-[30px] w-full items-center gap-1.5 rounded-sm pl-[30px] text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Plus className="size-4" />
            {t("nav.newPage")}
          </button>
        )}
        {(shared?.length ?? 0) > 0 && (
          <>
            <div className="mt-5 pb-1 pl-2">
              <span className="caps-label">{t("nav.shared")}</span>
            </div>
            <PageTree onNavigate={onNavigate} mode="shared" />
          </>
        )}
      </nav>

      <div className="flex flex-col gap-px border-t border-sidebar-border px-2 py-2">
        <SideButton icon={<Trash2 className="size-4" />} onClick={onTrash}>
          {t("nav.trash")}
        </SideButton>
        <SideButton icon={<Settings className="size-4" />} onClick={onSettings}>
          {t("nav.settings")}
        </SideButton>
      </div>

      <div className="flex items-center gap-3 border-t border-sidebar-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Avatar name={me.user.name} id={me.user.id} size={28} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium">{me.user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{me.user.email}</div>
        </div>
        <IconButton label={t("auth.signOut")} onClick={signOut}>
          <LogOut className="size-4" />
        </IconButton>
      </div>
    </aside>
  );
}

function NavItem({
  to,
  icon,
  children,
  onClick,
  end,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "relative flex h-[30px] items-center gap-2 rounded-sm px-2 text-sm transition-colors hover:bg-sidebar-accent [&_svg]:text-muted-foreground",
          isActive && "bg-sidebar-accent font-medium",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute top-[7px] bottom-[7px] -left-2 w-[3px] rounded-r-[2px] bg-ribbon" />}
          {icon}
          {children}
        </>
      )}
    </NavLink>
  );
}

function SideButton({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-[30px] items-center gap-2 rounded-sm px-2 text-sm transition-colors hover:bg-sidebar-accent [&_svg]:text-muted-foreground"
    >
      {icon}
      {children}
    </button>
  );
}
