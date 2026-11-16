import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { db } from "../db/index.js";
import { instanceAdmins } from "../db/schema.js";
import { env } from "../env.js";
import type { AppEnv } from "../http.js";
import {
  BackupError,
  type BackupTarget,
  deleteBackup,
  getBackupSettings,
  listBackups,
  readBackup,
  recentRuns,
  restoreDatabase,
  runBackup,
  setSetting,
  targets,
} from "../lib/backup.js";

const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.viaToken) return c.json({ error: "Use the app to manage backups" }, 403);
  const [admin] = await db.select().from(instanceAdmins).where(eq(instanceAdmins.userId, c.var.user.id));
  if (!admin) return c.json({ error: "Administrators only" }, 403);
  await next();
});

const target = z.enum(["local", "s3"]);
const CONFIRM = "RESTORE";

async function restore(c: { json: (b: unknown, s?: 400) => Response }, data: Buffer) {
  // Safety net: a backup of the current state first.
  const before = await runBackup("before-restore");
  if (before.status !== "success")
    return c.json({ error: `Could not back up the current data first: ${before.error}` }, 400);
  const result = await restoreDatabase(data);
  return c.json({ ok: true, restoredFrom: result.createdAt, safetyBackup: before.fileName });
}

export const adminRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .onError((err, c) => {
    if (err instanceof BackupError) return c.json({ error: err.message }, 400);
    throw err;
  })

  .get("/admin/backups", async (c) =>
    c.json({
      settings: await getBackupSettings(),
      targets: targets(),
      encrypted: !!env.BACKUP_PASSPHRASE,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      files: await listBackups(),
      runs: await recentRuns(),
    }),
  )

  .post("/admin/backups", async (c) => c.json(await runBackup("manual")))

  .patch("/admin/backups/settings", async (c) => {
    const body = z
      .object({
        enabled: z.boolean(),
        hour: z.number().int().min(0).max(23),
        retention: z.number().int().min(1).max(365),
      })
      .partial()
      .parse(await c.req.json());
    const next = { ...(await getBackupSettings()), ...body };
    await setSetting("backup", next);
    return c.json(next);
  })

  .get("/admin/backups/:target/:name", async (c) => {
    const data = await readBackup(target.parse(c.req.param("target")) as BackupTarget, c.req.param("name"));
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${c.req.param("name")}"`,
    });
  })

  .delete("/admin/backups/:target/:name", async (c) => {
    await deleteBackup(target.parse(c.req.param("target")) as BackupTarget, c.req.param("name"));
    return c.json({ ok: true });
  })

  .post("/admin/backups/:target/:name/restore", async (c) => {
    const { confirm } = z.object({ confirm: z.string() }).parse(await c.req.json());
    if (confirm !== CONFIRM) return c.json({ error: `Type ${CONFIRM} to confirm` }, 400);
    const data = await readBackup(target.parse(c.req.param("target")) as BackupTarget, c.req.param("name"));
    return restore(c, data);
  })

  /** Restore from a file uploaded from the browser (raw body). */
  .post("/admin/restore-upload", async (c) => {
    if (c.req.header("x-confirm") !== CONFIRM) return c.json({ error: `Type ${CONFIRM} to confirm` }, 400);
    const data = Buffer.from(await c.req.arrayBuffer());
    if (!data.length) return c.json({ error: "Empty file" }, 400);
    return restore(c, data);
  });
