import { invoke } from "@tauri-apps/api/core";
import i18n from "i18next";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  theme: "light" | "dark" | "system";
  language: "da" | "en" | "sv" | "nb" | "de" | "es";
  sidebarExpanded: boolean;
  idleThresholdMinutes: number;
  reviewReminderTime: string;
  trackingPaused: boolean;
  sentryEnabled: boolean;
  analyticsEnabled: boolean;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setLanguage: (language: "da" | "en" | "sv" | "nb" | "de" | "es") => void;
  toggleSidebar: () => void;
  setTrackingPaused: (paused: boolean) => void;
  setSentryEnabled: (enabled: boolean) => void;
  setAnalyticsEnabled: (enabled: boolean) => void;
}

/** Apply the correct dark/light class based on resolved theme */
function applyThemeClass(theme: "light" | "dark" | "system") {
  if (theme === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    if (prefersDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  } else if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

// Module-level listener cleanup ref
let systemThemeCleanup: (() => void) | null = null;

/** Set up or tear down the system theme media query listener */
function setupSystemThemeListener(theme: "light" | "dark" | "system") {
  // Always clean up previous listener
  if (systemThemeCleanup) {
    systemThemeCleanup();
    systemThemeCleanup = null;
  }

  if (theme === "system") {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyThemeClass("system");
    mediaQuery.addEventListener("change", handler);
    systemThemeCleanup = () =>
      mediaQuery.removeEventListener("change", handler);
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      language: "da",
      sidebarExpanded: false,
      idleThresholdMinutes: 5,
      reviewReminderTime: "17:00",
      trackingPaused: false,
      sentryEnabled: true,
      analyticsEnabled: true,
      setTheme: (theme) => {
        set({ theme });
        applyThemeClass(theme);
        setupSystemThemeListener(theme);
      },
      setLanguage: (language) => {
        set({ language });
        i18n.changeLanguage(language);
        invoke("set_app_language", { lang: language }).catch(() => {});
      },
      toggleSidebar: () =>
        set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setTrackingPaused: (paused) => set({ trackingPaused: paused }),
      setSentryEnabled: (enabled) => set({ sentryEnabled: enabled }),
      setAnalyticsEnabled: (enabled) => set({ analyticsEnabled: enabled }),
    }),
    {
      name: "timetrack-settings",
      onRehydrateStorage: () => (state) => {
        // After rehydrating from localStorage, apply the persisted theme
        if (state) {
          applyThemeClass(state.theme);
          setupSystemThemeListener(state.theme);
          // Apply the persisted language
          if (state.language) {
            i18n.changeLanguage(state.language);
          }
        }
      },
    },
  ),
);
