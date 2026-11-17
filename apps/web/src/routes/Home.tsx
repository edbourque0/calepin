import { ArrowRight, CalendarDays, Clock, FileText, Layers, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { TopBar, useShell } from "@/components/AppShell";
import { Button } from "@/components/ui";
import { useI18n, useRelativeTime } from "@/lib/i18n";
import { usePageActions, usePageIndex, usePages, useWorkspace } from "@/lib/workspace";
import { PageIcon } from "@/components/PageIcon";

export function Home() {
  const { t } = useI18n();
  const rel = useRelativeTime();
  const { me } = useWorkspace();
  const { data: pages = [] } = usePages();
  const index = usePageIndex();
  const { create } = usePageActions();
  const { openSearch } = useShell();
  const navigate = useNavigate();

  const hour = new Date().getHours();
  const greeting = t(
    hour < 12 ? "home.greeting.morning" : hour < 18 ? "home.greeting.afternoon" : "home.greeting.evening",
  );
  const firstName = me.user.name.split(" ")[0];

  const now = Date.now();
  const day = 86_400_000;
  const editedToday = pages.filter((p) => now - new Date(p.updatedAt).getTime() < day).length;
  const editedWeek = pages.filter((p) => now - new Date(p.updatedAt).getTime() < 7 * day).length;
  const recent = [...pages].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8);

  const newPage = async () => {
    const page = await create.mutateAsync({});
    navigate(`/p/${page.id}`);
  };

  return (
    <>
      <TopBar
        right={
          <Button size="sm" onClick={newPage}>
            <Plus className="size-4" />
            {t("nav.newPage")}
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-[1040px] px-5 pt-6 pb-24 md:px-10 md:pt-10">
        <h1 className="page-title max-md:text-[32px] max-md:leading-[40px]">
          {greeting}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("app.tagline")}</p>

        <div className="mt-6 grid grid-cols-3 gap-2 sm:mt-8 sm:gap-4">
          <StatCard icon={<Layers className="size-4" />} label={t("home.pages")} value={pages.length} />
          <StatCard icon={<Clock className="size-4" />} label={t("home.today")} value={editedToday} />
          <StatCard icon={<CalendarDays className="size-4" />} label={t("home.thisWeek")} value={editedWeek} />
        </div>

        <button
          onClick={openSearch}
          className="mt-6 flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground shadow-xs md:hidden"
        >
          {t("search.placeholder")}
        </button>

        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="caps-label">{t("home.recent")}</h2>
          </div>
          {recent.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center">
              <FileText className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("home.empty")}</p>
              <Button size="sm" className="mt-1" onClick={newPage}>
                <Plus className="size-4" />
                {t("nav.newPage")}
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              {recent.map((p, i) => {
                const path = index.ancestors(p.id);
                return (
                  <Link
                    key={p.id}
                    to={`/p/${p.id}`}
                    className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                      <PageIcon icon={p.icon} type={p.type} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.title || t("page.untitled")}</span>
                      {path.length > 0 && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {path.map((a) => a.title || t("page.untitled")).join(" / ")}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                      {rel(p.updatedAt)}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 max-md:hidden" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3 shadow-sm sm:p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
        <span className="max-sm:hidden">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums sm:mt-3 sm:text-[32px] sm:leading-10">
        {value}
      </div>
    </div>
  );
}
