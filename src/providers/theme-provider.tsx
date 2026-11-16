"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { trpc } from "./trpc-provider";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  actualTheme: "light" | "dark"; // The resolved theme (system becomes light or dark)
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  // Fetch theme from database (only for authenticated users)
  const { data: themeData } = trpc.user.getTheme.useQuery(undefined, {
    // Only fetch after component mounts (client-side only)
    enabled: mounted,
    retry: false, // Don't retry if user is not authenticated
  });

  // Update theme mutation
  const updateThemeMutation = trpc.user.updateTheme.useMutation();

  // Get actual theme (resolve 'system' to 'light' or 'dark')
  const getActualTheme = (themeValue: Theme): "light" | "dark" => {
    if (themeValue === "system") {
      if (typeof window !== "undefined") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      }
      return "light";
    }
    return themeValue;
  };

  const actualTheme = getActualTheme(theme);

  // Initialize theme from localStorage on mount
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("theme") as Theme | null;
    if (stored) {
      setThemeState(stored);
    }
  }, []);

  // Update theme from database when it's fetched
  useEffect(() => {
    if (themeData?.theme) {
      const dbTheme = themeData.theme as Theme;
      setThemeState(dbTheme);
      localStorage.setItem("theme", dbTheme);
    }
  }, [themeData]);

  // Apply theme to document
  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;

    // Remove both classes first
    root.classList.remove("light", "dark");

    // Add the actual theme class
    root.classList.add(actualTheme);
  }, [actualTheme, mounted]);

  // Listen for system theme changes when theme is 'system'
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(mediaQuery.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      localStorage.setItem("theme", newTheme);

      updateThemeMutation.mutate(
        { theme: newTheme },
        {
          onError: () => {
            console.log(
              "Failed to save theme to database (user may not be authenticated)",
            );
          },
        },
      );
    },
    [updateThemeMutation],
  );

  const contextValue = useMemo(
    () => ({ theme, setTheme, actualTheme }),
    [theme, setTheme, actualTheme],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
