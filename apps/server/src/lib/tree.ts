import { sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { db } from "../db/index.js";

/** Ids of a page and all of its descendants (including deleted ones). */
export async function subtreeIds(rootId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM pages WHERE id = ${rootId}
      UNION ALL
      SELECT p.id FROM pages p JOIN tree t ON p.parent_id = t.id
    )
    SELECT id FROM tree
  `);
  return rows.map((r) => r.id);
}

/**
 * Sorted positions of the live siblings under `parentId` (null = workspace root),
 * excluding `excludeId`. Uses the C collation so ordering matches fractional-indexing keys.
 */
async function siblingPositions(workspaceId: string, parentId: string | null, excludeId?: string) {
  const rows = await db.execute<{ position: string }>(sql`
    SELECT position FROM pages
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
      AND ${parentId === null ? sql`parent_id IS NULL` : sql`parent_id = ${parentId}`}
      ${excludeId ? sql`AND id <> ${excludeId}` : sql``}
    ORDER BY position COLLATE "C"
  `);
  return rows.map((r) => r.position);
}

/** Position key for inserting at `index` among siblings (default: at the end). */
export async function positionAt(
  workspaceId: string,
  parentId: string | null,
  index?: number,
  excludeId?: string,
): Promise<string> {
  const positions = await siblingPositions(workspaceId, parentId, excludeId);
  const i = index === undefined ? positions.length : Math.max(0, Math.min(index, positions.length));
  const before = positions[i - 1] ?? null;
  const after = positions[i] ?? null;
  // Two siblings can share a key after concurrent inserts; nudge past duplicates.
  if (before !== null && after !== null && before >= after) return generateKeyBetween(before, null);
  return generateKeyBetween(before, after);
}
