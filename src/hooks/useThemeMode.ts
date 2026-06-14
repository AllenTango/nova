import { useEffect, useState, useCallback } from "react";
import { api, Settings } from "../api/client";

/**
 * Manages the theme mode (dark/light) and persists it to the backend.
 * Falls back to localStorage when the backend is unavailable (dev).
 */
export function useThemeMode() {
  const [mode, setMode] = useState<"dark" | "light">(() => {
    const cached = localStorage.getItem("nova.theme");
    if (cached === "dark" || cached === "light") return cached;
    return "dark";
  });
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);

  // Hydrate from server on first mount
  useEffect(() => {
    api.settings
      .get()
      .then((s: Settings) => {
        setSettings(s);
        if (s?.theme === "dark" || s?.theme === "light") {
          setMode(s.theme);
          localStorage.setItem("nova.theme", s.theme);
        }
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
  }, []);

  // Persist + apply
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem("nova.theme", mode);
    if (hydrated && settings) {
      api.settings
        .save({
          ...settings,
          theme: mode,
        })
        .catch(() => {});
    }
  }, [mode, hydrated, settings]);

  const toggle = useCallback(() => {
    setMode((m) => (m === "dark" ? "light" : "dark"));
  }, []);

  return { mode, setMode, toggle };
}
