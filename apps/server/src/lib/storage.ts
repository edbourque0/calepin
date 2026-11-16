import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { AwsClient } from "aws4fetch";
import { env } from "../env.js";
import { getSetting, setSetting } from "./settings.js";
import { openSecret, sealSecret } from "./secrets.js";

/* ---------- S3-compatible bucket (AWS, Wasabi, MinIO, R2, B2…) ---------- */

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
};

/** Minimal S3 client (SigV4, path-style URLs: works with Wasabi, MinIO and AWS). */
export class S3Bucket {
  private client: AwsClient;
  constructor(private cfg: S3Config) {
    this.client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: cfg.region || "us-east-1",
      service: "s3",
    });
  }

  get prefix() {
    return this.cfg.prefix;
  }

  url(key = "") {
    return `${this.cfg.endpoint.replace(/\/$/, "")}/${encodeURIComponent(this.cfg.bucket)}/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }

  async put(key: string, body: Uint8Array, contentType = "application/octet-stream") {
    const res = await this.client.fetch(this.url(key), {
      method: "PUT",
      body: body as Uint8Array<ArrayBuffer>,
      headers: { "Content-Type": contentType },
    });
    if (!res.ok) throw new Error(`S3 upload failed (${res.status}): ${await errorText(res)}`);
  }

  /** Passes Range through, for video/audio seeking. */
  async get(key: string, range?: string) {
    const res = await this.client.fetch(this.url(key), { headers: range ? { Range: range } : {} });
    if (!res.ok && res.status !== 206) throw new Error(`S3 download failed (${res.status}): ${await errorText(res)}`);
    return res;
  }

  async delete(key: string) {
    const res = await this.client.fetch(this.url(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed (${res.status})`);
  }

  async list(prefix: string) {
    const res = await this.client.fetch(`${this.url()}?list-type=2&prefix=${encodeURIComponent(prefix)}`);
    if (!res.ok) throw new Error(`S3 list failed (${res.status}): ${await errorText(res)}`);
    const xml = await res.text();
    return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
      key: decodeXml(m[1]!.match(/<Key>(.*?)<\/Key>/)?.[1] ?? ""),
      size: Number(m[1]!.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
      lastModified: m[1]!.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? "",
    }));
  }
}

const decodeXml = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

async function errorText(res: Response) {
  const text = await res.text().catch(() => "");
  return text.match(/<Message>(.*?)<\/Message>/)?.[1] ?? (text.slice(0, 200) || res.statusText);
}

/* ---------- Settings (Settings → Storage) ---------- */

export type StorageSettings = {
  provider: "local" | "s3";
  preset: "wasabi" | "aws" | "other";
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  /** Stored encrypted; never sent back to the browser. */
  secretSealed: string;
  prefix: string;
  /** Also copy backups to this bucket (when S3_* environment variables aren't set). */
  useForBackups: boolean;
};

const DEFAULTS: StorageSettings = {
  provider: "local",
  preset: "wasabi",
  endpoint: "",
  region: "",
  bucket: "",
  accessKeyId: "",
  secretSealed: "",
  prefix: "calepin/",
  useForBackups: true,
};

let cached: { at: number; value: StorageSettings } | null = null;

export async function getStorageSettings() {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const value = await getSetting<StorageSettings>("storage", DEFAULTS);
  cached = { at: Date.now(), value };
  return value;
}

export async function saveStorageSettings(
  input: Partial<Omit<StorageSettings, "secretSealed">> & { secretAccessKey?: string },
) {
  const current = await getStorageSettings();
  const { secretAccessKey, ...rest } = input;
  const next: StorageSettings = {
    ...current,
    ...rest,
    // An empty secret field keeps the stored one.
    secretSealed: secretAccessKey ? sealSecret(secretAccessKey) : current.secretSealed,
  };
  next.prefix = normalizePrefix(next.prefix);
  await setSetting("storage", next);
  cached = null;
  return next;
}

export const normalizePrefix = (p: string) => (p.trim() ? `${p.trim().replace(/^\/+/, "").replace(/\/*$/, "")}/` : "");

export function s3ConfigFrom(s: StorageSettings, secretAccessKey?: string): S3Config | null {
  const secret = secretAccessKey || openSecret(s.secretSealed);
  if (!s.endpoint || !s.bucket || !s.accessKeyId || !secret) return null;
  return {
    endpoint: s.endpoint,
    region: s.region,
    bucket: s.bucket,
    accessKeyId: s.accessKeyId,
    secretAccessKey: secret,
    prefix: s.prefix,
  };
}

/** The bucket configured in the UI, if any. */
export async function uiBucket() {
  const s = await getStorageSettings();
  const cfg = s3ConfigFrom(s);
  return cfg ? new S3Bucket(cfg) : null;
}

/** Writes, reads back and deletes a small object: proves the credentials and the bucket work. */
export async function testBucket(cfg: S3Config) {
  const bucket = new S3Bucket(cfg);
  const key = `${cfg.prefix}.calepin-test-${Date.now()}`;
  await bucket.put(key, new TextEncoder().encode("ok"), "text/plain");
  const res = await bucket.get(key);
  const body = await res.text();
  await bucket.delete(key);
  if (body !== "ok") throw new Error("The test file came back different");
}

/* ---------- Files ---------- */

const filesDir = () => path.resolve(env.FILES_DIR);
const localPath = (key: string) => {
  const p = path.resolve(filesDir(), key);
  if (!p.startsWith(filesDir() + path.sep)) throw new Error("Invalid file key");
  return p;
};

/** Stores bytes with the current provider and returns where they went. */
export async function storeFile(
  key: string,
  data: Uint8Array,
  mime: string,
): Promise<{ storage: "local" | "s3"; key: string }> {
  const s = await getStorageSettings();
  if (s.provider === "s3") {
    const bucket = await uiBucket();
    if (!bucket) throw new Error("S3 storage is selected but not fully configured");
    const fullKey = `${bucket.prefix}files/${key}`;
    await bucket.put(fullKey, data, mime);
    return { storage: "s3", key: fullKey };
  }
  const p = localPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
  return { storage: "local", key };
}

export type FileBody = { body: ReadableStream | Readable; status: 200 | 206; headers: Record<string, string> };

/** Opens a stored file, honouring a Range header (video/audio seeking). */
export async function openFile(storage: "local" | "s3", key: string, size: number, range?: string): Promise<FileBody> {
  if (storage === "s3") {
    const bucket = await uiBucket();
    if (!bucket) throw new Error("S3 storage is not configured anymore");
    const res = await bucket.get(key, range);
    const headers: Record<string, string> = {};
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
    return { body: res.body!, status: res.status === 206 ? 206 : 200, headers };
  }
  const p = localPath(key);
  const real = (await stat(p)).size;
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, real - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), real - 1) : real - 1;
    return {
      body: createReadStream(p, { start, end }),
      status: 206,
      headers: {
        "content-range": `bytes ${start}-${end}/${real}`,
        "content-length": String(end - start + 1),
        "accept-ranges": "bytes",
      },
    };
  }
  return {
    body: createReadStream(p),
    status: 200,
    headers: { "content-length": String(real || size), "accept-ranges": "bytes" },
  };
}

export async function removeFile(storage: "local" | "s3", key: string) {
  if (storage === "s3") await (await uiBucket())?.delete(key);
  else await rm(localPath(key), { force: true });
}
