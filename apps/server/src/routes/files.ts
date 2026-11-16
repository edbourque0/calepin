import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { files, pages } from "../db/schema.js";
import { env } from "../env.js";
import { type AppEnv, resolveUser } from "../http.js";
import { openFile, storeFile } from "../lib/storage.js";
import { canEdit, getMembership, getPageAccess } from "../lib/workspaces.js";

/* ---------- Signed links (published pages, where visitors have no session) ---------- */

const sign = (id: string, exp: number) =>
  createHmac("sha256", env.BETTER_AUTH_SECRET).update(`file:${id}:${exp}`).digest("base64url").slice(0, 32);

/** A link to a file that works without signing in, for `seconds`. */
export function signedFileUrl(id: string, seconds = 6 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return `/api/files/${id}?exp=${exp}&sig=${sign(id, exp)}`;
}

function validSignature(id: string, exp?: string, sig?: string) {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(id, Number(exp)));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Rewrites /api/files/<id> links in published HTML to signed ones. */
export function signFileLinks(html: string) {
  return html.replace(/\/api\/files\/([0-9a-f-]{36})(\/[^"'?\s)]*)?(\?[^"'\s)]*)?/g, (_m, id: string) =>
    signedFileUrl(id),
  );
}

/* ---------- Upload ---------- */

const INLINE = /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)|video\/|audio\/|application\/pdf$)/;

const safeName = (name: string) =>
  (name || "file")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .slice(0, 150);

export const fileUploadRoutes = new Hono<AppEnv>().post("/pages/:id/files", async (c) => {
  const pageId = c.req.param("id");
  const access = await getPageAccess(c.var.user.id, pageId);
  if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
  if (!canEdit(access.role)) return c.json({ error: "Forbidden" }, 403);
  const max = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (Number(c.req.header("content-length") ?? 0) > max)
    return c.json({ error: `Files are limited to ${env.MAX_UPLOAD_MB} MB` }, 413);
  const data = new Uint8Array(await c.req.arrayBuffer());
  if (!data.length) return c.json({ error: "Empty file" }, 400);
  if (data.length > max) return c.json({ error: `Files are limited to ${env.MAX_UPLOAD_MB} MB` }, 413);

  const mime =
    (c.req.header("content-type") ?? "application/octet-stream").split(";")[0]!.trim() || "application/octet-stream";
  try {
    const file = await saveUpload({
      workspaceId: access.workspaceId,
      pageId,
      userId: c.var.user.id,
      name: decodeURIComponent(c.req.header("x-file-name") ?? "file"),
      mime,
      data,
    });
    return c.json(file, 201);
  } catch (e) {
    console.error("[files] upload failed", e);
    return c.json({ error: e instanceof Error ? e.message : "Upload failed" }, 502);
  }
});

/** Stores an uploaded file for a page (disk or S3) and records it. Returns its in-app URL. */
export async function saveUpload(input: {
  workspaceId: string;
  pageId: string;
  userId: string;
  name: string;
  mime: string;
  data: Uint8Array;
}) {
  const name = safeName(input.name);
  const mime = input.mime || "application/octet-stream";
  const id = crypto.randomUUID();
  const stored = await storeFile(`${input.workspaceId}/${id}/${name}`, input.data, mime);
  await db.insert(files).values({
    id,
    workspaceId: input.workspaceId,
    pageId: input.pageId,
    uploadedBy: input.userId,
    name,
    mime,
    size: input.data.length,
    storage: stored.storage,
    key: stored.key,
  });
  return { id, url: `/api/files/${id}/${encodeURIComponent(name)}`, name, mime, size: input.data.length };
}

/* ---------- Download / display (proxied: the bucket stays private) ---------- */

export const fileRoutes = new Hono().get("/api/files/:id/:name?", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/.test(id)) return c.json({ error: "Not found" }, 404);
  const [file] = await db.select().from(files).where(eq(files.id, id));
  if (!file) return c.json({ error: "Not found" }, 404);

  const signed = validSignature(id, c.req.query("exp"), c.req.query("sig"));
  if (!signed) {
    const who = await resolveUser(c.req.raw.headers);
    let allowed = false;
    if (who) {
      if (file.pageId) allowed = !!(await getPageAccess(who.user.id, file.pageId));
      // Images copied into another page: anyone in the workspace can see them.
      if (!allowed) allowed = !!(await getMembership(who.user.id, file.workspaceId));
    }
    if (!allowed && file.pageId) {
      // Visible on a page published to the web.
      const [page] = await db
        .select({ slug: pages.publicSlug, deletedAt: pages.deletedAt })
        .from(pages)
        .where(eq(pages.id, file.pageId));
      allowed = !!page?.slug && !page.deletedAt;
    }
    if (!allowed) return c.json({ error: "Not found" }, 404);
  }

  let opened;
  try {
    opened = await openFile(file.storage, file.key, file.size, c.req.header("range"));
  } catch (e) {
    console.error("[files] read failed", e);
    return c.json({ error: "This file can't be read from storage right now" }, 502);
  }
  const inline = INLINE.test(file.mime);
  const headers = new Headers({
    "Content-Type": file.mime,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    // Files never change (new upload = new id): cache them hard, privately unless the link is signed.
    "Cache-Control": signed ? "public, max-age=3600" : "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    // Uploaded content can never run scripts in Calepin's origin.
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    ...opened.headers,
  });
  const body = opened.body instanceof Readable ? (Readable.toWeb(opened.body) as ReadableStream) : opened.body;
  return new Response(body, { status: opened.status, headers });
});
