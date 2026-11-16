import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Collaborator colours from the design system (chart-1…5). */
export const PRESENCE_VARS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];

function presenceIndex(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % PRESENCE_VARS.length;
}

/** CSS colour (a token reference) for a person: avatar ring, cursor and selection share it. */
export function colorFor(id: string) {
  return `var(${PRESENCE_VARS[presenceIndex(id)]})`;
}

/**
 * Hex value of a person's colour, for places that cannot use CSS variables: the editor's
 * cursor plugin appends an alpha suffix to it, which only works on #rrggbb.
 */
export function resolvedColorFor(id: string) {
  const probe = document.createElement("span");
  probe.style.color = `var(${PRESENCE_VARS[presenceIndex(id)]})`;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "#3f6fd8";
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function storage<T>(key: string, fallback: T) {
  return {
    get(): T {
      try {
        const raw = localStorage.getItem(`calepin:${key}`);
        return raw === null ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },
    set(value: T) {
      try {
        localStorage.setItem(`calepin:${key}`, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
    },
  };
}
