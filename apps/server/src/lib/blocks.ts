import { BlockNoteSchema, createBlockSpec, createCodeBlockSpec } from "@blocknote/core";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { getDocument } from "@blocknote/server-util/dom";
import type * as Y from "yjs";
import { CALLOUT_KEYWORD, CALLOUT_TONES, quotesToCallouts, type CalloutTone } from "./callouts.js";
import { CODE_LANGUAGES, DEFAULT_CODE_LANGUAGE, normaliseCodeLanguages } from "./codeLanguages.js";
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

/**
 * Callout (must match the web client's CalloutBlock). Exported as a GitHub alert quote
 * ("> [!WARNING]"), which Markdown import turns back into a callout.
 */
const CalloutBlock = createBlockSpec(
  {
    type: "callout",
    propSchema: { tone: { default: "info" as CalloutTone, values: CALLOUT_TONES } },
    content: "inline",
  },
  {
    render: (block) => {
      const doc = globalThis.document ?? getDocument();
      const dom = doc.createElement("div");
      dom.className = `calepin-callout calepin-callout-${block.props.tone}`;
      const contentDOM = doc.createElement("div");
      contentDOM.className = "calepin-callout-body";
      dom.appendChild(contentDOM);
      return { dom, contentDOM };
    },
    toExternalHTML: (block) => {
      const doc = globalThis.document ?? getDocument();
      const dom = doc.createElement("blockquote");
      dom.dataset.calloutTone = block.props.tone;
      const marker = doc.createElement("p");
      marker.textContent = `[!${CALLOUT_KEYWORD[block.props.tone] ?? "NOTE"}]`;
      const contentDOM = doc.createElement("p");
      dom.append(marker, contentDOM);
      return { dom, contentDOM };
    },
  },
);

/** Code blocks know Calepin's languages, so ```ps1 is stored as "powershell" and exported back. */
const codeBlock = createCodeBlockSpec({ defaultLanguage: DEFAULT_CODE_LANGUAGE, supportedLanguages: CODE_LANGUAGES });

export const schema = BlockNoteSchema.create().extend({
  blockSpecs: { codeBlock, database: DatabaseBlock(), callout: CalloutBlock() },
});

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
  return normaliseCodeLanguages(quotesToCallouts(await editor().tryParseMarkdownToBlocks(markdown)));
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

/** Appends blocks (BlockNote JSON) at the end of the document. */
export function appendBlocks(doc: Y.Doc, blocks: Record<string, unknown>[]) {
  const existing = docToBlocks(doc);
  const kept = existing.filter(
    (b, i) =>
      !(
        existing.length === 1 &&
        i === 0 &&
        b.type === "paragraph" &&
        (!b.content || (Array.isArray(b.content) && b.content.length === 0))
      ),
  );
  editor().blocksToYXmlFragment([...kept, ...blocks] as never, doc.getXmlFragment(BLOCKS_FRAGMENT));
}
