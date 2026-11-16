import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { pages } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { getDatabase, getRows, peopleNames, personIds } from "../lib/database.js";
import { databaseToCsv, exportWorkspace, fileName, pageToMarkdown } from "../lib/export.js";
import { getMembership, getPageAccess } from "../lib/workspaces.js";

/** RFC 5987 file name so accented titles survive the download. */
const disposition = (name: string) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export const exportRoutes = new Hono<AppEnv>()
  /** One page as Markdown (a database as CSV). */
  .get("/pages/:id/export", async (c) => {
    const id = c.req.param("id");
    const access = await getPageAccess(c.var.user.id, id);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    const [page] = await db
      .select({
        title: pages.title,
        icon: pages.icon,
        yjsState: pages.yjsState,
        type: pages.type,
        parentId: pages.parentId,
      })
      .from(pages)
      .where(eq(pages.id, id));
    if (!page) return c.json({ error: "Not found" }, 404);

    if (page.type === "database") {
      const { csv } = await databaseToCsv(id);
      return c.body(csv, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": disposition(`${fileName(page.title)}.csv`),
      });
    }
    let md: string;
    if (page.type === "row" && page.parentId) {
      const database = await getDatabase(page.parentId);
      const [row] = database ? await getRows(page.parentId, database.properties, [id]) : [];
      const people = await peopleNames(database && row ? personIds(database.properties, [row]) : []);
      md = await pageToMarkdown({ ...page, properties: database?.properties, people, row });
    } else md = await pageToMarkdown(page);
    return c.body(md, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": disposition(`${fileName(page.title)}.md`),
    });
  })

  /** The whole workspace as a ZIP of Markdown and CSV files. */
  .get("/workspaces/:wid/export", async (c) => {
    const wid = c.req.param("wid");
    if (!(await getMembership(c.var.user.id, wid))) return c.json({ error: "Not found" }, 404);
    const { zip, name } = await exportWorkspace(wid);
    const date = new Date().toISOString().slice(0, 10);
    return c.body(zip, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": disposition(`${name} ${date}.zip`),
    });
  });
