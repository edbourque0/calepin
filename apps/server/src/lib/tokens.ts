import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiTokens, user } from "../db/schema.js";

export type AppUser = { id: string; name: string; email: string; image: string | null };

const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomString(length: number) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a personal access token. The plain token is only returned here. */
export async function createApiToken(userId: string, name: string) {
  const token = `cp_${randomString(40)}`;
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, name, tokenHash: hashToken(token), prefix: token.slice(0, 7) })
    .returning({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt });
  return { ...row!, token };
}

/** Resolves a bearer token to its user, or null. */
export async function userFromToken(token: string): Promise<AppUser | null> {
  if (!token.startsWith("cp_")) return null;
  const [row] = await db
    .select({
      tokenId: apiTokens.id,
      lastUsedAt: apiTokens.lastUsedAt,
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(apiTokens)
    .innerJoin(user, eq(user.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, hashToken(token)));
  if (!row) return null;
  // Record usage at most once a minute.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId));
  }
  return { id: row.id, name: row.name, email: row.email, image: row.image };
}

export function bearer(headers: Headers) {
  const value = headers.get("authorization");
  return value?.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : null;
}
