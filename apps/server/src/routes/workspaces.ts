import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import { workspaceMembers, workspaces } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { getMembership } from "../lib/workspaces.js";

export const workspaceRoutes = new Hono<AppEnv>()
  .get("/me", async (c) => {
    const user = c.var.user;
    const rows = await db
      .select({ id: workspaces.id, name: workspaces.name, icon: workspaces.icon, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, user.id))
      .orderBy(asc(workspaces.createdAt));
    return c.json({
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
      workspaces: rows,
    });
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
  });
