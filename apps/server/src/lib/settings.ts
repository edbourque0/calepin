import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";

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
