import { useSyncExternalStore } from "react";

/**
 * Page icons are stored as text: an emoji ("📁") or a Lucide icon, "lucide:<Name>" with an optional colour,
 * "lucide:<Name>:<color>". The Lucide icon set (~1,700 icons) loads once, in its own chunk.
 */
export const ICON_COLORS = ["default", "gray", "amber", "green", "blue", "rose", "violet", "orange", "teal"] as const;
export type IconColor = (typeof ICON_COLORS)[number];

export type ParsedIcon = { kind: "emoji"; value: string } | { kind: "lucide"; name: string; color: IconColor };

export function parseIcon(icon: string | null | undefined): ParsedIcon | null {
  if (!icon) return null;
  if (icon.startsWith("lucide:")) {
    const [, name = "", color = "default"] = icon.split(":");
    return {
      kind: "lucide",
      name,
      color: (ICON_COLORS as readonly string[]).includes(color) ? (color as IconColor) : "default",
    };
  }
  return { kind: "emoji", value: icon };
}

export const lucideIcon = (name: string, color: IconColor = "default") =>
  color === "default" ? `lucide:${name}` : `lucide:${name}:${color}`;

/** Emoji part only, for places that show plain text (select lists, file names). */
export const iconText = (icon: string | null | undefined) => {
  const p = parseIcon(icon);
  return p?.kind === "emoji" ? p.value : "";
};

export const iconColorVar = (color: IconColor) => (color === "default" ? undefined : `var(--icon-${color})`);

/* ---------- Lazy icon set ---------- */

export type IconNode = [tag: string, attrs: Record<string, string | number>][];
type IconSet = Record<string, IconNode>;

let set: IconSet | null = null;
let loading: Promise<IconSet> | null = null;
const listeners = new Set<() => void>();

export function loadIcons() {
  loading ??= import("lucide").then((m) => {
    set = m.icons as unknown as IconSet;
    for (const l of listeners) l();
    return set;
  });
  return loading;
}

/** The icon set once loaded (null before); triggers the load. */
export function useIconSet() {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => set,
  );
  if (!value) void loadIcons();
  return value;
}

/** "ArrowUpRight" → "arrow up right" for searching. */
export const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
