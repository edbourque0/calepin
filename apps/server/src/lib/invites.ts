import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { invites, pageShares, type ShareRole, workspaceMembers, type WorkspaceRole } from "../db/schema.js";
import { env } from "../env.js";
import { emitWorkspace } from "./events.js";
import { randomString } from "./tokens.js";

const INVITE_DAYS = 14;

export async function createInvite(input: {
  workspaceId: string;
  pageId?: string | null;
  email?: string | null;
  role: WorkspaceRole | ShareRole;
  createdBy: string;
}) {
  const token = randomString(32);
  const [row] = await db
    .insert(invites)
    .values({
      token,
      workspaceId: input.workspaceId,
      pageId: input.pageId ?? null,
      email: input.email?.toLowerCase() ?? null,
      role: input.role,
      createdBy: input.createdBy,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    })
    .returning();
  return { ...row!, url: inviteUrl(token) };
}

export const inviteUrl = (token: string) => `${env.PUBLIC_URL.replace(/\/$/, "")}/invite/${token}`;

export async function findValidInvite(token: string) {
  const [row] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.token, token), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())));
  return row ?? null;
}

/** Grants what the invitation offers to `userId` and marks it used. */
export async function acceptInvite(token: string, userId: string) {
  const invite = await findValidInvite(token);
  if (!invite) return null;
  if (invite.pageId) {
    await db
      .insert(pageShares)
      .values({ pageId: invite.pageId, userId, role: invite.role as ShareRole, createdBy: invite.createdBy })
      .onConflictDoUpdate({ target: [pageShares.pageId, pageShares.userId], set: { role: invite.role as ShareRole } });
  } else {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId, role: invite.role as WorkspaceRole })
      .onConflictDoNothing();
  }
  await db.update(invites).set({ acceptedAt: new Date(), acceptedBy: userId }).where(eq(invites.id, invite.id));
  emitWorkspace(invite.workspaceId);
  return invite;
}
