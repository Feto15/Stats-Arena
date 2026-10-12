"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

type Theme = "light" | "dark";
type StoredTheme = Theme | "system";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const STORAGE_KEY = "theme";
const THEME_CHANGE_EVENT = "statsarena-theme-change";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveStoredTheme(value: string | null): Theme {
  const stored = value as StoredTheme | null;
  if (stored === "light" || stored === "dark") return stored;
  if (stored === "system") return systemTheme();
  return "dark";
}

function getBrowserTheme(): Theme {
  try {
    return resolveStoredTheme(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "dark";
  }
}

function subscribeToTheme(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) callback();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The server and first client render use dark mode. The browser snapshot is
  // applied only after hydration, so React never reconciles a theme script.
  const theme = useSyncExternalStore<Theme>(
    subscribeToTheme,
    getBrowserTheme,
    (): Theme => "dark"
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // Theme still changes for the active tab when storage is unavailable.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    applyTheme(nextTheme);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider.");
  }
  return context;
}
