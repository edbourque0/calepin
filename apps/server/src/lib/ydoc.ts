import * as Y from "yjs";

/** Name of the Y.XmlFragment holding the BlockNote document. Must match the web client. */
export const BLOCKS_FRAGMENT = "blocks";
/** Name of the Y.Text holding the page title. Must match the web client. */
export const TITLE_TEXT = "title";

export function getTitle(doc: Y.Doc): string {
  return doc.getText(TITLE_TEXT).toString().trim();
}

/** Flattens the BlockNote XML tree into plain text, one line per text node. */
export function extractText(doc: Y.Doc, maxLength = 200_000): string {
  const lines: string[] = [];
  let length = 0;

  const walk = (node: Y.XmlElement | Y.XmlFragment | Y.XmlText) => {
    if (length > maxLength) return;
    if (node instanceof Y.XmlText) {
      const text = (node.toDelta() as { insert: unknown }[])
        .map((d) => (typeof d.insert === "string" ? d.insert : ""))
        .join("");
      if (text) {
        lines.push(text);
        length += text.length;
      }
      return;
    }
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlElement || child instanceof Y.XmlText || child instanceof Y.XmlFragment) walk(child);
    }
  };

  walk(doc.getXmlFragment(BLOCKS_FRAGMENT));
  return lines.join("\n").slice(0, maxLength);
}

/** URL of the first image block in the document, or null. */
export function extractCover(doc: Y.Doc): string | null {
  const walk = (node: Y.XmlElement | Y.XmlFragment): string | null => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === "image") {
        const url = child.getAttribute("url");
        if (typeof url === "string" && url) return url;
      }
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(doc.getXmlFragment(BLOCKS_FRAGMENT));
}
