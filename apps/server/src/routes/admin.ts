import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { db } from "../db/index.js";
import { files, instanceAdmins } from "../db/schema.js";
import { env, s3Enabled } from "../env.js";
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
import { openSecret } from "../lib/secrets.js";
import { getStorageSettings, normalizePrefix, s3ConfigFrom, saveStorageSettings, testBucket } from "../lib/storage.js";

const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.viaToken) return c.json({ error: "Use the app to manage backups" }, 403);
  const [admin] = await db.select().from(instanceAdmins).where(eq(instanceAdmins.userId, c.var.user.id));
  if (!admin) return c.json({ error: "Administrators only" }, 403);
  await next();
});

const target = z.enum(["local", "s3"]);

const storageInput = z
  .object({
    provider: z.enum(["local", "s3"]),
    preset: z.enum(["wasabi", "aws", "other"]),
    endpoint: z.string().trim().url().or(z.literal("")),
    region: z.string().trim().max(50),
    bucket: z.string().trim().max(63),
    accessKeyId: z.string().trim().max(200),
    /** Empty = keep the stored secret. */
    secretAccessKey: z.string().max(500),
    prefix: z.string().trim().max(200),
    useForBackups: z.boolean(),
  })
  .partial();
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
      targets: await targets(),
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

  /* ----- File storage (local disk or S3-compatible bucket) ----- */
  .get("/admin/storage", async (c) => {
    const s = await getStorageSettings();
    const { secretSealed, ...rest } = s;
    const usage = await db
      .select({
        storage: files.storage,
        count: sql<number>`count(*)::int`,
        size: sql<number>`coalesce(sum(${files.size}), 0)::bigint`,
      })
      .from(files)
      .groupBy(files.storage);
    return c.json({
      ...rest,
      hasSecret: !!openSecret(secretSealed),
      envBackupBucket: s3Enabled,
      maxUploadMb: env.MAX_UPLOAD_MB,
      usage: usage.map((u) => ({ ...u, size: Number(u.size) })),
    });
  })

  .post("/admin/storage/test", async (c) => {
    const body = storageInput.parse(await c.req.json());
    const current = await getStorageSettings();
    const cfg = s3ConfigFrom(
      { ...current, ...body, prefix: normalizePrefix(body.prefix ?? current.prefix) },
      body.secretAccessKey,
    );
    if (!cfg) return c.json({ ok: false, error: "Fill in the endpoint, bucket and keys" }, 400);
    try {
      await testBucket(cfg);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }
  })

  .put("/admin/storage", async (c) => {
    const body = storageInput.parse(await c.req.json());
    const current = await getStorageSettings();
    if ((body.provider ?? current.provider) === "s3") {
      // Never switch uploads to a bucket that doesn't work.
      const cfg = s3ConfigFrom(
        { ...current, ...body, prefix: normalizePrefix(body.prefix ?? current.prefix) },
        body.secretAccessKey,
      );
      if (!cfg) return c.json({ error: "Fill in the endpoint, bucket and keys" }, 400);
      try {
        await testBucket(cfg);
      } catch (e) {
        return c.json({ error: `The bucket isn't reachable: ${e instanceof Error ? e.message : e}` }, 400);
      }
    }
    const saved = await saveStorageSettings(body);
    const { secretSealed, ...rest } = saved;
    return c.json({ ...rest, hasSecret: !!openSecret(secretSealed) });
  })

  /** Restore from a file uploaded from the browser (raw body). */
  .post("/admin/restore-upload", async (c) => {
    if (c.req.header("x-confirm") !== CONFIRM) return c.json({ error: `Type ${CONFIRM} to confirm` }, 400);
    const data = Buffer.from(await c.req.arrayBuffer());
    if (!data.length) return c.json({ error: "Empty file" }, 400);
    return restore(c, data);
  });
