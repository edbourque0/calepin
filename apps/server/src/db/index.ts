import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env.js";
import * as schema from "./schema.js";

export const client = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
export const db = drizzle(client, { schema });
export type DB = typeof db;

export async function runMigrations() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/db -> ../../drizzle in dev, dist -> ../drizzle in production
  const candidates = [path.resolve(here, "../../drizzle"), path.resolve(here, "../drizzle")];
  const { existsSync } = await import("node:fs");
  const migrationsFolder = candidates.find((p) => existsSync(path.join(p, "meta")));
  if (!migrationsFolder) throw new Error("Migrations folder not found");
  await migrate(db, { migrationsFolder });
}
