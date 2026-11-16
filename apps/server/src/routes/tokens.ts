import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import { apiTokens } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { createApiToken } from "../lib/tokens.js";

/** Personal access tokens for the REST API and the MCP server. Managed from a browser session only. */
export const tokenRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    if (c.var.viaToken) return c.json({ error: "Manage tokens from the app" }, 403);
    await next();
  })
  .get("/tokens", async (c) => {
    const rows = await db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        prefix: apiTokens.prefix,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, c.var.user.id))
      .orderBy(desc(apiTokens.createdAt));
    return c.json(rows);
  })
  .post("/tokens", async (c) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(await c.req.json());
    return c.json(await createApiToken(c.var.user.id, name), 201);
  })
  .delete("/tokens/:id", async (c) => {
    await db.delete(apiTokens).where(and(eq(apiTokens.id, c.req.param("id")), eq(apiTokens.userId, c.var.user.id)));
    return c.json({ ok: true });
  });
