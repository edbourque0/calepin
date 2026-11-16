import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { db } from "../db/index.js";
import type { AppEnv } from "../http.js";
import { AiError, aiReady, buildMessages, chat, getAiSettings } from "../lib/ai.js";
import { getPageMarkdown } from "../lib/pages.js";
import { getMembership, getPageAccess } from "../lib/workspaces.js";

const input = z.object({
  action: z.enum(["summarize", "continue", "improve", "shorter", "translate", "ask", "notes"]),
  pageId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  selection: z.string().max(50_000).optional(),
  prompt: z.string().max(4000).optional(),
  language: z.string().max(40).optional(),
  lang: z.string().max(5).default("fr"),
});

/** Words worth searching for in a question (any of them may match). */
function questionQuery(q: string) {
  const terms = (q.match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 2).slice(0, 12);
  return terms.length ? terms.map((t) => `${t.toLowerCase()}:*`).join(" | ") : null;
}

async function notesFor(workspaceId: string, question: string) {
  const tsquery = questionQuery(question);
  if (!tsquery) return [];
  const rows = await db.execute<{ id: string; title: string; text: string }>(sql`
    SELECT id, title, left(content_text, 4000) AS text
    FROM pages
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL AND type <> 'database'
      AND search @@ to_tsquery('calepin', ${tsquery})
    ORDER BY ts_rank_cd(search, to_tsquery('calepin', ${tsquery})) DESC, updated_at DESC
    LIMIT 6
  `);
  return [...rows];
}

/** Writing help and questions about your notes, streamed as plain text. */
export const aiRoutes = new Hono<AppEnv>().post("/ai/complete", async (c) => {
  const settings = await getAiSettings();
  if (!aiReady(settings)) return c.json({ error: "The AI assistant isn't set up" }, 400);
  const body = input.parse(await c.req.json());

  let page: { title: string; markdown: string } | undefined;
  if (body.pageId) {
    const access = await getPageAccess(c.var.user.id, body.pageId);
    if (!access || access.deletedAt) return c.json({ error: "Not found" }, 404);
    const [row] = await db.execute<{ title: string }>(sql`SELECT title FROM pages WHERE id = ${body.pageId}`);
    page = { title: row?.title ?? "", markdown: await getPageMarkdown(body.pageId) };
  }
  let sources: { id: string; title: string; text: string }[] | undefined;
  if (body.action === "notes") {
    if (!body.workspaceId || !body.prompt) return c.json({ error: "Ask a question" }, 400);
    if (!(await getMembership(c.var.user.id, body.workspaceId))) return c.json({ error: "Not found" }, 404);
    sources = await notesFor(body.workspaceId, body.prompt);
  }

  const messages = buildMessages({ ...body, page, sources });
  const abort = new AbortController();
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "no-store");
  c.header("X-Accel-Buffering", "no");
  return stream(c, async (s) => {
    s.onAbort(() => abort.abort());
    try {
      for await (const chunk of chat(settings, messages, { signal: abort.signal })) await s.write(chunk);
    } catch (e) {
      if (!abort.signal.aborted) await s.write(`\n\n⚠️ ${e instanceof AiError ? e.message : "The AI provider failed"}`);
    }
  });
});
