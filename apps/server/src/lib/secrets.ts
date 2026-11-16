import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "../env.js";

/** Encrypts secrets stored in the database (S3 keys) with a key derived from BETTER_AUTH_SECRET. */
let key: Buffer | null = null;
const secretKey = () => (key ??= scryptSync(env.BETTER_AUTH_SECRET, "calepin-settings", 32));

export function sealSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function openSecret(sealed: string) {
  if (!sealed.startsWith("v1:")) return "";
  const raw = Buffer.from(sealed.slice(3), "base64");
  try {
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    // BETTER_AUTH_SECRET changed: the stored key can't be read anymore and must be entered again.
    return "";
  }
}
