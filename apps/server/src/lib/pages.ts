import { and, eq, inArray, isNull } from "drizzle-orm";
import * as Y from "yjs";
import { hocuspocus } from "../collab.js";
import { db } from "../db/index.js";
import { pages } from "../db/schema.js";
import { copyBlocks, docToMarkdown, writeMarkdown } from "./blocks.js";
import { emitWorkspace } from "./events.js";
import { positionAt, subtreeIds } from "./tree.js";
import { snapshot, noteAuthor, versionDoc } from "./versions.js";
import { notifyCreated, notifyDeleted } from "./webhooks.js";
import { getTitle, TITLE_TEXT } from "./ydoc.js";
import { iconPrefix } from "./icons.js";

export const pageSummary = {
  id: pages.id,
  workspaceId: pages.workspaceId,
  parentId: pages.parentId,
  position: pages.position,
  type: pages.type,
  title: pages.title,
  icon: pages.icon,
  publicSlug: pages.publicSlug,
  updatedAt: pages.updatedAt,
  createdAt: pages.createdAt,
};

export async function createPage(input: {
  workspaceId: string;
  parentId: string | null;
  title?: string;
  icon?: string | null;
  userId: string;
}) {
  const [page] = await db
    .insert(pages)
    .values({
      workspaceId: input.workspaceId,
      parentId: input.parentId,
      position: await positionAt(input.workspaceId, input.parentId),
      title: input.title?.trim() ?? "",
      icon: input.icon ?? null,
      createdBy: input.userId,
      updatedBy: input.userId,
    })
    .returning(pageSummary);
  emitWorkspace(input.workspaceId);
  notifyCreated(page!.id);
  return page!;
}

/** Soft-deletes a page and its subpages; returns the ids moved to the trash. */
export async function trashPage(pageId: string, workspaceId: string) {
  const ids = await subtreeIds(pageId);
  await db
    .update(pages)
    .set({ deletedAt: new Date() })
    .where(and(inArray(pages.id, ids), isNull(pages.deletedAt)));
  for (const id of ids) hocuspocus.closeConnections(id);
  emitWorkspace(workspaceId);
  notifyDeleted(ids);
  return ids;
}

export async function movePage(
  pageId: string,
  workspaceId: string,
  parentId: string | null,
  index: number | undefined,
  userId: string,
) {
  const [page] = await db
    .update(pages)
    .set({
      parentId,
      position: await positionAt(workspaceId, parentId, index, pageId),
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(eq(pages.id, pageId))
    .returning(pageSummary);
  emitWorkspace(workspaceId);
  return page!;
}

/**
 * Runs a change on a page's live Yjs document through Hocuspocus, so people who have the
 * page open see it immediately and it is persisted like any other edit.
 */
export async function editDocument(
  pageId: string,
  userId: string,
  change: (doc: Y.Doc) => void | Promise<void>,
  opts: { agent?: boolean } = {},
) {
  const connection = await hocuspocus.openDirectConnection(pageId, { userId, role: "editor" });
  try {
    const doc = connection.document;
    if (!doc) throw new Error("Document unavailable");
    // Agents can rewrite a lot at once: keep what was there before they touch it.
    if (opts.agent) await snapshot(pageId, doc, { force: true, kind: "before-agent" });
    noteAuthor(pageId, userId);
    await change(doc);
    // transact() triggers the store hook and broadcasts the update.
    await connection.transact(() => {});
  } finally {
    await connection.disconnect();
  }
}

export async function readDocument<T>(pageId: string, read: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
  const connection = await hocuspocus.openDirectConnection(pageId, { userId: "system", role: "viewer" });
  try {
    return await read(connection.document!);
  } finally {
    await connection.disconnect();
  }
}

export function setTitle(doc: Y.Doc, title: string) {
  const text = doc.getText(TITLE_TEXT);
  doc.transact(() => {
    text.delete(0, text.length);
    text.insert(0, title.trim());
  });
}

export async function getPageMarkdown(pageId: string) {
  return nameDatabaseLinks(await readDocument(pageId, (doc) => docToMarkdown(doc)));
}

/** Gives embedded databases ("[Database](/p/id)" in Markdown) their real title. */
export async function nameDatabaseLinks(markdown: string) {
  const ids = [...markdown.matchAll(/\[Database\]\(\/p\/([0-9a-f-]{36})\)/g)].map((m) => m[1]!);
  if (!ids.length) return markdown;
  const rows = await db
    .select({ id: pages.id, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(inArray(pages.id, ids));
  const names = new Map(rows.map((r) => [r.id, `${iconPrefix(r.icon)}${r.title || "Untitled"}`]));
  return markdown.replace(/\[Database\]\(\/p\/([0-9a-f-]{36})\)/g, (all, id: string) =>
    names.has(id) ? `[${names.get(id)} (database)](/p/${id})` : all,
  );
}

export async function writePageMarkdown(
  pageId: string,
  userId: string,
  markdown: string,
  mode: "append" | "replace",
  opts: { agent?: boolean } = {},
) {
  await editDocument(pageId, userId, (doc) => writeMarkdown(doc, markdown, mode), opts);
}

/** Brings back an earlier version as a new change on top of the current document. */
export async function restoreVersion(pageId: string, versionId: string, userId: string) {
  const found = await versionDoc(pageId, versionId);
  if (!found) return null;
  await editDocument(pageId, userId, async (doc) => {
    await snapshot(pageId, doc, { force: true, kind: "before-restore" });
    copyBlocks(found.doc, doc);
    setTitle(doc, getTitle(found.doc));
  });
  if (found.version.props)
    await db.update(pages).set({ props: found.version.props, updatedAt: new Date() }).where(eq(pages.id, pageId));
  return found.version;
}
