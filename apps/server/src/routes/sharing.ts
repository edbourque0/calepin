import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import { invites, pages, pageShares, user, workspaceMembers, workspaces } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { emitWorkspace } from "../lib/events.js";
import { createInvite, inviteUrl } from "../lib/invites.js";
import { randomString } from "../lib/tokens.js";
import { canEdit, getPageAccess } from "../lib/workspaces.js";

const shareRole = z.enum(["editor", "viewer"]);

/** Page sharing: guests, pending invitations and publishing to the web. Requires edit access. */
export const sharingRoutes = new Hono<AppEnv>()
  .get("/pages/:id/sharing", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);

    const [ws] = await db
      .select({ name: workspaces.name, members: sql<number>`count(${workspaceMembers.userId})::int` })
      .from(workspaces)
      .leftJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaces.id, access.workspaceId))
      .groupBy(workspaces.id);

    // Guests on this page or inherited from an ancestor.
    const guests = await db.execute<{
      userId: string;
      name: string;
      email: string;
      role: "editor" | "viewer";
      pageId: string;
      pageTitle: string;
    }>(sql`
      WITH RECURSIVE anc AS (
        SELECT id, parent_id, 0 AS depth FROM pages WHERE id = ${id}
        UNION ALL
        SELECT p.id, p.parent_id, a.depth + 1 FROM pages p JOIN anc a ON p.id = a.parent_id
      )
      SELECT DISTINCT ON (u.id) u.id AS "userId", u.name, u.email, s.role, s.page_id AS "pageId", p.title AS "pageTitle"
      FROM page_shares s
      JOIN anc ON anc.id = s.page_id
      JOIN "user" u ON u.id = s.user_id
      JOIN pages p ON p.id = s.page_id
      ORDER BY u.id, anc.depth ASC
    `);

    const pending = await db
      .select({
        id: invites.id,
        email: invites.email,
        role: invites.role,
        token: invites.token,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .where(and(eq(invites.pageId, id), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
      .orderBy(asc(invites.createdAt));

    const [page] = await db
      .select({ publicSlug: pages.publicSlug, publishedAt: pages.publishedAt })
      .from(pages)
      .where(eq(pages.id, id));

    return c.json({
      canManage: canEdit(access.role) && access.isMember,
      workspace: { name: ws?.name ?? "", members: ws?.members ?? 0 },
      guests,
      invites: pending.map((i) => ({ ...i, url: inviteUrl(i.token), token: undefined })),
      published: page?.publicSlug ? { slug: page.publicSlug, publishedAt: page.publishedAt } : null,
    });
  })

  /** Share with someone by email: existing accounts get access now, others get an invitation link. */
  .post("/pages/:id/shares", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role) || !access.isMember) return c.json({ error: "Forbidden" }, 403);
    const body = z
      .object({ email: z.string().trim().email().optional(), role: shareRole.default("viewer") })
      .parse(await c.req.json());

    if (body.email) {
      const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, body.email.toLowerCase()));
      if (existing) {
        const member = await db
          .select()
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, access.workspaceId), eq(workspaceMembers.userId, existing.id)));
        if (member.length) return c.json({ status: "member" as const });
        await db
          .insert(pageShares)
          .values({ pageId: id, userId: existing.id, role: body.role, createdBy: c.var.user.id })
          .onConflictDoUpdate({ target: [pageShares.pageId, pageShares.userId], set: { role: body.role } });
        return c.json({ status: "shared" as const });
      }
    }
    const invite = await createInvite({
      workspaceId: access.workspaceId,
      pageId: id,
      email: body.email ?? null,
      role: body.role,
      createdBy: c.var.user.id,
    });
    return c.json({ status: "invited" as const, url: invite.url });
  })

  .patch("/pages/:id/shares/:userId", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || !canEdit(access.role) || !access.isMember) return c.json({ error: "Forbidden" }, 403);
    const { role } = z.object({ role: shareRole }).parse(await c.req.json());
    await db
      .update(pageShares)
      .set({ role })
      .where(and(eq(pageShares.pageId, id), eq(pageShares.userId, c.req.param("userId"))));
    return c.json({ ok: true });
  })

  .delete("/pages/:id/shares/:userId", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || !canEdit(access.role) || !access.isMember) return c.json({ error: "Forbidden" }, 403);
    await db.delete(pageShares).where(and(eq(pageShares.pageId, id), eq(pageShares.userId, c.req.param("userId"))));
    return c.json({ ok: true });
  })

  .delete("/invites/:inviteId", async (c) => {
    const [invite] = await db
      .select()
      .from(invites)
      .where(eq(invites.id, c.req.param("inviteId")));
    if (!invite) return c.json({ error: "Not found" }, 404);
    const allowed = invite.pageId
      ? await getPageAccess(c.var.user.id, invite.pageId).then((a) => a && canEdit(a.role) && a.isMember)
      : await db
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, c.var.user.id)))
          .then((r) => r[0]?.role === "owner");
    if (!allowed) return c.json({ error: "Forbidden" }, 403);
    await db.delete(invites).where(eq(invites.id, invite.id));
    return c.json({ ok: true });
  })

  /* ----- Publish to the web ----- */
  .post("/pages/:id/publish", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role) || !access.isMember) return c.json({ error: "Forbidden" }, 403);
    const [current] = await db.select({ slug: pages.publicSlug }).from(pages).where(eq(pages.id, id));
    const slug = current?.slug ?? randomString(12);
    await db.update(pages).set({ publicSlug: slug, publishedAt: new Date() }).where(eq(pages.id, id));
    emitWorkspace(access.workspaceId);
    return c.json({ slug });
  })

  .delete("/pages/:id/publish", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || !canEdit(access.role) || !access.isMember) return c.json({ error: "Forbidden" }, 403);
    await db.update(pages).set({ publicSlug: null, publishedAt: null }).where(eq(pages.id, id));
    emitWorkspace(access.workspaceId);
    return c.json({ ok: true });
  });
