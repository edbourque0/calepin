import { env } from "../env.js";
import { getBackupSettings, runBackup } from "./backup.js";
import { getSetting, setSetting } from "./settings.js";
import { pruneVersions } from "./versions.js";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { files, pages } from "../db/schema.js";
import * as Y from "yjs";
import { extractCover, getTitle, repeatedTitle, TITLE_TEXT } from "./ydoc.js";
import { randomString } from "./tokens.js";
import { removeFile } from "./storage.js";

/** Files whose page was deleted forever (a day ago or more). */
async function removeOrphanFiles() {
  const orphans = await db
    .select()
    .from(files)
    .where(and(isNull(files.pageId), lt(files.createdAt, new Date(Date.now() - 86_400_000))));
  let removed = 0;
  for (const f of orphans) {
    // Still shown in another page (copied there)? Then that page now owns it.
    const [user] = await db.execute<{ id: string }>(sql`
      SELECT id FROM pages WHERE yjs_state IS NOT NULL AND position(convert_to(${f.id}, 'UTF8') in yjs_state) > 0 LIMIT 1`);
    if (user) {
      await db.update(files).set({ pageId: user.id }).where(eq(files.id, f.id));
      continue;
    }
    await removeFile(f.storage, f.key).catch((e) => console.error("[files] cleanup", e));
    await db.delete(files).where(eq(files.id, f.id));
    removed++;
  }
  return removed;
}

/**
 * One-time repair of titles doubled by an old bug ("NotesNotes"): pages created through the API had their
 * title inserted again each time the server reloaded them. Keeps one copy, then makes every device drop its
 * local cache (which may hold the extra copies) and reload from the server.
 */
async function repairDoubledTitles() {
  if (await getSetting<boolean>("titlesRepaired", false)) return;
  const rows = await db
    .select({ id: pages.id, title: pages.title, state: pages.yjsState })
    .from(pages)
    .where(sql`${pages.yjsState} IS NOT NULL`);
  let fixed = 0;
  for (const r of rows) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, r.state!);
    const text = doc.getText(TITLE_TEXT);
    const len = repeatedTitle(text.toString());
    if (len) {
      text.delete(len, text.length - len);
      await db
        .update(pages)
        .set({ yjsState: Y.encodeStateAsUpdate(doc), title: getTitle(doc) })
        .where(eq(pages.id, r.id));
      fixed++;
      console.log(`[titles] "${text.toString()}" (page ${r.id})`);
    }
    doc.destroy();
  }
  await setSetting("epoch", { id: randomString(12) });
  await setSetting("titlesRepaired", true);
  if (fixed) console.log(`[titles] repaired ${fixed} doubled title(s)`);
}

/** One-time fill of gallery covers for rows saved before covers existed. */
async function backfillCovers() {
  const done = await getSetting<boolean>("coversBackfilled", false);
  if (done) return;
  const rows = await db
    .select({ id: pages.id, state: pages.yjsState })
    .from(pages)
    .where(and(eq(pages.type, "row"), isNull(pages.cover)));
  for (const r of rows) {
    if (!r.state) continue;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, r.state);
    const cover = extractCover(doc);
    doc.destroy();
    if (cover) await db.update(pages).set({ cover }).where(eq(pages.id, r.id));
  }
  await setSetting("coversBackfilled", true);
}

/**
 * Daily maintenance at the configured hour (container time zone, set TZ):
 * a backup to every configured target, then version-history thinning.
 */
export function startScheduler() {
  backfillCovers().catch((e) => console.error("[covers]", e));
  repairDoubledTitles().catch((e) => console.error("[titles]", e));
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
      const removed = await removeOrphanFiles();
      if (removed) console.log(`[files] removed ${removed} files of deleted pages`);
      const pruned = await pruneVersions(env.VERSION_RETENTION_DAYS);
      if (pruned) console.log(`[versions] pruned ${pruned} old versions`);
    } catch (e) {
      console.error("[scheduler]", e);
    }
  };
  setInterval(tick, 60_000).unref();
  void tick();
}
