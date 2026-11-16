import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { pages, workspaceMembers, workspaces, type WorkspaceRole } from "../db/schema.js";

export async function createPersonalWorkspace(userId: string, name: string) {
  const firstName = name.trim().split(/\s+/)[0] || "Mon";
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `${firstName}'s Calepin` })
    .returning();
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role: "owner" });
  return ws;
}

export async function getMembership(userId: string, workspaceId: string) {
  const [m] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)));
  return m ?? null;
}

/** Returns the page's workspace and the user's role in it, or null if the user has no access. */
export async function getPageAccess(userId: string, pageId: string) {
  const [row] = await db
    .select({ workspaceId: pages.workspaceId, role: workspaceMembers.role, deletedAt: pages.deletedAt })
    .from(pages)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, pages.workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .where(eq(pages.id, pageId));
  return row ?? null;
}

export function canEdit(role: WorkspaceRole) {
  return role === "owner" || role === "editor";
}
