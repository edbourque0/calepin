import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { type ShareRole, workspaceMembers, workspaces, type WorkspaceRole } from "../db/schema.js";

export type AccessRole = WorkspaceRole; // owner | editor | viewer

export async function createWorkspace(userId: string, name: string) {
  const [ws] = await db.insert(workspaces).values({ name }).returning();
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role: "owner" });
  return ws;
}

export async function createPersonalWorkspace(userId: string, name: string) {
  const firstName = name.trim().split(/\s+/)[0] || "Mon";
  return createWorkspace(userId, `${firstName}'s Calepin`);
}

export async function getMembership(userId: string, workspaceId: string) {
  const [m] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)));
  return m ?? null;
}

export type PageAccess = {
  workspaceId: string;
  role: AccessRole;
  /** True when access comes from workspace membership, false for guests (page shares). */
  isMember: boolean;
  deletedAt: Date | null;
};

/**
 * Effective access of a user to a page: their workspace role if they are a member,
 * otherwise the strongest share on the page or any of its ancestors. Null = no access.
 */
export async function getPageAccess(userId: string, pageId: string): Promise<PageAccess | null> {
  const rows = await db.execute<{
    workspace_id: string;
    deleted_at: Date | null;
    member_role: WorkspaceRole | null;
    share_role: ShareRole | null;
  }>(sql`
    WITH RECURSIVE anc AS (
      SELECT id, parent_id FROM pages WHERE id = ${pageId}
      UNION ALL
      SELECT p.id, p.parent_id FROM pages p JOIN anc a ON p.id = a.parent_id
    )
    SELECT pg.workspace_id, pg.deleted_at, wm.role AS member_role,
      (SELECT s.role FROM page_shares s
        WHERE s.user_id = ${userId} AND s.page_id IN (SELECT id FROM anc)
        ORDER BY (s.role = 'editor') DESC LIMIT 1) AS share_role
    FROM pages pg
    LEFT JOIN workspace_members wm ON wm.workspace_id = pg.workspace_id AND wm.user_id = ${userId}
    WHERE pg.id = ${pageId}
  `);
  const row = rows[0];
  if (!row) return null;
  const role = row.member_role ?? row.share_role;
  if (!role) return null;
  return {
    workspaceId: row.workspace_id,
    role,
    isMember: row.member_role !== null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export function canEdit(role: AccessRole) {
  return role === "owner" || role === "editor";
}
