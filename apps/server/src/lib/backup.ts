import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { AwsClient } from "aws4fetch";
import { desc, eq } from "drizzle-orm";
import { hocuspocus, setRestoring } from "../collab.js";
import { client, db } from "../db/index.js";
import { backupRuns, settings } from "../db/schema.js";
import { env, s3Enabled } from "../env.js";
import { emitReset } from "./events.js";
import { randomString } from "./tokens.js";

/** Tables in the order they can be re-inserted (parents before children). backup_runs is not backed up. */
const TABLES = [
  "user",
  "account",
  "session",
  "verification",
  "workspaces",
  "workspace_members",
  "pages",
  "page_shares",
  "invites",
  "api_tokens",
  "db_properties",
  "db_relations",
  "db_views",
  "page_versions",
  "instance_admins",
  "settings",
] as const;

const FORMAT = "calepin-backup";
const MAGIC = Buffer.from("CALEPINENC1");

export type BackupTarget = "local" | "s3";
export type BackupFile = { target: BackupTarget; name: string; size: number; date: string };
export type BackupSettings = { enabled: boolean; hour: number; retention: number };
const DEFAULT_SETTINGS: BackupSettings = { enabled: true, hour: 3, retention: 14 };

export class BackupError extends Error {}

/* ---------- Settings ---------- */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  return row ? ({ ...(fallback as object), ...(row.value as object) } as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export const getBackupSettings = () => getSetting<BackupSettings>("backup", DEFAULT_SETTINGS);

/** Changes whenever the whole database is replaced, so clients know to drop their offline cache. */
export async function getEpoch() {
  const { id } = await getSetting<{ id: string }>("epoch", { id: "" });
  if (id) return id;
  const fresh = randomString(12);
  await setSetting("epoch", { id: fresh });
  return fresh;
}

/* ---------- Encoding ---------- */

function encrypt(data: Buffer) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(env.BACKUP_PASSPHRASE, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

function decrypt(data: Buffer) {
  if (!env.BACKUP_PASSPHRASE) throw new BackupError("This backup is encrypted: set BACKUP_PASSPHRASE to restore it");
  const at = MAGIC.length;
  const salt = data.subarray(at, at + 16);
  const iv = data.subarray(at + 16, at + 28);
  const tag = data.subarray(at + 28, at + 44);
  const key = scryptSync(env.BACKUP_PASSPHRASE, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data.subarray(at + 44)), decipher.final()]);
  } catch {
    throw new BackupError("Wrong BACKUP_PASSPHRASE for this backup");
  }
}

async function migrationCount() {
  const rows = await client`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
  return (rows[0]?.n as number) ?? 0;
}

/** Serialises every table through Postgres' own JSON, which round-trips all types exactly. */
export async function dumpDatabase() {
  const tables: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const [row] = await client.unsafe(`SELECT coalesce(json_agg(t), '[]'::json) AS data FROM "${table}" t`);
    tables[table] = (row?.data as unknown[]) ?? [];
  }
  const payload = {
    format: FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    migrations: await migrationCount(),
    tables,
  };
  let data = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 6 });
  if (env.BACKUP_PASSPHRASE) data = encrypt(data);
  return data;
}

function parseBackup(raw: Buffer) {
  let data = raw;
  if (data.subarray(0, MAGIC.length).equals(MAGIC)) data = decrypt(data);
  let json: { format?: string; migrations?: number; tables?: Record<string, Record<string, unknown>[]> };
  try {
    json = JSON.parse(gunzipSync(data).toString("utf8"));
  } catch {
    throw new BackupError("This file is not a Calepin backup");
  }
  if (json.format !== FORMAT || !json.tables) throw new BackupError("This file is not a Calepin backup");
  return json as { migrations: number; createdAt: string; tables: Record<string, Record<string, unknown>[]> };
}

/** Parents before children, so the self-reference of pages.parent_id holds while inserting. */
function sortPages(rows: Record<string, unknown>[]) {
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    const parent = byId.get(id)?.parent_id as string | null;
    const d = parent && byId.has(parent) && !seen.has(parent) ? depthOf(parent, seen.add(id)) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  return [...rows].sort((a, b) => depthOf(a.id as string) - depthOf(b.id as string));
}

/**
 * Replaces the whole database with the backup's content, in one transaction.
 * Live documents are dropped from memory so nobody writes stale content back.
 */
export async function restoreDatabase(raw: Buffer) {
  const backup = parseBackup(raw);
  const current = await migrationCount();
  if (backup.migrations > current)
    throw new BackupError("This backup comes from a newer version of Calepin: update Calepin first");

  hocuspocus.flushPendingStores();
  await new Promise((r) => setTimeout(r, 1500));
  setRestoring(true);
  try {
    hocuspocus.closeConnections();
    for (const name of [...hocuspocus.documents.keys()]) {
      hocuspocus.documents.get(name)?.destroy();
      hocuspocus.documents.delete(name);
    }

    await client.begin(async (tx) => {
      await tx.unsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
      for (const table of TABLES) {
        let rows = backup.tables[table] ?? [];
        if (!rows.length) continue;
        if (table === "pages") rows = sortPages(rows);
        const cols = await tx<{ column_name: string }[]>`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table} AND is_generated = 'NEVER'`;
        const present = new Set(rows.flatMap((r) => Object.keys(r)));
        // Only columns both in the backup and in this version (older backups lack newer columns: defaults apply).
        const columns = cols.map((c) => c.column_name).filter((c) => present.has(c));
        const list = columns.map((c) => `"${c}"`).join(", ");
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          await tx.unsafe(
            `INSERT INTO "${table}" (${list}) SELECT ${list} FROM json_populate_recordset(null::"${table}", $1::json)`,
            [JSON.stringify(chunk)],
          );
        }
      }
    });
    await setSetting("epoch", { id: randomString(12) });
  } finally {
    setRestoring(false);
  }
  emitReset();
  return { createdAt: backup.createdAt };
}

/* ---------- Targets ---------- */

const backupDir = () => path.resolve(env.BACKUP_DIR);
const s3 = () =>
  new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION,
    service: "s3",
  });
const s3Url = (key = "") => `${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET}/${key}`;
const s3Key = (name: string) => `${env.S3_PREFIX}${name}`;
const VALID_NAME = /^calepin-[\dTZ-]+(-[a-z-]+)?\.json\.gz(\.enc)?$/;

export function targets() {
  return [
    { id: "local" as const, label: backupDir(), configured: true },
    { id: "s3" as const, label: s3Enabled ? `${env.S3_BUCKET}/${env.S3_PREFIX}` : "", configured: s3Enabled },
  ];
}

async function writeTarget(target: BackupTarget, name: string, data: Buffer) {
  if (target === "local") {
    await mkdir(backupDir(), { recursive: true });
    await writeFile(path.join(backupDir(), name), data);
    return;
  }
  const res = await s3().fetch(s3Url(s3Key(name)), {
    method: "PUT",
    body: new Uint8Array(data),
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`S3 upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

export async function listBackups(): Promise<BackupFile[]> {
  const out: BackupFile[] = [];
  try {
    for (const name of await readdir(backupDir())) {
      if (!VALID_NAME.test(name)) continue;
      const s = await stat(path.join(backupDir(), name));
      out.push({ target: "local", name, size: s.size, date: s.mtime.toISOString() });
    }
  } catch {
    /* directory not created yet */
  }
  if (s3Enabled) {
    try {
      const res = await s3().fetch(`${s3Url()}?list-type=2&prefix=${encodeURIComponent(env.S3_PREFIX)}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = m[1]!.match(/<Key>(.*?)<\/Key>/)?.[1] ?? "";
        const name = key.slice(env.S3_PREFIX.length);
        if (!VALID_NAME.test(name)) continue;
        out.push({
          target: "s3",
          name,
          size: Number(m[1]!.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
          date: m[1]!.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? "",
        });
      }
    } catch (e) {
      console.error("[backup] S3 list failed", e);
    }
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

export async function readBackup(target: BackupTarget, name: string) {
  if (!VALID_NAME.test(name)) throw new BackupError("Invalid backup name");
  if (target === "local") return readFile(path.join(backupDir(), name));
  if (!s3Enabled) throw new BackupError("S3 is not configured");
  const res = await s3().fetch(s3Url(s3Key(name)));
  if (!res.ok) throw new BackupError(`Backup not found on S3 (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteBackup(target: BackupTarget, name: string) {
  if (!VALID_NAME.test(name)) throw new BackupError("Invalid backup name");
  if (target === "local") await rm(path.join(backupDir(), name), { force: true });
  else if (s3Enabled) await s3().fetch(s3Url(s3Key(name)), { method: "DELETE" });
}

/** Keeps the newest `keep` backups in each target. */
async function applyRetention(keep: number) {
  const files = await listBackups();
  for (const target of ["local", "s3"] as const) {
    const mine = files.filter((f) => f.target === target);
    for (const old of mine.slice(keep)) await deleteBackup(target, old.name).catch(() => {});
  }
}

/* ---------- Running a backup ---------- */

let running: Promise<unknown> | null = null;

export async function runBackup(kind: "scheduled" | "manual" | "before-restore") {
  if (running) throw new BackupError("A backup is already running");
  const [run] = await db.insert(backupRuns).values({ kind, status: "running" }).returning();
  const task = (async () => {
    try {
      hocuspocus.flushPendingStores();
      const data = await dumpDatabase();
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace(/-\d{3}Z$/, "Z");
      const suffix = kind === "before-restore" ? "-before-restore" : "";
      const name = `calepin-${stamp}${suffix}.json.gz${env.BACKUP_PASSPHRASE ? ".enc" : ""}`;
      const done: string[] = [];
      const errors: string[] = [];
      for (const t of targets().filter((x) => x.configured)) {
        try {
          await writeTarget(t.id, name, data);
          done.push(t.id);
        } catch (e) {
          errors.push(`${t.id}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (!done.length) throw new Error(errors.join("; "));
      const { retention } = await getBackupSettings();
      await applyRetention(retention);
      const [finished] = await db
        .update(backupRuns)
        .set({
          status: "success",
          fileName: name,
          size: data.length,
          targets: done,
          error: errors.join("; ") || null,
          finishedAt: new Date(),
        })
        .where(eq(backupRuns.id, run!.id))
        .returning();
      return finished!;
    } catch (e) {
      const [failed] = await db
        .update(backupRuns)
        .set({ status: "error", error: e instanceof Error ? e.message : String(e), finishedAt: new Date() })
        .where(eq(backupRuns.id, run!.id))
        .returning();
      return failed!;
    }
  })();
  running = task;
  try {
    return await task;
  } finally {
    running = null;
  }
}

export async function recentRuns() {
  return db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(20);
}
