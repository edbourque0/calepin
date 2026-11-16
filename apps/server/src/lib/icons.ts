import { icons } from "lucide";

/** Page icons: an emoji, or "lucide:<Name>[:<color>]" (see apps/web/src/lib/icons.ts). */
export function parseIcon(icon: string | null | undefined) {
  if (!icon) return null;
  if (icon.startsWith("lucide:")) {
    const [, name = "", color = "default"] = icon.split(":");
    return { kind: "lucide" as const, name, color };
  }
  return { kind: "emoji" as const, value: icon };
}

/** The emoji part of an icon, for plain text (Markdown headings, CSV, link labels). */
export const iconText = (icon: string | null | undefined) => {
  const p = parseIcon(icon);
  return p?.kind === "emoji" ? p.value : "";
};

/** "📁 " or "" — to put in front of a title. */
export const iconPrefix = (icon: string | null | undefined) => (iconText(icon) ? `${iconText(icon)} ` : "");

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Inline SVG for a Lucide icon (public pages), or the escaped emoji. */
export function iconHtml(icon: string | null | undefined, size: number) {
  const p = parseIcon(icon);
  if (!p) return "";
  if (p.kind === "emoji") return esc(p.value);
  const node = (icons as Record<string, [string, Record<string, string | number>][]>)[p.name];
  if (!node) return "";
  const color = /^[a-z]+$/.test(p.color) && p.color !== "default" ? `var(--icon-${p.color})` : "currentColor";
  const children = node
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([k, v]) => `${k}="${esc(String(v))}"`)
          .join(" ")}/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}
