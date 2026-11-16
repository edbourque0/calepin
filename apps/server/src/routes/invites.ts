import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { pages, user, workspaces } from "../db/schema.js";
import { type AppEnv, requireUser } from "../http.js";
import { acceptInvite, findValidInvite } from "../lib/invites.js";

/** Invitation links: public preview, then accept once signed in. */
export const inviteRoutes = new Hono<AppEnv>()
  .get("/invites/:token", async (c) => {
    const invite = await findValidInvite(c.req.param("token"));
    if (!invite) return c.json({ valid: false }, 404);
    const [ws] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, invite.workspaceId));
    const [inviter] = invite.createdBy
      ? await db.select({ name: user.name }).from(user).where(eq(user.id, invite.createdBy))
      : [];
    const [page] = invite.pageId
      ? await db.select({ title: pages.title, icon: pages.icon }).from(pages).where(eq(pages.id, invite.pageId))
      : [];
    return c.json({
      valid: true,
      kind: invite.pageId ? "page" : "workspace",
      role: invite.role,
      workspace: ws?.name ?? "",
      page: page ?? null,
      inviter: inviter?.name ?? null,
      email: invite.email,
    });
  })

  .post("/invites/:token/accept", requireUser, async (c) => {
    const invite = await acceptInvite(c.req.param("token"), c.var.user.id);
    if (!invite) return c.json({ error: "This invitation is no longer valid" }, 404);
    return c.json({ workspaceId: invite.workspaceId, pageId: invite.pageId });
  });
