import { ChevronsRight, Menu } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Outlet } from "react-router";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { cn, storage } from "@/lib/utils";
import { SearchDialog } from "./SearchDialog";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";
import { TrashDialog } from "./TrashDialog";
import { IconButton } from "./ui";

const collapsedStore = storage<boolean>("sidebar-collapsed", false);

type Shell = { sidebarHidden: boolean; showSidebar: () => void; openSearch: () => void };
const ShellContext = createContext<Shell | null>(null);
export const useShell = () => useContext(ShellContext)!;

export function AppShell() {
  const { theme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(collapsedStore.get);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dialog, setDialog] = useState<"search" | "trash" | "settings" | null>(null);

  // Warm up the editor bundle so the first page opens instantly.
  useEffect(() => {
    const id = setTimeout(() => import("./Editor"), 300);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog((d) => (d === "search" ? null : "search"));
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setTheme(theme === "dark" ? "light" : "dark");
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setTheme(theme === "dark" ? "light" : "dark");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleCollapsed = (value?: boolean) => {
    setCollapsed((c) => {
      const next = value ?? !c;
      collapsedStore.set(next);
      return next;
    });
  };

  const isMobile = () => window.matchMedia("(max-width: 767px)").matches;
  const shell: Shell = {
    sidebarHidden: collapsed,
    showSidebar: () => (isMobile() ? setMobileOpen(true) : toggleCollapsed(false)),
    openSearch: () => setDialog("search"),
  };

  const sidebar = (
    <Sidebar
      onCollapse={() => (isMobile() ? setMobileOpen(false) : toggleCollapsed(true))}
      onNavigate={() => setMobileOpen(false)}
      onSearch={() => {
        setMobileOpen(false);
        setDialog("search");
      }}
      onTrash={() => setDialog("trash")}
      onSettings={() => setDialog("settings")}
    />
  );

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-full">
        {/* Desktop sidebar */}
        <div
          className={cn(
            "hidden shrink-0 overflow-hidden border-r border-sidebar-border transition-[width] duration-200 ease-out md:block",
            collapsed ? "w-0 border-r-0" : "w-[260px]",
          )}
        >
          <div className="h-full w-[260px]">{sidebar}</div>
        </div>

        {/* Mobile drawer */}
        <div className={cn("fixed inset-0 z-30 md:hidden", !mobileOpen && "pointer-events-none")}>
          <div
            onClick={() => setMobileOpen(false)}
            className={cn("absolute inset-0 bg-black/50 transition-opacity", mobileOpen ? "opacity-100" : "opacity-0")}
          />
          <div
            className={cn(
              "absolute inset-y-0 left-0 w-[85vw] max-w-[320px] border-r border-sidebar-border transition-transform duration-200 ease-out",
              mobileOpen ? "translate-x-0 shadow-lg" : "invisible -translate-x-full",
            )}
          >
            {sidebar}
          </div>
        </div>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <SearchDialog open={dialog === "search"} onClose={() => setDialog(null)} />
      <TrashDialog open={dialog === "trash"} onClose={() => setDialog(null)} />
      <SettingsDialog open={dialog === "settings"} onClose={() => setDialog(null)} />
    </ShellContext.Provider>
  );
}

/** Sticky top bar used by every screen: sidebar toggle, then custom content. */
export function TopBar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  const { t } = useI18n();
  const { sidebarHidden, showSidebar } = useShell();
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-2 bg-background/90 px-3 backdrop-blur-md md:px-4">
      <IconButton label={t("nav.menu")} onClick={showSidebar} className="md:hidden">
        <Menu className="size-4" />
      </IconButton>
      {sidebarHidden && (
        <IconButton label={t("nav.menu")} onClick={showSidebar} className="max-md:hidden">
          <ChevronsRight className="size-4" />
        </IconButton>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
      {right && <div className="flex shrink-0 items-center gap-3">{right}</div>}
    </header>
  );
}
