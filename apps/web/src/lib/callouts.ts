/**
 * Callouts in Markdown use the GitHub / Obsidian alert syntax:
 *
 *   > [!WARNING] Optional title
 *   > Body
 *
 * BlockNote parses that as a quote; these helpers turn such quotes into callout blocks.
 * Must match apps/server/src/lib/callouts.ts.
 */
export const CALLOUT_TONES = ["info", "tip", "warning", "danger"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Tone → GitHub alert keyword, used when exporting. */
export const CALLOUT_KEYWORD: Record<CalloutTone, string> = {
  info: "NOTE",
  tip: "TIP",
  warning: "WARNING",
  danger: "CAUTION",
};

/** GitHub and Obsidian alert keywords → tone. */
const KEYWORD_TONE: Record<string, CalloutTone> = {
  note: "info",
  info: "info",
  abstract: "info",
  summary: "info",
  tldr: "info",
  todo: "info",
  question: "info",
  help: "info",
  faq: "info",
  quote: "info",
  cite: "info",
  example: "info",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "tip",
  check: "tip",
  done: "tip",
  warning: "warning",
  caution: "danger",
  attention: "warning",
  danger: "danger",
  error: "danger",
  failure: "danger",
  fail: "danger",
  missing: "danger",
  bug: "danger",
};

type Text = { type: string; text?: string; styles?: Record<string, unknown>; [k: string]: unknown };
type Block = { type: string; props?: Record<string, unknown>; content?: unknown; children?: Block[]; [k: string]: unknown };

const MARKER = /^\s*\[!([a-z]+)\][+-]?[ \t]*/i;

/** A quote starting with "[!KEYWORD]" becomes a callout; the rest of that line becomes a bold title. */
function toCallout(block: Block): Block {
  const content = block.content as Text[] | undefined;
  if (block.type !== "quote" || !Array.isArray(content) || content[0]?.type !== "text") return block;
  const first = content[0].text ?? "";
  const m = first.match(MARKER);
  const tone = m ? KEYWORD_TONE[m[1]!.toLowerCase()] : undefined;
  if (!m || !tone) return block;

  // Split the first text run at the end of the marker line: what's left on that line is the title.
  const rest = first.slice(m[0].length);
  const nl = rest.indexOf("\n");
  const title = (nl === -1 ? rest : rest.slice(0, nl)).trim();
  const after = nl === -1 ? "" : rest.slice(nl + 1);
  const out: Text[] = [];
  if (title) out.push({ type: "text", text: title, styles: { bold: true } });
  if (title && (after || content.length > 1)) out.push({ type: "text", text: "\n", styles: {} });
  if (after) out.push({ ...content[0], text: after });
  out.push(...content.slice(1));
  // Quote lines come back as "\n " — drop the leading space Markdown left on each line.
  for (const t of out) if (typeof t.text === "string") t.text = t.text.replace(/\n[ \t]+/g, "\n");
  while (out.length && typeof out[0]!.text === "string" && !out[0]!.text.trim()) out.shift();
  if (out[0] && typeof out[0].text === "string") out[0].text = out[0].text.replace(/^\s+/, "");

  return {
    ...block,
    type: "callout",
    props: { tone },
    content: out,
  };
}

/** Converts alert quotes (at any depth) into callout blocks. */
export function quotesToCallouts<T>(blocks: T[]): T[] {
  return (blocks as unknown as Block[]).map((b) => {
    const converted = toCallout(b);
    return (
      Array.isArray(converted.children) && converted.children.length
        ? { ...converted, children: quotesToCallouts(converted.children) }
        : converted
    ) as unknown as T;
  }) as unknown as T[];
}
