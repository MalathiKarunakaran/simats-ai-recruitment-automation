import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

// Light is the default for everyone (2026-10-29); only an explicit toggle is
// remembered. A new key on purpose: the old "simats_theme" was written on
// every load, so it holds the computer's dark setting for many people who
// never chose it, and honouring it would keep them off the default.
const THEME_STORAGE_KEY = "simats_theme_choice";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage blocked: fall back to the default.
  }
  return "light";
}

function rememberChoice(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not remembered; the toggle still works for this visit.
  }
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Mounted once at the app root (main.tsx), not inside the authenticated
// shell -- the <html> class must be applied on every route, including
// /login, not only when ThemeToggle itself happens to be mounted.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      rememberChoice(next);
      return next;
    });
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
