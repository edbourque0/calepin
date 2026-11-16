import { BlockNoteSchema, createBlockSpec } from "@blocknote/core";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { getDocument } from "@blocknote/server-util/dom";
import type * as Y from "yjs";
import { BLOCKS_FRAGMENT } from "./ydoc.js";

/**
 * Inline database block (must match the web client's schema): a database embedded in a page.
 * Exported to HTML as a placeholder the public renderer replaces, and to Markdown as a link.
 */
const DatabaseBlock = createBlockSpec(
  { type: "database", propSchema: { databaseId: { default: "" } }, content: "none" },
  {
    render: (block) => {
      const dom = (globalThis.document ?? getDocument()).createElement("div");
      dom.dataset.calepinDatabase = block.props.databaseId;
      return { dom };
    },
    toExternalHTML: (block) => {
      const doc = globalThis.document ?? getDocument();
      const dom = doc.createElement("p");
      const a = doc.createElement("a");
      a.href = `/p/${block.props.databaseId}`;
      a.dataset.calepinDatabase = block.props.databaseId;
      a.textContent = "Database";
      dom.appendChild(a);
      return { dom };
    },
  },
);

export const schema = BlockNoteSchema.create().extend({ blockSpecs: { database: DatabaseBlock() } });

/** BlockNote running on the server (jsdom), for Markdown/HTML conversion of page content. */
let instance: ServerBlockNoteEditor<any, any, any> | null = null;
function editor() {
  instance ??= ServerBlockNoteEditor.create({ schema }, getDocument());
  return instance;
}

/** Ids of databases embedded in a document. */
export function embeddedDatabases(doc: Y.Doc): string[] {
  const out: string[] = [];
  const walk = (blocks: { type: string; props?: Record<string, unknown>; children?: unknown[] }[]) => {
    for (const b of blocks) {
      if (b.type === "database" && typeof b.props?.databaseId === "string" && b.props.databaseId)
        out.push(b.props.databaseId);
      if (Array.isArray(b.children)) walk(b.children as never);
    }
  };
  walk(docToBlocks(doc) as never);
  return out;
}

export function docToBlocks(doc: Y.Doc) {
  return editor().yDocToBlocks(doc, BLOCKS_FRAGMENT);
}

export async function docToMarkdown(doc: Y.Doc) {
  return (await editor().blocksToMarkdownLossy(docToBlocks(doc))).trim();
}

export async function docToHTML(doc: Y.Doc) {
  return editor().blocksToHTMLLossy(docToBlocks(doc));
}

export async function markdownToBlocks(markdown: string) {
  return editor().tryParseMarkdownToBlocks(markdown);
}

/** Replaces (or appends to) the BlockNote content of a document with parsed Markdown. */
export async function writeMarkdown(doc: Y.Doc, markdown: string, mode: "append" | "replace") {
  // Links to databases already embedded in the page come back as embedded databases.
  const embedded = new Set(embeddedDatabases(doc));
  const incoming = (await markdownToBlocks(markdown)).map((b) => {
    const content = (b as { content?: unknown }).content;
    if (b.type !== "paragraph" || !Array.isArray(content) || content.length !== 1) return b;
    const link = content[0] as { type: string; href?: string };
    const id = link.type === "link" ? link.href?.match(/^\/p\/([0-9a-f-]{36})$/)?.[1] : undefined;
    return id && embedded.has(id) ? ({ type: "database", props: { databaseId: id } } as unknown as typeof b) : b;
  });
  const existing = mode === "append" ? docToBlocks(doc) : [];
  // An empty editor holds a single empty paragraph: don't keep it in front of appended content.
  const kept = existing.filter(
    (b, i) =>
      !(
        existing.length === 1 &&
        i === 0 &&
        b.type === "paragraph" &&
        (!b.content || (Array.isArray(b.content) && b.content.length === 0))
      ),
  );
  // y-prosemirror diffs against the existing fragment, so unchanged blocks keep their identity
  // and collaborators' cursors stay put.
  editor().blocksToYXmlFragment([...kept, ...incoming], doc.getXmlFragment(BLOCKS_FRAGMENT));
}

/** Replaces the document's blocks with those of another document (diffed, so it merges cleanly). */
export function copyBlocks(from: Y.Doc, to: Y.Doc) {
  editor().blocksToYXmlFragment(docToBlocks(from), to.getXmlFragment(BLOCKS_FRAGMENT));
}
