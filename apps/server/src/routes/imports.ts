import { Hono } from "hono";
import { env } from "../env.js";
import type { AppEnv } from "../http.js";
import { getImportJob, startImport } from "../lib/importer.js";
import { canEdit, getMembership, getPageAccess } from "../lib/workspaces.js";

/** Imports run in the background (large exports take longer than a proxy waits); the client polls the job. */
export const importRoutes = new Hono<AppEnv>()
  .post("/workspaces/:wid/import", async (c) => {
    const wid = c.req.param("wid");
    const member = await getMembership(c.var.user.id, wid);
    if (!member || !canEdit(member.role)) return c.json({ error: "You can't add pages to this workspace" }, 403);
    const parentId = c.req.query("parent") || null;
    if (parentId) {
      const access = await getPageAccess(c.var.user.id, parentId);
      if (!access || access.workspaceId !== wid || !canEdit(access.role) || access.deletedAt)
        return c.json({ error: "Invalid destination page" }, 400);
    }
    const max = env.MAX_IMPORT_MB * 1024 * 1024;
    if (Number(c.req.header("content-length") ?? 0) > max)
      return c.json({ error: `Imports are limited to ${env.MAX_IMPORT_MB} MB` }, 413);
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (!data.length) return c.json({ error: "Empty file" }, 400);
    if (data.length > max) return c.json({ error: `Imports are limited to ${env.MAX_IMPORT_MB} MB` }, 413);
    const fileName = decodeURIComponent(c.req.header("x-file-name") ?? "import.zip");
    if (!/\.(zip|md|markdown|txt|csv)$/i.test(fileName))
      return c.json({ error: "Import a .zip, .md or .csv file" }, 400);
    const job = startImport({ userId: c.var.user.id, workspaceId: wid, parentId, fileName, data });
    return c.json({ id: job.id }, 202);
  })
  .get("/imports/:id", (c) => {
    const job = getImportJob(c.req.param("id"));
    if (!job || job.userId !== c.var.user.id) return c.json({ error: "Not found" }, 404);
    const { userId: _u, ...rest } = job;
    return c.json(rest);
  });
