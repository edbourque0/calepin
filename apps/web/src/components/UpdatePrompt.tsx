import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useI18n } from "@/lib/i18n";
import { Button, IconButton } from "./ui";

const CHECK_EVERY = 15 * 60 * 1000;

/**
 * Keeps the installed app up to date: checks for a new version every 15 minutes and whenever the app comes
 * back to the foreground, then offers a Reload button instead of requiring a reinstall.
 */
export function UpdatePrompt() {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (registration.installing || !navigator.onLine) return;
        registration.update().catch(() => {});
      };
      setInterval(check, CHECK_EVERY);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
      window.addEventListener("online", check);
    },
  });
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (needRefresh) setDismissed(false);
  }, [needRefresh]);

  if (!needRefresh || dismissed) return null;
  return (
    <div
      role="status"
      className="animate-pop fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-md items-center gap-3 rounded-lg border border-border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg sm:right-4 sm:left-auto"
    >
      <RefreshCw className="size-4 shrink-0 text-ribbon" />
      <span className="flex-1 text-sm">{t("update.available")}</span>
      <Button
        size="sm"
        disabled={reloading}
        onClick={() => {
          setReloading(true);
          void updateServiceWorker(true);
          // Fallback if the new worker doesn't take over by itself.
          setTimeout(() => window.location.reload(), 3000);
        }}
      >
        {t("update.reload")}
      </Button>
      <IconButton label={t("update.later")} onClick={() => setDismissed(true)}>
        <X className="size-4" />
      </IconButton>
    </div>
  );
}
