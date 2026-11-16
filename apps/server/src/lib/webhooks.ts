import { createHmac, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { pages, type WebhookEvent, webhooks } from "../db/schema.js";
import { env } from "../env.js";
import { formatValue, getDatabase, getRows, peopleNames, personIds } from "./database.js";
import { openSecret } from "./secrets.js";

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  "page.created",
  "page.updated",
  "page.deleted",
  "row.created",
  "row.updated",
  "row.deleted",
];

type Kind = "created" | "updated" | "deleted";
const pageUrl = (id: string) => `${env.PUBLIC_URL.replace(/\/$/, "")}/p/${id}`;

/* ---------- Queue: coalesces bursts (typing, a row created then filled in) ---------- */

const DEBOUNCE_MS = 4000;
const pending = new Map<string, { kind: Kind; timer: NodeJS.Timeout }>();

function queue(pageId: string, kind: Kind, delay = DEBOUNCE_MS) {
  const prev = pending.get(pageId);
  if (prev) clearTimeout(prev.timer);
  // A page created then edited within the window is still "created".
  const effective: Kind = prev?.kind === "created" && kind === "updated" ? "created" : kind;
  const timer = setTimeout(() => {
    pending.delete(pageId);
    fire(pageId, effective).catch((e) => console.error("[webhooks]", e));
  }, delay);
  timer.unref();
  pending.set(pageId, { kind: effective, timer });
}

/** A page, database or row was created. */
export const notifyCreated = (pageId: string) => queue(pageId, "created");
/** Content, title or values changed (debounced). */
export const notifyUpdated = (pageId: string) => queue(pageId, "updated");
/** Moved to the trash: sent right away for the page and each subpage. */
export function notifyDeleted(pageIds: string[]) {
  for (const id of pageIds) {
    const prev = pending.get(id);
    if (prev) clearTimeout(prev.timer);
    pending.delete(id);
    // A page created and deleted within the window never existed for the receiver.
    if (prev?.kind === "created") continue;
    fire(id, "deleted").catch((e) => console.error("[webhooks]", e));
  }
}

/* ---------- Payloads ---------- */

async function payloadFor(pageId: string) {
  const [page] = await db
    .select({
      id: pages.id,
      workspaceId: pages.workspaceId,
      parentId: pages.parentId,
      type: pages.type,
      title: pages.title,
      icon: pages.icon,
      contentText: pages.contentText,
      createdAt: pages.createdAt,
      updatedAt: pages.updatedAt,
      createdBy: pages.createdBy,
      updatedBy: pages.updatedBy,
      deletedAt: pages.deletedAt,
    })
    .from(pages)
    .where(eq(pages.id, pageId));
  if (!page) return null;
  const base = {
    id: page.id,
    type: page.type,
    title: page.title,
    icon: page.icon,
    url: pageUrl(page.id),
    parentId: page.parentId,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    createdBy: page.createdBy,
    updatedBy: page.updatedBy,
  };
  if (page.type === "row" && page.parentId && !page.deletedAt) {
    const database = await getDatabase(page.parentId);
    if (database) {
      const [row] = await getRows(database.page.id, database.properties, [page.id]);
      if (row) {
        const people = await peopleNames(personIds(database.properties, [row]));
        const values: Record<string, string> = {};
        for (const p of database.properties) values[p.name] = formatValue(p, row.props[p.id], people);
        return {
          page,
          data: {
            ...base,
            databaseId: database.page.id,
            database: database.page.title,
            values,
            properties: Object.fromEntries(database.properties.map((p) => [p.id, row.props[p.id] ?? null])),
          },
        };
      }
    }
  }
  return {
    page,
    data: { ...base, excerpt: page.contentText.slice(0, 500) },
  };
}

/** Ids of the page and its ancestors (for webhooks scoped to a page or database). */
async function lineage(pageId: string) {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id FROM pages WHERE id = ${pageId}
      UNION ALL SELECT p.id, p.parent_id FROM pages p JOIN up ON p.id = up.parent_id
    ) SELECT id FROM up`);
  return new Set([...rows].map((r) => r.id));
}

/* ---------- Delivery ---------- */

export function sign(secret: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Skips all work on instances without webhooks. Reset when hooks change. */
let anyHooks: { value: boolean; at: number } | null = null;
export const resetWebhookCache = () => (anyHooks = null);
async function hasHooks() {
  if (!anyHooks || Date.now() - anyHooks.at > 60_000) {
    const [row] = await db.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.enabled, true)).limit(1);
    anyHooks = { value: !!row, at: Date.now() };
  }
  return anyHooks.value;
}

async function fire(pageId: string, kind: Kind) {
  if (!(await hasHooks())) return;
  const found = await payloadFor(pageId);
  if (!found) return;
  const { page, data } = found;
  const event = `${page.type === "row" ? "row" : "page"}.${kind}` as WebhookEvent;
  const hooks = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.workspaceId, page.workspaceId), eq(webhooks.enabled, true)));
  const matching = hooks.filter((h) => h.events.length === 0 || h.events.includes(event));
  if (!matching.length) return;
  const ancestors = matching.some((h) => h.scopePageId) ? await lineage(pageId) : null;
  for (const hook of matching) {
    if (hook.scopePageId && !ancestors?.has(hook.scopePageId)) continue;
    void deliver(hook, event, page.workspaceId, data);
  }
}

type Hook = typeof webhooks.$inferSelect;

/** POSTs a signed event, retrying three times (1 s, 10 s, 60 s) on network errors and 5xx/429. */
export async function deliver(hook: Hook, event: string, workspaceId: string, data: unknown, retry = true) {
  const body = JSON.stringify({
    id: randomUUID(),
    event,
    workspaceId,
    createdAt: new Date().toISOString(),
    data,
  });
  const secret = openSecret(hook.secret);
  const delays = retry ? [1000, 10_000, 60_000] : [];
  let status: number | null = null;
  let error: string | null = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Calepin-Webhooks/1",
          "X-Calepin-Event": event,
          "X-Calepin-Delivery": JSON.parse(body).id,
          "X-Calepin-Signature": sign(secret, body),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      error = res.ok ? null : `HTTP ${res.status}`;
      await res.body?.cancel();
      if (res.ok || (res.status < 500 && res.status !== 429)) break;
    } catch (e) {
      status = null;
      error = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
    }
    if (attempt < delays.length) await new Promise((r) => setTimeout(r, delays[attempt]));
  }
  await db
    .update(webhooks)
    .set({ lastStatus: status, lastError: error, lastDeliveryAt: new Date() })
    .where(eq(webhooks.id, hook.id));
  return { status, error };
}
