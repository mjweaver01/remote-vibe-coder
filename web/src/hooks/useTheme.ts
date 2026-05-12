import { useCallback, useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "rvc.theme";

function readStored(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", pref);
  }
}

/**
 * Theme preference: system (follow prefers-color-scheme), light, or dark.
 * Persists to localStorage and reflects to <html data-theme="…">.
 */
export function useTheme(): { pref: ThemePref; cycle: () => void; set: (p: ThemePref) => void } {
  const [pref, setPref] = useState<ThemePref>(() => readStored());

  useEffect(() => {
    apply(pref);
    try {
      if (pref === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, pref);
    } catch {}
  }, [pref]);

  const set = useCallback((p: ThemePref) => setPref(p), []);
  const cycle = useCallback(() => {
    setPref((p) => (p === "system" ? "light" : p === "light" ? "dark" : "system"));
  }, []);

  return { pref, cycle, set };
}

/** Apply stored preference on first paint, before React mounts. */
export function applyStoredThemeEarly() {
  apply(readStored());
}
