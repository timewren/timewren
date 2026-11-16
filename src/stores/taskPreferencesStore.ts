import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BoardSort } from "@/lib/kanban/lane-category";

type ViewMode = "list" | "board";
type ListDensity = "compact" | "normal" | "detailed";
type SortDir = "asc" | "desc";
type GroupBy = "none" | "client" | "project" | "priority" | "status";
type StatusFilter =
  | "all"
  | "active"
  | "backlog"
  | "todo"
  | "in_progress"
  | "done";
type PriorityFilter = "all" | "low" | "medium" | "high" | "urgent";
type DeadlineFilter = "all" | "overdue" | "this_week" | "this_month";

interface FilterPreset {
  id: string;
  name: string;
  statusFilter: string;
  priorityFilter: string;
  clientFilter: string;
  deadlineFilter: string;
  projectFilter: string;
  assigneeFilter?: string;
  listDensity: string;
  listColumns: string[];
  listSortBy: string;
  listSortDir: string;
  listGroupBy: string;
}

interface TaskPreferencesState {
  viewMode: ViewMode;
  statsCollapsed: boolean;
  searchQuery: string;
  statusFilter: StatusFilter;
  priorityFilter: PriorityFilter;
  clientFilter: string; // "all" or client UUID
  lastProjectId: string | null;
  lastClientId: string | null;
  boardSearchQuery: string;
  deadlineFilter: DeadlineFilter;
  projectFilter: string; // "all" or project UUID
  assigneeFilter: string; // "all" | "mine" | "_none" | member userId
  doneColumnCollapsed: boolean;
  /** Foldede kolonner på tavlen pr. kolonne-id (uden post: standard). */
  laneCollapsed: Record<string, boolean>;
  /** Kortenes rækkefølge i kolonnerne. */
  boardSort: BoardSort;
  listDensity: ListDensity;
  listColumns: string[];
  listSortBy: string;
  listSortDir: SortDir;
  listGroupBy: GroupBy;
  filterPresets: FilterPreset[];
  activePresetId: string | null;

  setViewMode: (mode: ViewMode) => void;
  setStatsCollapsed: (collapsed: boolean) => void;
  toggleStats: () => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setPriorityFilter: (filter: PriorityFilter) => void;
  setClientFilter: (filter: string) => void;
  setLastProjectId: (id: string | null) => void;
  setLastClientId: (id: string | null) => void;
  setLastContext: (projectId: string | null, clientId: string | null) => void;
  setBoardSearchQuery: (query: string) => void;
  setDeadlineFilter: (filter: DeadlineFilter) => void;
  setProjectFilter: (filter: string) => void;
  setAssigneeFilter: (filter: string) => void;
  setDoneColumnCollapsed: (collapsed: boolean) => void;
  toggleDoneColumn: () => void;
  setLaneCollapsed: (laneId: string, collapsed: boolean) => void;
  setBoardSort: (sort: BoardSort) => void;
  setListDensity: (density: ListDensity) => void;
  setListColumns: (columns: string[]) => void;
  setListSortBy: (sortBy: string) => void;
  setListSortDir: (dir: SortDir) => void;
  setListGroupBy: (groupBy: GroupBy) => void;
  addFilterPreset: (name: string) => void;
  removeFilterPreset: (id: string) => void;
  applyFilterPreset: (id: string) => void;
  setActivePresetId: (id: string | null) => void;
}

/** Tid-mod-estimat-kolonnerne i listevisningen (#212). */
const TIME_LIST_COLUMNS = ["estimate", "actualTime", "progress"];

const DEFAULT_LIST_COLUMNS = [
  "status",
  "priority",
  "client",
  "project",
  "deadline",
  ...TIME_LIST_COLUMNS,
];

export const useTaskPreferencesStore = create<TaskPreferencesState>()(
  persist(
    (set) => ({
      viewMode: "board",
      statsCollapsed: true,
      searchQuery: "",
      statusFilter: "active",
      priorityFilter: "all",
      clientFilter: "all",
      lastProjectId: null,
      lastClientId: null,
      boardSearchQuery: "",
      deadlineFilter: "all",
      projectFilter: "all",
      assigneeFilter: "all",
      doneColumnCollapsed: true,
      laneCollapsed: {},
      boardSort: "manual" as BoardSort,
      listDensity: "normal" as ListDensity,
      listColumns: [...DEFAULT_LIST_COLUMNS],
      listSortBy: "priority",
      listSortDir: "asc" as SortDir,
      listGroupBy: "none" as GroupBy,
      filterPresets: [],
      activePresetId: null,

      setViewMode: (viewMode) => set({ viewMode }),
      setStatsCollapsed: (statsCollapsed) => set({ statsCollapsed }),
      toggleStats: () =>
        set((state) => ({ statsCollapsed: !state.statsCollapsed })),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setStatusFilter: (statusFilter) => set({ statusFilter }),
      setPriorityFilter: (priorityFilter) => set({ priorityFilter }),
      setClientFilter: (clientFilter) => set({ clientFilter }),
      setLastProjectId: (lastProjectId) => set({ lastProjectId }),
      setLastClientId: (lastClientId) => set({ lastClientId }),
      setLastContext: (lastProjectId, lastClientId) =>
        set({ lastProjectId, lastClientId }),
      setBoardSearchQuery: (boardSearchQuery) => set({ boardSearchQuery }),
      setDeadlineFilter: (deadlineFilter) => set({ deadlineFilter }),
      setProjectFilter: (projectFilter) => set({ projectFilter }),
      setAssigneeFilter: (assigneeFilter) => set({ assigneeFilter }),
      setDoneColumnCollapsed: (doneColumnCollapsed) =>
        set({ doneColumnCollapsed }),
      toggleDoneColumn: () =>
        set((state) => ({ doneColumnCollapsed: !state.doneColumnCollapsed })),
      setLaneCollapsed: (laneId, collapsed) =>
        set((state) => ({
          laneCollapsed: { ...state.laneCollapsed, [laneId]: collapsed },
        })),
      setBoardSort: (boardSort) => set({ boardSort }),
      setListDensity: (listDensity) => set({ listDensity }),
      setListColumns: (listColumns) => set({ listColumns }),
      setListSortBy: (listSortBy) => set({ listSortBy }),
      setListSortDir: (listSortDir) => set({ listSortDir }),
      setListGroupBy: (listGroupBy) => set({ listGroupBy }),
      addFilterPreset: (name) =>
        set((state) => {
          const id = crypto.randomUUID();
          return {
            filterPresets: [
              ...state.filterPresets,
              {
                id,
                name,
                statusFilter: state.statusFilter,
                priorityFilter: state.priorityFilter,
                clientFilter: state.clientFilter,
                deadlineFilter: state.deadlineFilter,
                projectFilter: state.projectFilter,
                assigneeFilter: state.assigneeFilter,
                listDensity: state.listDensity,
                listColumns: [...state.listColumns],
                listSortBy: state.listSortBy,
                listSortDir: state.listSortDir,
                listGroupBy: state.listGroupBy,
              },
            ],
            activePresetId: id,
          };
        }),
      removeFilterPreset: (id) =>
        set((state) => ({
          filterPresets: state.filterPresets.filter((p) => p.id !== id),
          activePresetId:
            state.activePresetId === id ? null : state.activePresetId,
        })),
      applyFilterPreset: (id) =>
        set((state) => {
          const preset = state.filterPresets.find((p) => p.id === id);
          if (!preset) return {};
          return {
            statusFilter: (preset.statusFilter ??
              state.statusFilter) as StatusFilter,
            priorityFilter: (preset.priorityFilter ??
              state.priorityFilter) as PriorityFilter,
            clientFilter: preset.clientFilter ?? state.clientFilter,
            deadlineFilter: (preset.deadlineFilter ??
              state.deadlineFilter) as DeadlineFilter,
            projectFilter: preset.projectFilter ?? state.projectFilter,
            assigneeFilter: preset.assigneeFilter ?? state.assigneeFilter,
            listDensity: (preset.listDensity ??
              state.listDensity) as ListDensity,
            listColumns: preset.listColumns
              ? [...preset.listColumns]
              : state.listColumns,
            listSortBy: preset.listSortBy ?? state.listSortBy,
            listSortDir: (preset.listSortDir ?? state.listSortDir) as SortDir,
            listGroupBy: (preset.listGroupBy ?? state.listGroupBy) as GroupBy,
            activePresetId: id,
          };
        }),
      setActivePresetId: (activePresetId) => set({ activePresetId }),
    }),
    {
      name: "task-preferences",
      // v1 (#212): estimat, tid og fremdrift er synlige som standard — også
      // for eksisterende brugere, der aldrig har haft dem slået til.
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as { listColumns?: string[] } | undefined;
        if (version < 1 && state?.listColumns) {
          const missing = TIME_LIST_COLUMNS.filter(
            (c) => !state.listColumns?.includes(c),
          );
          state.listColumns = [...state.listColumns, ...missing];
        }
        return state as TaskPreferencesState;
      },
      partialize: (state) => ({
        viewMode: state.viewMode,
        statsCollapsed: state.statsCollapsed,
        statusFilter: state.statusFilter,
        priorityFilter: state.priorityFilter,
        clientFilter: state.clientFilter,
        lastProjectId: state.lastProjectId,
        lastClientId: state.lastClientId,
        deadlineFilter: state.deadlineFilter,
        projectFilter: state.projectFilter,
        assigneeFilter: state.assigneeFilter,
        doneColumnCollapsed: state.doneColumnCollapsed,
        laneCollapsed: state.laneCollapsed,
        boardSort: state.boardSort,
        listDensity: state.listDensity,
        listColumns: state.listColumns,
        listSortBy: state.listSortBy,
        listSortDir: state.listSortDir,
        listGroupBy: state.listGroupBy,
        filterPresets: state.filterPresets,
        activePresetId: state.activePresetId,
      }),
    },
  ),
);

export type { GroupBy };
