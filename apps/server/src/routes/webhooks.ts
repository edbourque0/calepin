import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import { type WebhookEvent, webhooks } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { sealSecret } from "../lib/secrets.js";
import { randomString } from "../lib/tokens.js";
import { deliver, resetWebhookCache, WEBHOOK_EVENTS } from "../lib/webhooks.js";
import { getMembership, getPageAccess } from "../lib/workspaces.js";

const publicFields = {
  id: webhooks.id,
  workspaceId: webhooks.workspaceId,
  name: webhooks.name,
  url: webhooks.url,
  events: webhooks.events,
  scopePageId: webhooks.scopePageId,
  enabled: webhooks.enabled,
  createdAt: webhooks.createdAt,
  lastStatus: webhooks.lastStatus,
  lastError: webhooks.lastError,
  lastDeliveryAt: webhooks.lastDeliveryAt,
};

const body = z.object({
  name: z.string().trim().max(100).optional(),
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), "Use an http(s) URL"),
  events: z.array(z.enum(WEBHOOK_EVENTS as [WebhookEvent, ...WebhookEvent[]])).default([]),
  scopePageId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
});

async function requireOwner(userId: string, workspaceId: string) {
  const m = await getMembership(userId, workspaceId);
  return m?.role === "owner";
}

/** Workspace webhooks. Owners only. */
export const webhookRoutes = new Hono<AppEnv>()
  .get("/workspaces/:wid/webhooks", async (c) => {
    const wid = c.req.param("wid");
    if (!(await requireOwner(c.var.user.id, wid))) return c.json({ error: "Owners only" }, 403);
    return c.json(
      await db
        .select(publicFields)
        .from(webhooks)
        .where(eq(webhooks.workspaceId, wid))
        .orderBy(desc(webhooks.createdAt)),
    );
  })
  .post("/workspaces/:wid/webhooks", async (c) => {
    const wid = c.req.param("wid");
    if (!(await requireOwner(c.var.user.id, wid))) return c.json({ error: "Owners only" }, 403);
    const input = body.parse(await c.req.json());
    if (input.scopePageId) {
      const acc = await getPageAccess(c.var.user.id, input.scopePageId);
      if (!acc || acc.workspaceId !== wid) return c.json({ error: "Invalid page" }, 400);
    }
    const secret = `whsec_${randomString(32)}`;
    const [hook] = await db
      .insert(webhooks)
      .values({
        workspaceId: wid,
        name: input.name ?? "",
        url: input.url,
        events: input.events,
        scopePageId: input.scopePageId ?? null,
        enabled: input.enabled ?? true,
        secret: sealSecret(secret),
        createdBy: c.var.user.id,
      })
      .returning(publicFields);
    resetWebhookCache();
    // The signing secret is shown once.
    return c.json({ ...hook, secret }, 201);
  })
  .patch("/webhooks/:id", async (c) => {
    const [hook] = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, c.req.param("id")));
    if (!hook || !(await requireOwner(c.var.user.id, hook.workspaceId))) return c.json({ error: "Not found" }, 404);
    const input = body.partial().parse(await c.req.json());
    const [updated] = await db
      .update(webhooks)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.events ? { events: input.events } : {}),
        ...(input.scopePageId !== undefined ? { scopePageId: input.scopePageId } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      })
      .where(eq(webhooks.id, hook.id))
      .returning(publicFields);
    resetWebhookCache();
    return c.json(updated);
  })
  .delete("/webhooks/:id", async (c) => {
    const [hook] = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, c.req.param("id")));
    if (!hook || !(await requireOwner(c.var.user.id, hook.workspaceId))) return c.json({ error: "Not found" }, 404);
    await db.delete(webhooks).where(and(eq(webhooks.id, hook.id)));
    resetWebhookCache();
    return c.json({ ok: true });
  })
  /** Sends a "ping" event once, without retries, and reports the result. */
  .post("/webhooks/:id/test", async (c) => {
    const [hook] = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, c.req.param("id")));
    if (!hook || !(await requireOwner(c.var.user.id, hook.workspaceId))) return c.json({ error: "Not found" }, 404);
    const result = await deliver(hook, "ping", hook.workspaceId, { message: "Calepin webhook test" }, false);
    return c.json(result);
  });
