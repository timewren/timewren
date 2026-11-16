import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TimeListGroupBy =
  | "date"
  | "client"
  | "project"
  | "tag"
  | "task"
  | "none";

export interface TimeListDefaultFilters {
  projectId: string;
  clientId: string;
  billedStatus: "" | "billed" | "unbilled";
  billableStatus: "" | "billable" | "non-billable";
}

interface TimeListPreferencesState {
  groupBy: TimeListGroupBy;
  setGroupBy: (groupBy: TimeListGroupBy) => void;
  /** Gemte standardfiltre — anvendes ved sideåbning uden filter-params i URL'en */
  defaultFilters: TimeListDefaultFilters | null;
  setDefaultFilters: (filters: TimeListDefaultFilters | null) => void;
}

export const useTimeListPreferences = create<TimeListPreferencesState>()(
  persist(
    (set) => ({
      groupBy: "date",
      setGroupBy: (groupBy) => set({ groupBy }),
      defaultFilters: null,
      setDefaultFilters: (defaultFilters) => set({ defaultFilters }),
    }),
    {
      name: "timetrack-time-list-preferences",
    },
  ),
);
