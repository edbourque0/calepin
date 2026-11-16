import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { getDocument } from "@blocknote/server-util/dom";
import type * as Y from "yjs";
import { BLOCKS_FRAGMENT } from "./ydoc.js";

/** BlockNote running on the server (jsdom), for Markdown/HTML conversion of page content. */
let instance: ServerBlockNoteEditor | null = null;
function editor() {
  instance ??= ServerBlockNoteEditor.create({}, getDocument());
  return instance;
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
  const incoming = await markdownToBlocks(markdown);
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
