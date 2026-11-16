import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import * as Y from "yjs";
import { db } from "../db/index.js";
import { pages, user } from "../db/schema.js";
import { docToHTML } from "../lib/blocks.js";
import { TITLE_TEXT } from "../lib/ydoc.js";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Read-only pages published to the web, rendered on the server. */
export function publicRoutes(appCss: string | null) {
  return new Hono().get("/s/:slug", async (c) => {
    const [page] = await db
      .select({
        title: pages.title,
        icon: pages.icon,
        state: pages.yjsState,
        updatedAt: pages.updatedAt,
        author: user.name,
      })
      .from(pages)
      .leftJoin(user, eq(user.id, pages.createdBy))
      .where(and(eq(pages.publicSlug, c.req.param("slug")), isNull(pages.deletedAt)));
    if (!page) return c.html(notFound(appCss), 404);

    const doc = new Y.Doc();
    if (page.state) Y.applyUpdate(doc, page.state);
    const title = doc.getText(TITLE_TEXT).toString().trim() || page.title || "Untitled";
    const body = await docToHTML(doc);
    const updated = page.updatedAt.toISOString().slice(0, 10);

    c.header("Cache-Control", "public, max-age=30");
    c.header("X-Robots-Tag", "noindex");
    return c.html(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escape(title)}</title>
<meta property="og:title" content="${escape(title)}" />
<link rel="icon" href="/favicon.svg" />
${appCss ? `<link rel="stylesheet" href="${appCss}" />` : ""}
<script>document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";</script>
<style>${PUBLIC_CSS}</style>
</head>
<body>
<main class="pub">
  ${page.icon ? `<div class="pub-icon">${escape(page.icon)}</div>` : ""}
  <h1 class="page-title">${escape(title)}</h1>
  <p class="pub-meta">${page.author ? `${escape(page.author)} · ` : ""}<time datetime="${updated}">${updated}</time></p>
  <article class="pub-body">${body}</article>
</main>
<footer class="pub-footer"><span class="wordmark">Calepin</span></footer>
</body>
</html>`);
  });
}

function notFound(appCss: string | null) {
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Page not found</title>${appCss ? `<link rel="stylesheet" href="${appCss}" />` : ""}
<style>${PUBLIC_CSS}</style></head><body><main class="pub"><h1 class="page-title">Page not found</h1>
<p class="pub-meta">This page is no longer published.</p></main></body></html>`;
}

const PUBLIC_CSS = `
body { background: var(--background); color: var(--foreground); }
.pub { max-width: 720px; margin: 0 auto; padding: 64px 24px 96px; }
.pub-icon { font-size: 56px; line-height: 1; margin-bottom: 12px; }
.pub-meta { margin-top: 8px; font-size: 12px; line-height: 16px; color: var(--muted-foreground); }
.pub-body { margin-top: 32px; font-size: 16px; line-height: 26px; }
.pub-body > * + * { margin-top: 8px; }
.pub-body h1 { font-size: 28px; line-height: 36px; font-weight: 600; letter-spacing: -0.015em; margin-top: 32px; }
.pub-body h2 { font-size: 22px; line-height: 30px; font-weight: 600; letter-spacing: -0.01em; margin-top: 28px; }
.pub-body h3 { font-size: 18px; line-height: 26px; font-weight: 600; margin-top: 24px; }
.pub-body ul { list-style: disc; padding-left: 24px; }
.pub-body ol { list-style: decimal; padding-left: 24px; }
.pub-body li + li { margin-top: 4px; }
.pub-body a { color: var(--foreground); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--input); }
.pub-body blockquote { font-family: var(--font-serif); font-size: 18px; line-height: 28px; font-style: italic; border-left: 3px solid var(--border); padding-left: 16px; }
.pub-body code { font-family: var(--font-mono); font-size: 13px; background: var(--muted); border-radius: 6px; padding: 1px 4px; }
.pub-body pre { background: var(--muted); border-radius: 10px; padding: 12px 16px; overflow-x: auto; }
.pub-body pre code { background: none; padding: 0; }
.pub-body img { max-width: 100%; border-radius: 10px; }
.pub-body table { border-collapse: collapse; width: 100%; font-size: 14px; }
.pub-body td, .pub-body th { border: 1px solid var(--border); padding: 6px 8px; text-align: left; }
.pub-body input[type=checkbox] { margin-right: 8px; accent-color: var(--primary); }
.pub-body mark { background: var(--highlight); color: inherit; }
.pub-footer { text-align: center; padding: 0 0 48px; color: var(--muted-foreground); font-size: 13px; }
`;
