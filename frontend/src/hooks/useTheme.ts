"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "coincard-theme";

/**
 * Theme toggle, persisted to localStorage.
 *
 * The initial value is read from the DOM, not from localStorage — the inline
 * script in `layout.tsx` has already applied the stored choice to
 * `<html data-theme>` before React hydrates. Reading it back here keeps the
 * hook in sync without a second flash of the wrong theme.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const applied = document.documentElement.getAttribute("data-theme");
    if (applied === "dark" || applied === "light") {
      setTheme(applied);
      return;
    }
    // Nothing stamped yet: fall back to the OS preference.
    setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  const applyTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / storage disabled — the toggle still works for this session */
    }
    setTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    applyTheme(theme === "dark" ? "light" : "dark");
  }, [theme, applyTheme]);

  return { theme, setTheme: applyTheme, toggleTheme };
}
