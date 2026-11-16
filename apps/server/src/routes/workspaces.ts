import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { db } from "../db/index.js";
import { invites, user, workspaceMembers, workspaces } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { emitWorkspace, onWorkspace } from "../lib/events.js";
import { createInvite, inviteUrl } from "../lib/invites.js";
import { createWorkspace, getMembership } from "../lib/workspaces.js";

const role = z.enum(["owner", "editor", "viewer"]);

export const workspaceRoutes = new Hono<AppEnv>()
  .get("/me", async (c) => {
    const me = c.var.user;
    const rows = await db
      .select({ id: workspaces.id, name: workspaces.name, icon: workspaces.icon, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, me.id))
      .orderBy(asc(workspaces.createdAt));
    return c.json({ user: me, workspaces: rows });
  })

  .post("/workspaces", async (c) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(await c.req.json());
    const ws = await createWorkspace(c.var.user.id, name);
    return c.json({ ...ws, role: "owner" }, 201);
  })

  .patch("/workspaces/:wid", async (c) => {
    const wid = c.req.param("wid");
    const member = await getMembership(c.var.user.id, wid);
    if (!member) return c.json({ error: "Not found" }, 404);
    if (member.role !== "owner") return c.json({ error: "Forbidden" }, 403);
    const body = z
      .object({ name: z.string().trim().min(1).max(100).optional(), icon: z.string().max(64).nullable().optional() })
      .parse(await c.req.json());
    const [ws] = await db.update(workspaces).set(body).where(eq(workspaces.id, wid)).returning();
    return c.json(ws);
  })

  /* ----- Members ----- */
  .get("/workspaces/:wid/members", async (c) => {
    const wid = c.req.param("wid");
    const member = await getMembership(c.var.user.id, wid);
    if (!member) return c.json({ error: "Not found" }, 404);
    const members = await db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, wid))
      .orderBy(asc(workspaceMembers.createdAt));
    const pending =
      member.role === "owner"
        ? await db
            .select({
              id: invites.id,
              email: invites.email,
              role: invites.role,
              token: invites.token,
              expiresAt: invites.expiresAt,
            })
            .from(invites)
            .where(
              and(
                eq(invites.workspaceId, wid),
                isNull(invites.pageId),
                isNull(invites.acceptedAt),
                gt(invites.expiresAt, new Date()),
              ),
            )
        : [];
    return c.json({
      myRole: member.role,
      members,
      invites: pending.map(({ token, ...i }) => ({ ...i, url: inviteUrl(token) })),
    });
  })

  /** Invite by email (existing accounts are added right away) or create a reusable-once link. */
  .post("/workspaces/:wid/invites", async (c) => {
    const wid = c.req.param("wid");
    const member = await getMembership(c.var.user.id, wid);
    if (member?.role !== "owner") return c.json({ error: "Forbidden" }, 403);
    const body = z
      .object({ email: z.string().trim().email().optional(), role: role.default("editor") })
      .parse(await c.req.json());
    if (body.email) {
      const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, body.email.toLowerCase()));
      if (existing) {
        await db
          .insert(workspaceMembers)
          .values({ workspaceId: wid, userId: existing.id, role: body.role })
          .onConflictDoUpdate({
            target: [workspaceMembers.workspaceId, workspaceMembers.userId],
            set: { role: body.role },
          });
        emitWorkspace(wid);
        return c.json({ status: "added" as const });
      }
    }
    const invite = await createInvite({
      workspaceId: wid,
      email: body.email ?? null,
      role: body.role,
      createdBy: c.var.user.id,
    });
    return c.json({ status: "invited" as const, url: invite.url });
  })

  .patch("/workspaces/:wid/members/:userId", async (c) => {
    const wid = c.req.param("wid");
    const member = await getMembership(c.var.user.id, wid);
    if (member?.role !== "owner") return c.json({ error: "Forbidden" }, 403);
    const { role: next } = z.object({ role }).parse(await c.req.json());
    const target = c.req.param("userId");
    if (next !== "owner" && (await ownerCount(wid)) <= 1 && (await getMembership(target, wid))?.role === "owner")
      return c.json({ error: "A workspace needs at least one owner" }, 400);
    await db
      .update(workspaceMembers)
      .set({ role: next })
      .where(and(eq(workspaceMembers.workspaceId, wid), eq(workspaceMembers.userId, target)));
    return c.json({ ok: true });
  })

  /** Owners remove members; anyone can leave. */
  .delete("/workspaces/:wid/members/:userId", async (c) => {
    const wid = c.req.param("wid");
    const target = c.req.param("userId");
    const member = await getMembership(c.var.user.id, wid);
    if (!member || (member.role !== "owner" && target !== c.var.user.id)) return c.json({ error: "Forbidden" }, 403);
    const targetRole = (await getMembership(target, wid))?.role;
    if (targetRole === "owner" && (await ownerCount(wid)) <= 1)
      return c.json({ error: "A workspace needs at least one owner" }, 400);
    await db
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, wid), eq(workspaceMembers.userId, target)));
    emitWorkspace(wid);
    return c.json({ ok: true });
  })

  /* ----- Live events: tells open clients to refresh the page tree ----- */
  .get("/workspaces/:wid/events", async (c) => {
    const wid = c.req.param("wid");
    if (!(await getMembership(c.var.user.id, wid))) return c.json({ error: "Not found" }, 404);
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let pending = false;
      const off = onWorkspace(wid, () => {
        // Coalesce bursts (e.g. many moves) into one message.
        if (pending) return;
        pending = true;
        setTimeout(() => {
          pending = false;
          stream.writeSSE({ event: "pages", data: "{}" }).catch(() => {});
        }, 150);
      });
      stream.onAbort(() => {
        off();
      });
      while (!stream.aborted) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(25_000);
      }
      off();
    });
  });

async function ownerCount(wid: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, wid), eq(workspaceMembers.role, "owner")));
  return row?.n ?? 0;
}
