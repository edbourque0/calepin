import { useCallback, useSyncExternalStore } from "react";
import { storage } from "./utils";

/** What the user picked. "system" follows prefers-color-scheme. */
export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const store = storage<ThemePref>("theme", "system");
const listeners = new Set<() => void>();
const media = window.matchMedia("(prefers-color-scheme: dark)");

function resolve(pref: ThemePref): Theme {
  return pref === "system" ? (media.matches ? "dark" : "light") : pref;
}

function apply() {
  const theme = resolve(store.get());
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || (theme === "dark" ? "#1b1918" : "#fcfbf9"));
  listeners.forEach((l) => l());
}

apply();
media.addEventListener("change", () => store.get() === "system" && apply());

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => store.get());
  const theme = resolve(pref);
  const setPref = useCallback((p: ThemePref) => {
    store.set(p);
    apply();
  }, []);
  /** Pin a theme explicitly (used by ⌘⇧L). */
  const setTheme = useCallback((t: Theme) => setPref(t), [setPref]);
  return { pref, theme, setPref, setTheme };
}
