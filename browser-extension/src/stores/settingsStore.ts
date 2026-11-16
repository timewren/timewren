import { create } from "zustand";
import { resolveWebAppUrl, WEB_APP_URL } from "../config";
import {
  type LanguageSetting,
  resolveLanguage,
  setLocale,
  t,
} from "../i18n/core";

export interface ExtensionSettings {
  apiUrl: string;
  autoSyncInterval: number; // minutes
  showSiteSuggestions: boolean;
  showPrepaidStatus: boolean;
  // Reminder settings
  reminderEnabled: boolean;
  reminderHour: number; // 14-18
  reminderThreshold: number; // minimum hours before reminder fires
  reminderWeekends: boolean;
  // Daily goal
  dailyGoalHours: number;
  // New Tab settings
  newTabEnabled: boolean;
  newTabWidgets: string[];
  // Theme & display
  theme: "system" | "dark" | "light";
  badgeDisplay: "timer" | "today" | "off";
  calendarDefaultDay: "today" | "last-viewed";
  // Sprog: "auto" følger browseren, ellers da/en/de/es
  language: LanguageSetting;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  apiUrl: WEB_APP_URL,
  autoSyncInterval: 5,
  showSiteSuggestions: true,
  showPrepaidStatus: true,
  // Reminder defaults
  reminderEnabled: true,
  reminderHour: 15,
  reminderThreshold: 4,
  reminderWeekends: false,
  // Daily goal
  dailyGoalHours: 8,
  // New Tab defaults
  newTabEnabled: true,
  newTabWidgets: [
    "clock",
    "todayStats",
    "timer",
    "recentEntries",
    "weeklyChart",
  ],
  // Theme & display defaults
  theme: "system",
  badgeDisplay: "timer",
  calendarDefaultDay: "today",
  language: "auto",
};

interface SettingsState {
  settings: ExtensionSettings;
  isLoading: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (updates: Partial<ExtensionSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoading: true,

  loadSettings: async () => {
    try {
      const result = await chrome.storage.local.get(["extensionSettings"]);
      const stored = result.extensionSettings as
        | Partial<ExtensionSettings>
        | undefined;
      if (stored && typeof stored === "object") {
        await resolveWebAppUrl().catch(() => undefined);
        const settings = { ...DEFAULT_SETTINGS, ...stored };
        setLocale(resolveLanguage(settings.language));
        set({ settings, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      set({ isLoading: false });
    }
  },

  updateSettings: async (updates) => {
    const { settings } = get();
    if (updates.apiUrl !== undefined && updates.apiUrl !== settings.apiUrl) {
      throw new Error(t("errors.server.useSelector"));
    }
    const newSettings = { ...settings, ...updates };

    try {
      await chrome.storage.local.set({ extensionSettings: newSettings });
      setLocale(resolveLanguage(newSettings.language));
      set({ settings: newSettings });
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  },

  resetSettings: async () => {
    try {
      const settings = { ...DEFAULT_SETTINGS, apiUrl: get().settings.apiUrl };
      await chrome.storage.local.set({ extensionSettings: settings });
      setLocale(resolveLanguage(settings.language));
      set({ settings });
    } catch (error) {
      console.error("Failed to reset settings:", error);
    }
  },
}));
