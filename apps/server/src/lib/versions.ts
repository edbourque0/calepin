import { and, desc, eq, sql } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "../db/index.js";
import { pages, pageVersions, type VersionKind } from "../db/schema.js";
import { getTitle } from "./ydoc.js";

/** Minimum time between two automatic versions of a page while it is being edited. */
const AUTO_INTERVAL_MS = 10 * 60_000;

/** People who edited each page since its last version (in memory; best effort). */
const pendingAuthors = new Map<string, Set<string>>();

export function noteAuthor(pageId: string, userId: string | undefined | null) {
  if (!userId || userId === "system") return;
  const set = pendingAuthors.get(pageId) ?? new Set();
  set.add(userId);
  pendingAuthors.set(pageId, set);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Saves a version of the page if it changed since the last one.
 * `force` ignores the minimum interval (used when the last person leaves, before an
 * agent edit and before a restore).
 */
export async function snapshot(pageId: string, doc: Y.Doc, opts: { force?: boolean; kind?: VersionKind } = {}) {
  const stateVector = Y.encodeStateVector(doc);
  const [last] = await db
    .select({ createdAt: pageVersions.createdAt, stateVector: pageVersions.stateVector })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.createdAt))
    .limit(1);
  if (last && sameBytes(last.stateVector, stateVector)) return null; // nothing new
  if (last && !opts.force && Date.now() - last.createdAt.getTime() < AUTO_INTERVAL_MS) return null;
  // An empty, never-edited page is not worth a version.
  if (!last && doc.getXmlFragment("blocks").length === 0 && !getTitle(doc)) return null;

  const [page] = await db.select({ type: pages.type, props: pages.props }).from(pages).where(eq(pages.id, pageId));
  if (!page) return null;
  const authors = [...(pendingAuthors.get(pageId) ?? [])];
  pendingAuthors.delete(pageId);
  const [version] = await db
    .insert(pageVersions)
    .values({
      pageId,
      state: Y.encodeStateAsUpdate(doc),
      stateVector,
      title: getTitle(doc),
      props: page.type === "row" ? page.props : null,
      kind: opts.kind ?? "auto",
      authors,
    })
    .returning({ id: pageVersions.id });
  return version!.id;
}

/** Loads a version as a standalone Y.Doc. */
export async function versionDoc(pageId: string, versionId: string) {
  const [v] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)));
  if (!v) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, v.state);
  return { version: v, doc };
}

/**
 * Thins old versions: everything from the last day, one per hour for a week,
 * one per day up to `retentionDays`, and always the oldest remaining one.
 */
export async function pruneVersions(retentionDays: number) {
  const result = await db.execute(sql`
    WITH bucketed AS (
      SELECT id, page_id, created_at,
        CASE
          WHEN created_at > now() - interval '1 day' THEN id::text
          WHEN created_at > now() - interval '7 days' THEN 'h' || date_trunc('hour', created_at)::text
          WHEN created_at > now() - make_interval(days => ${retentionDays}) THEN 'd' || date_trunc('day', created_at)::text
          ELSE 'old'
        END AS bucket
      FROM page_versions
    ),
    ranked AS (
      SELECT id, row_number() OVER (PARTITION BY page_id, bucket ORDER BY created_at DESC) AS rn FROM bucketed
    )
    DELETE FROM page_versions WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
  `);
  return result.count ?? 0;
}
