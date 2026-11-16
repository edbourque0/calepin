import { env } from "../env.js";
import { getBackupSettings, getSetting, runBackup, setSetting } from "./backup.js";
import { pruneVersions } from "./versions.js";

/**
 * Daily maintenance at the configured hour (container time zone, set TZ):
 * a backup to every configured target, then version-history thinning.
 */
export function startScheduler() {
  const tick = async () => {
    try {
      const cfg = await getBackupSettings();
      const now = new Date();
      if (now.getHours() !== cfg.hour) return;
      const today = now.toLocaleDateString("en-CA");
      const { day } = await getSetting<{ day: string }>("maintenance", { day: "" });
      if (day === today) return;
      await setSetting("maintenance", { day: today });
      if (cfg.enabled) {
        const run = await runBackup("scheduled");
        console.log(`[backup] scheduled backup ${run.status}${run.fileName ? `: ${run.fileName}` : ""}`);
      }
      const pruned = await pruneVersions(env.VERSION_RETENTION_DAYS);
      if (pruned) console.log(`[versions] pruned ${pruned} old versions`);
    } catch (e) {
      console.error("[scheduler]", e);
    }
  };
  setInterval(tick, 60_000).unref();
  void tick();
}
