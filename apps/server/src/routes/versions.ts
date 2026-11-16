import { desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { pages, pageVersions, user } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { docToHTML, docToMarkdown } from "../lib/blocks.js";
import { emitDatabase, emitWorkspace } from "../lib/events.js";
import { getPageMarkdown, readDocument, restoreVersion } from "../lib/pages.js";
import { snapshot, versionDoc } from "../lib/versions.js";
import { canEdit, getPageAccess } from "../lib/workspaces.js";

export const versionRoutes = new Hono<AppEnv>()
  .get("/pages/:id/versions", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    const rows = await db
      .select({
        id: pageVersions.id,
        title: pageVersions.title,
        kind: pageVersions.kind,
        authors: pageVersions.authors,
        createdAt: pageVersions.createdAt,
      })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, id))
      .orderBy(desc(pageVersions.createdAt))
      .limit(300);
    const ids = [...new Set(rows.flatMap((r) => r.authors))];
    const people = ids.length
      ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))
      : [];
    return c.json(
      rows.map((r) => ({
        ...r,
        authors: r.authors.map((a) => people.find((p) => p.id === a) ?? { id: a, name: "?" }),
      })),
    );
  })

  /** Saves a version right now ("Save version"). */
  .post("/pages/:id/versions", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt || !canEdit(access.role)) return c.json({ error: "Forbidden" }, 403);
    const versionId = await readDocument(id, (doc) => snapshot(id, doc, { force: true, kind: "manual" }));
    return c.json({ id: versionId, unchanged: versionId === null });
  })

  .get("/pages/:id/versions/:vid", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    const found = await versionDoc(id, c.req.param("vid"));
    if (!found) return c.json({ error: "Version not found" }, 404);
    return c.json({
      id: found.version.id,
      title: found.version.title,
      createdAt: found.version.createdAt,
      kind: found.version.kind,
      props: found.version.props,
      markdown: await docToMarkdown(found.doc),
      html: await docToHTML(found.doc),
    });
  })

  /** Current content as Markdown, to compare with a version. */
  .get("/pages/:id/markdown", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    const [page] = await db.select({ title: pages.title }).from(pages).where(eq(pages.id, id));
    return c.json({ title: page?.title ?? "", markdown: await getPageMarkdown(id) });
  })

  .post("/pages/:id/versions/:vid/restore", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    if (!canEdit(access.role)) return c.json({ error: "Forbidden" }, 403);
    const version = await restoreVersion(id, c.req.param("vid"), c.var.user.id);
    if (!version) return c.json({ error: "Version not found" }, 404);
    const [page] = await db.select({ type: pages.type, parentId: pages.parentId }).from(pages).where(eq(pages.id, id));
    if (page?.type === "row" && page.parentId) emitDatabase(access.workspaceId, page.parentId);
    else emitWorkspace(access.workspaceId);
    return c.json({ ok: true });
  });
