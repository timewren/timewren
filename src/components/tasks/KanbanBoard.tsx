"use client";

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  CheckCircle,
  ChevronRight,
  Clock,
  Edit,
  Play,
  Plus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui";
import { useDebounce } from "@/hooks/useDebounce";
import { useModules } from "@/hooks/useModules";
import { useTaskDeleteUndo } from "@/hooks/useTaskDeleteUndo";
import { useSession } from "@/lib/auth-client";
import {
  BOARD_SORT_LABELS,
  type BoardSort,
  insertAt,
  moveItem,
  sortLaneTasks,
} from "@/lib/kanban/lane-category";
import { parseEstimate } from "@/lib/tasks/time-progress";
import { trpc } from "@/providers/trpc-provider";
import { useTaskPreferencesStore } from "@/stores/taskPreferencesStore";
import { useTimerStore } from "@/stores/timerStore";
import { AddLaneModal } from "./AddLaneModal";
import { CompactTaskRow, type KeyboardMove } from "./CompactTaskRow";
import { DeleteLaneDialog } from "./DeleteLaneDialog";
import { FilterChip } from "./FilterChip";
import { KanbanColumn, type KanbanStatus } from "./KanbanColumn";
import { LaneSettingsDialog } from "./LaneSettingsDialog";
import { PRIORITY_CONFIG } from "./priority-config";
import type { TaskCardData } from "./TaskCard";
import { TaskSidePanel } from "./TaskSidePanel";

interface KanbanBoardProps {
  projectId?: string;
  /**
   * Vis kun dette projekts opgaver i de generelle lanes (projektsiden, #213).
   * Til forskel fra `projectId` skifter den ikke til projekt-scopede lanes;
   * klient-/projektfiltrene skjules, og nye opgaver arver projektet.
   */
  filterProjectId?: string;
  onAddTask?: (status: KanbanStatus) => void;
}

// dnd-kit's skærmlæsertekster på dansk (standarden er engelsk).

export function KanbanBoard({
  projectId,
  filterProjectId,
  onAddTask,
}: KanbanBoardProps) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [activeTask, setActiveTask] = useState<TaskCardData | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] =
    useState<TaskCardData | null>(null);
  const { showUndoToast } = useTaskDeleteUndo();
  const [contextMenu, setContextMenu] = useState<{
    task: TaskCardData;
    x: number;
    y: number;
  } | null>(null);
  const [showStatusSubmenu, setShowStatusSubmenu] = useState(false);
  const [showPrioritySubmenu, setShowPrioritySubmenu] = useState(false);
  const [showAddLaneModal, setShowAddLaneModal] = useState(false);
  const [showLaneSettings, setShowLaneSettings] = useState(false);
  // Indstillingsdialogen lukkes, mens Tilføj/Slet er åben, og vender tilbage.
  const [returnToSettings, setReturnToSettings] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pendingDeleteLaneId, setPendingDeleteLaneId] = useState<string | null>(
    null,
  );
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const {
    startTimerFromTask,
    isRunning,
    taskId: currentTaskId,
  } = useTimerStore();

  const {
    boardSearchQuery,
    setBoardSearchQuery,
    deadlineFilter,
    setDeadlineFilter,
    projectFilter,
    setProjectFilter,
    assigneeFilter,
    setAssigneeFilter,
    clientFilter,
    setClientFilter,
    priorityFilter,
    setPriorityFilter,
    doneColumnCollapsed,
    laneCollapsed,
    setLaneCollapsed,
    boardSort,
    setBoardSort,
  } = useTaskPreferencesStore();

  const [localSearch, setLocalSearch] = useState(boardSearchQuery);
  const debouncedSearch = useDebounce(localSearch, 300);
  useEffect(() => {
    setBoardSearchQuery(debouncedSearch);
  }, [debouncedSearch, setBoardSearchQuery]);

  const [sidePanelTask, setSidePanelTask] = useState<string | null>(null);

  const openSidePanel = useCallback((task: TaskCardData) => {
    setSidePanelTask(task.id);
  }, []);

  const closeSidePanel = useCallback(() => {
    setSidePanelTask(null);
  }, []);

  const utils = trpc.useUtils();

  // Fetch lanes for current context (general or project-scoped)
  const { data: lanes, isLoading: lanesLoading } =
    trpc.taskStatuses.listForContext.useQuery({
      projectId: projectId ?? null,
    });

  // Fetch tasks grouped by statusId (or legacy status for unmigrated rows)
  const listInput = { projectId, filterProjectId };
  const {
    data: rawData,
    isLoading,
    refetch,
  } = trpc.tasks.listByStatus.useQuery(listInput);

  // Fetch projects and clients for filter dropdowns
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: projectsList } = trpc.projects.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("projects"),
  });
  const { data: clientsList } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });
  // Projektboardet: nye opgaver arver projektets klient
  const scopedClientId =
    (
      projectsList?.find((p) => p.id === (projectId || filterProjectId)) as
        | { clientId?: string | null }
        | undefined
    )?.clientId ?? undefined;

  // Assignee lookup for team task cards (resolves assignedToUserId -> member).
  const { data: orgMembers } = trpc.organization.getMembers.useQuery();
  const memberById = new Map((orgMembers ?? []).map((m) => [m.userId, m]));
  const isTeam = (orgMembers?.length ?? 0) > 1;
  const { data: session } = useSession();
  const myUserId = session?.user?.id;
  // A persisted member userId may no longer exist (org switch, member removed);
  // treat it as "all" so a stale choice never hides every task.
  const effectiveAssigneeFilter =
    assigneeFilter === "all" ||
    assigneeFilter === "mine" ||
    assigneeFilter === "_none" ||
    memberById.has(assigneeFilter)
      ? assigneeFilter
      : "all";

  // Normalize Drizzle relation types (T | T[] -> T) and cast to TaskCardData.
  // Keys are laneId (UUID) or legacy status string — see tasks.listByStatus.
  const data: Record<string, TaskCardData[]> | undefined = rawData
    ? Object.fromEntries(
        Object.entries(rawData).map(([key, tasks]) => [
          key,
          tasks.map(
            (task): TaskCardData => ({
              id: task.id,
              title: task.title,
              description: task.description,
              notes: task.notes ?? null,
              status: task.status,
              priority: task.priority,
              deadline: task.deadline,
              estimatedMinutes: task.estimatedMinutes,
              actualMinutes: task.actualMinutes,
              trackedMinutes: task.trackedMinutes,
              aiConfidence: task.aiConfidence,
              aiSuggestedProject: task.aiSuggestedProject,
              project: task.project
                ? ((Array.isArray(task.project)
                    ? task.project[0]
                    : task.project) as { id: string; name: string })
                : null,
              client: task.client
                ? ((Array.isArray(task.client)
                    ? task.client[0]
                    : task.client) as {
                    id: string;
                    name: string;
                    color: string | null;
                  })
                : null,
              subtasks: task.subtasks,
              assignedToUserId: task.assignedToUserId,
              assignee: task.assignedToUserId
                ? (() => {
                    const m = memberById.get(task.assignedToUserId);
                    return m ? { name: m.name, image: m.image } : null;
                  })()
                : null,
            }),
          ),
        ]),
      )
    : undefined;

  // Client-side filtering for search, deadline, client, project filters
  function filterTasks(taskList: TaskCardData[]): TaskCardData[] {
    return taskList.filter((task) => {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const matchesSearch =
          task.title.toLowerCase().includes(q) ||
          task.client?.name.toLowerCase().includes(q) ||
          task.project?.name.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      if (clientFilter !== "all" && !filterProjectId) {
        if (
          clientFilter === "_none"
            ? task.client !== null
            : task.client?.id !== clientFilter
        ) {
          return false;
        }
      }
      if (priorityFilter !== "all" && task.priority !== priorityFilter) {
        return false;
      }
      if (
        !filterProjectId &&
        projectFilter !== "all" &&
        task.project?.id !== projectFilter
      ) {
        return false;
      }
      if (isTeam && effectiveAssigneeFilter !== "all") {
        const matchesAssignee =
          effectiveAssigneeFilter === "mine"
            ? task.assignedToUserId === myUserId
            : effectiveAssigneeFilter === "_none"
              ? !task.assignedToUserId
              : task.assignedToUserId === effectiveAssigneeFilter;
        if (!matchesAssignee) return false;
      }
      if (deadlineFilter !== "all" && task.status !== "done") {
        if (!task.deadline) return false;
        const now = new Date();
        const deadline = new Date(task.deadline);
        const daysUntil = Math.ceil(
          (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (deadlineFilter === "overdue" && daysUntil >= 0) return false;
        if (deadlineFilter === "this_week" && daysUntil > 7) return false;
        if (deadlineFilter === "this_month" && daysUntil > 30) return false;
      }
      return true;
    });
  }

  // Lane reorder mutation (Task 11 — horizontal drag-to-reorder of lanes).
  // Invalidates the lanes query after the server commits the new order.
  const reorderLanesMutation = trpc.taskStatuses.reorder.useMutation({
    onSuccess: () => {
      utils.taskStatuses.listForContext.invalidate({
        projectId: projectId ?? null,
      });
    },
    onError: (error) => {
      toast.error(t("board.reorderLanesFailed"), {
        description: error.message,
      });
      utils.taskStatuses.listForContext.invalidate({
        projectId: projectId ?? null,
      });
    },
  });

  // Flyt kort mellem og inden for kolonner (statusId + gemt rækkefølge).
  // Tavlen opdateres med det samme og hentes igen bagefter.
  const moveMutation = trpc.tasks.move.useMutation({
    onMutate: async ({ taskId, statusId, orderedTaskIds }) => {
      await utils.tasks.listByStatus.cancel(listInput);
      utils.tasks.listByStatus.setData(listInput, (old) => {
        if (!old) return old;
        let moved: (typeof old)[string][number] | undefined;
        const next: typeof old = {};
        for (const [key, list] of Object.entries(old)) {
          next[key] = list.filter((t) => {
            if (t.id !== taskId) return true;
            moved = t;
            return false;
          });
        }
        if (!moved) return old;
        const target = [...(next[statusId] ?? []), moved];
        if (orderedTaskIds) {
          const rank = new Map(orderedTaskIds.map((id, i) => [id, i]));
          target.sort(
            (a, b) =>
              (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
          );
        }
        next[statusId] = target;
        return next;
      });
    },
    onSettled: async () => {
      await refetch();
      setFocusTaskId(null);
      utils.tasks.list.invalidate();
      utils.tasks.getStats.invalidate();
    },
    onError: (error) => {
      toast.error(t("board.moveFailed"), {
        description: error.message,
      });
      refetch(); // Revert to server state
    },
  });

  // Quick complete mutation (used by context menu "Marker som færdig")
  const markDoneMutation = trpc.tasks.markDone.useMutation({
    onSuccess: () => {
      toast.success(t("board.markedDone"));
      refetch();
    },
    onError: (error) => {
      toast.error(t("board.updateFailed"), {
        description: error.message,
      });
    },
  });

  // Delete task mutation — fortryd-toast vises af kalderen via snapshot
  const deleteMutation = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      refetch();
      setContextMenu(null);
    },
    onError: (error) => {
      toast.error(t("board.deleteFailed"), {
        description: error.message,
      });
    },
  });

  // Update task status mutation — routes through tasks.move so the lane
  // UUID (statusId) is the source of truth.
  const updateStatusMutation = trpc.tasks.move.useMutation({
    onSuccess: () => {
      toast.success(t("board.statusUpdated"));
      refetch();
      setContextMenu(null);
    },
    onError: (error) => {
      toast.error(t("board.statusUpdateFailed"), {
        description: error.message,
      });
    },
  });

  // Quick priority update mutation (Phase 3)
  const updatePriorityMutation = trpc.tasks.update.useMutation({
    onSuccess: () => {
      refetch();
      utils.tasks.list.invalidate();
      utils.tasks.getStats.invalidate();
    },
    onError: (error) => {
      toast.error(t("board.priorityUpdateFailed"), {
        description: error.message,
      });
    },
  });

  // Inline add mutation (Phase 2)
  const createMutation = trpc.tasks.create.useMutation({
    onSuccess: () => {
      refetch();
      utils.tasks.list.invalidate();
      utils.tasks.getStats.invalidate();
    },
    onError: (error) => {
      toast.error(t("board.createFailed"), {
        description: error.message,
      });
    },
  });

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
        setShowStatusSubmenu(false);
        setShowPrioritySubmenu(false);
      }
    };

    if (contextMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [contextMenu]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Find task by ID across all columns
  const findTask = (taskId: string): TaskCardData | undefined => {
    if (!data) return undefined;
    for (const key of Object.keys(data)) {
      const task = data[key].find((t) => t.id === taskId);
      if (task) return task;
    }
    return undefined;
  };

  // Find which column (laneId or legacy status key) a task is in
  const findColumn = (taskId: string): string | undefined => {
    if (!data) return undefined;
    for (const key of Object.keys(data)) {
      if (data[key].some((t) => t.id === taskId)) {
        return key;
      }
    }
    return undefined;
  };

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const task = findTask(active.id as string);
    if (task) {
      setActiveTask(task);
    }
  };

  // Handle drag over (for visual feedback)
  const handleDragOver = (_event: DragOverEvent) => {
    // Could be used for optimistic updates
  };

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Lane drag: if the active id matches a lane, this is a horizontal
    // lane reorder. Fire taskStatuses.reorder with the new order and
    // short-circuit before the task-drag logic runs.
    if (lanes?.some((l) => l.id === activeId)) {
      // Projektsiden viser de generelle lanes — rækkefølgen styres dér
      if (filterProjectId) return;
      const oldIndex = lanes.findIndex((l) => l.id === activeId);
      const newIndex = lanes.findIndex((l) => l.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(lanes, oldIndex, newIndex);
      reorderLanesMutation.mutate({
        orderedIds: reordered.map((l) => l.id),
      });
      return;
    }

    if (!data) return;

    const taskId = activeId;
    const sourceColumn = findColumn(taskId);
    if (!sourceColumn) return;

    // Kortet er sluppet på en kolonne (bagerst) eller på et andet kort
    // (dets plads). Rækkefølgen regnes på kolonnens fulde liste, ikke kun
    // de kort, filtrene viser.
    const isLane = (id: string) => lanes?.some((l) => l.id === id) ?? false;
    const targetColumn = isLane(overId) ? overId : findColumn(overId);
    if (!targetColumn || !isLane(targetColumn)) return;

    const targetIds = (data[targetColumn] ?? []).map((t) => t.id);
    let orderedTaskIds: string[];
    if (overId === targetColumn) {
      orderedTaskIds = insertAt(targetIds, taskId, targetIds.length);
    } else if (sourceColumn === targetColumn) {
      const from = targetIds.indexOf(taskId);
      const to = targetIds.indexOf(overId);
      if (from === to) return;
      orderedTaskIds = arrayMove(targetIds, from, to);
    } else {
      orderedTaskIds = insertAt(targetIds, taskId, targetIds.indexOf(overId));
    }

    // Med en anden sortering end Manuel bestemmer sorteringen rækkefølgen;
    // kortet kan stadig flyttes til en anden kolonne.
    if (boardSort !== "manual") {
      if (sourceColumn === targetColumn) {
        toast.info(t("board.manualSortRequired"));
        return;
      }
      moveMutation.mutate({ taskId, statusId: targetColumn });
      return;
    }

    moveMutation.mutate({ taskId, statusId: targetColumn, orderedTaskIds });
  };

  // Alt+piletaster på et fokuseret kort: op/ned i kolonnen (efter de viste
  // kort), venstre/højre øverst i nabokolonnen. Fokus følger kortet.
  const handleKeyboardMove = (task: TaskCardData, move: KeyboardMove) => {
    if (!data || !lanes) return;
    const sourceColumn = findColumn(task.id);
    const laneIndex = orderedLanes.findIndex((l) => l.id === sourceColumn);
    if (!sourceColumn || laneIndex === -1) return;

    if (move === "left" || move === "right") {
      const target = orderedLanes[laneIndex + (move === "left" ? -1 : 1)];
      if (!target) return;
      const ids = (data[target.id] ?? []).map((t) => t.id);
      moveMutation.mutate({
        taskId: task.id,
        statusId: target.id,
        ...(boardSort === "manual"
          ? { orderedTaskIds: insertAt(ids, task.id, 0) }
          : {}),
      });
      setFocusTaskId(task.id);
      setAnnouncement(`${task.title} er flyttet til ${target.name}`);
      return;
    }

    if (boardSort !== "manual") {
      setAnnouncement(t("board.manualSortRequired"));
      return;
    }
    const visible = visibleLaneTasks(sourceColumn);
    const index = visible.findIndex((t) => t.id === task.id);
    const neighbour = visible[index + (move === "up" ? -1 : 1)];
    if (!neighbour) return;
    const ids = (data[sourceColumn] ?? []).map((t) => t.id);
    const orderedTaskIds = arrayMove(
      ids,
      ids.indexOf(task.id),
      ids.indexOf(neighbour.id),
    );
    moveMutation.mutate({
      taskId: task.id,
      statusId: sourceColumn,
      orderedTaskIds,
    });
    setFocusTaskId(task.id);
    setAnnouncement(
      t("board.taskMovedTo", {
        title: task.title,
        position: index + (move === "up" ? 0 : 2),
        total: visible.length,
      }),
    );
  };

  // Kolonnehovedets "Flyt til venstre/højre".
  const handleMoveLane = (laneId: string, delta: -1 | 1) => {
    if (!lanes || filterProjectId) return;
    const index = lanes.findIndex((l) => l.id === laneId);
    const next = moveItem(lanes, index, delta);
    reorderLanesMutation.mutate({ orderedIds: next.map((l) => l.id) });
    setAnnouncement(
      t("board.laneMovedTo", {
        name: lanes[index]?.name ?? "",
        position: index + delta + 1,
        total: lanes.length,
      }),
    );
  };

  // Handle quick complete (context menu)
  const handleQuickComplete = (taskId: string) => {
    markDoneMutation.mutate({ id: taskId });
  };

  // Handle task menu click
  const handleMenuClick = (e: MouseEvent, task: TaskCardData) => {
    e.preventDefault();
    e.stopPropagation();

    // Calculate position - ensure menu stays in viewport
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 300);

    setContextMenu({ task, x, y });
    setShowStatusSubmenu(false);
    setShowPrioritySubmenu(false);
  };

  // Handle start timer from task
  const handleStartTimer = (task: TaskCardData) => {
    // Don't start if this task's timer is already running
    if (isRunning && currentTaskId === task.id) {
      toast.info(t("board.timerAlreadyRunning"));
      setContextMenu(null);
      return;
    }

    if (task.project?.id || task.client?.id) {
      startTimerFromTask({
        id: task.id,
        title: task.title,
        projectId: task.project?.id || null,
        clientId: task.client?.id || null,
      });
      toast.success(t("board.timerStarted", { title: task.title }));
    } else {
      toast.error(t("board.noProjectOrClient"));
    }
    setContextMenu(null);
  };

  // Handle change status (context menu "Skift status" submenu).
  // Moves the task into the selected lane (UUID) via tasks.move.
  const handleChangeStatus = (task: TaskCardData, laneId: string) => {
    const currentColumn = findColumn(task.id);
    if (currentColumn === laneId) {
      setContextMenu(null);
      return;
    }

    updateStatusMutation.mutate({
      taskId: task.id,
      statusId: laneId,
    });
  };

  // Handle delete task
  const handleDeleteTask = (task: TaskCardData) => {
    setDeleteConfirmTask(task);
  };

  // Handle inline add in column. The `laneId` is a UUID from the lanes
  // query — send it as `statusId` so the new task lands in the correct
  // Kanban lane. `status` is still populated (legacy enum) as a safe
  // default during the transition.
  const handleInlineAdd = useCallback(
    (laneId: string, title: string) => {
      // Estimat i titlen ("Design forside ~4t") — samme parser som quick-add
      const estimate = parseEstimate(title);
      const scopedProjectId = projectId || filterProjectId;
      createMutation.mutate({
        title: estimate?.rest || title,
        estimatedMinutes: estimate?.minutes,
        statusId: laneId,
        projectId: scopedProjectId || undefined,
        clientId: scopedProjectId
          ? scopedClientId
          : clientFilter !== "all" && clientFilter !== "_none"
            ? clientFilter
            : undefined,
      });
    },
    [createMutation, projectId, filterProjectId, scopedClientId, clientFilter],
  );

  // Handle delete-lane request from the lane header's ... menu.
  // Opens the DeleteLaneDialog which prompts for a destination lane if
  // the lane has tasks, or performs a direct delete if it's empty.
  const handleDeleteLane = useCallback((laneId: string) => {
    setPendingDeleteLaneId(laneId);
  }, []);

  // Invalidate the lanes query after a lane is renamed / recolored
  // from the LaneHeader inline actions.
  const handleLanesChange = useCallback(() => {
    utils.taskStatuses.listForContext.invalidate({
      projectId: projectId ?? null,
    });
  }, [utils.taskStatuses.listForContext, projectId]);

  const orderedLanes = lanes ?? [];
  const visibleLaneTasks = (laneId: string) =>
    sortLaneTasks(filterTasks(data?.[laneId] ?? []), boardSort);
  const isLaneCollapsed = (lane: { id: string; isArchive: boolean }) =>
    laneCollapsed[lane.id] ?? (lane.isArchive && doneColumnCollapsed);
  const taskCounts = Object.fromEntries(
    orderedLanes.map((l) => [l.id, (data?.[l.id] ?? []).length]),
  );
  const closeLaneSubDialog = () => {
    if (returnToSettings) {
      setReturnToSettings(false);
      setShowLaneSettings(true);
    }
  };

  // Compute props for the DeleteLaneDialog. `pendingLane` is null when no
  // delete is in-flight; otherwise it's the lane the user asked to delete.
  const pendingLane = lanes?.find((l) => l.id === pendingDeleteLaneId) ?? null;
  const tasksInPending = pendingDeleteLaneId
    ? (data?.[pendingDeleteLaneId] ?? []).length
    : 0;
  const otherLanes = (lanes ?? [])
    .filter((l) => l.id !== pendingDeleteLaneId)
    .map((l) => ({ id: l.id, name: l.name }));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: t("board.dndInstructions") },
      }}
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={t("board.searchPlaceholder")}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 py-1.5 pl-8 pr-3 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          />
        </div>
        <FilterChip
          label={t("filters.priority")}
          value={priorityFilter}
          options={[
            { value: "all", label: t("filters.all") },
            { value: "urgent", label: t("priority.urgent") },
            { value: "high", label: t("priority.high") },
            { value: "medium", label: t("priority.medium") },
            { value: "low", label: t("priority.low") },
          ]}
          activeColor="bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
          onChange={(v) =>
            setPriorityFilter(v as "all" | "low" | "medium" | "high" | "urgent")
          }
        />
        {!filterProjectId && (
          <FilterChip
            label={t("filters.client")}
            value={clientFilter}
            options={[
              { value: "all", label: t("filters.allClients") },
              ...((
                clientsList as
                  | { id: string; name: string; isArchived?: boolean }[]
                  | undefined
              )
                ?.filter((c) => !c.isArchived)
                .map((c) => ({ value: c.id, label: c.name })) ?? []),
            ]}
            activeColor="bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
            onChange={setClientFilter}
          />
        )}
        <FilterChip
          label={t("filters.deadline")}
          value={deadlineFilter}
          options={[
            { value: "all", label: t("filters.all") },
            { value: "overdue", label: t("filters.overdue") },
            { value: "this_week", label: t("filters.thisWeek") },
            { value: "this_month", label: t("filters.thisMonth") },
          ]}
          activeColor="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
          onChange={(v) =>
            setDeadlineFilter(
              v as "all" | "overdue" | "this_week" | "this_month",
            )
          }
        />
        {!filterProjectId && (
          <FilterChip
            label={t("filters.project")}
            value={projectFilter}
            options={[
              { value: "all", label: t("filters.allProjects") },
              ...(projectsList?.map((p: { id: string; name: string }) => ({
                value: p.id,
                label: p.name,
              })) ?? []),
            ]}
            activeColor="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
            onChange={setProjectFilter}
          />
        )}
        {isTeam && (
          <FilterChip
            label={t("filters.assignee")}
            value={effectiveAssigneeFilter}
            options={[
              { value: "all", label: t("filters.all") },
              { value: "mine", label: t("filters.mine") },
              { value: "_none", label: t("filters.unassigned") },
              ...(orgMembers ?? []).map((m) => ({
                value: m.userId,
                label: m.name,
              })),
            ]}
            activeColor="bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
            onChange={setAssigneeFilter}
          />
        )}
        <FilterChip
          label={t("board.sort")}
          value={boardSort === "manual" ? "all" : boardSort}
          options={(Object.keys(BOARD_SORT_LABELS) as BoardSort[]).map(
            (key) => ({
              value: key === "manual" ? "all" : key,
              label: t("board.sortBy", { sort: t(`boardSort.${key}`) }),
            }),
          )}
          activeColor="bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
          onChange={(v) =>
            setBoardSort(v === "all" ? "manual" : (v as BoardSort))
          }
        />
        {!filterProjectId && (
          <button
            type="button"
            onClick={() => setShowLaneSettings(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t("laneHeader.customize")}
          </button>
        )}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {lanesLoading && orderedLanes.length === 0 ? (
          // Render 4 skeleton columns while lanes load
          ["s1", "s2", "s3", "s4"].map((k) => (
            <KanbanColumn
              key={k}
              laneId={k}
              laneName=""
              laneColor="#9ca3af"
              isArchive={false}
              tasks={[]}
              isLoading
            />
          ))
        ) : orderedLanes.length === 0 ? (
          <div className="w-full py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {t("board.noLanes")}
          </div>
        ) : (
          <SortableContext
            items={orderedLanes.map((l) => l.id)}
            strategy={horizontalListSortingStrategy}
          >
            {orderedLanes.map((lane, index) => (
              <KanbanColumn
                key={lane.id}
                laneId={lane.id}
                laneName={lane.name}
                laneColor={lane.color}
                laneCategory={lane.category}
                isArchive={lane.isArchive}
                isCollapsed={isLaneCollapsed(lane)}
                onToggleCollapse={() =>
                  setLaneCollapsed(lane.id, !isLaneCollapsed(lane))
                }
                tasks={visibleLaneTasks(lane.id)}
                isLoading={isLoading || lanesLoading}
                onTaskClick={openSidePanel}
                onTaskContextMenu={handleMenuClick}
                onAddTask={
                  onAddTask
                    ? (laneId) => onAddTask(laneId as unknown as KanbanStatus)
                    : undefined
                }
                onInlineAdd={handleInlineAdd}
                // Lanes deles med det generelle board — de styres dér, ikke
                // fra projektsiden
                onDeleteLane={filterProjectId ? undefined : handleDeleteLane}
                onLanesChange={filterProjectId ? undefined : handleLanesChange}
                onMoveLane={filterProjectId ? undefined : handleMoveLane}
                canMoveLeft={index > 0}
                canMoveRight={index < orderedLanes.length - 1}
                onOpenSettings={
                  filterProjectId ? undefined : () => setShowLaneSettings(true)
                }
                onTaskKeyboardMove={handleKeyboardMove}
                focusTaskId={focusTaskId}
              />
            ))}
          </SortableContext>
        )}
        {!lanesLoading && !filterProjectId && (
          <button
            type="button"
            onClick={() => setShowAddLaneModal(true)}
            className="flex w-48 shrink-0 items-center justify-center gap-2 self-start rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-sm font-medium text-gray-500 hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-500 dark:hover:text-brand-400"
          >
            <Plus className="h-4 w-4" />
            {t("board.addLane")}
          </button>
        )}
      </div>

      {/* Drag overlay - shows the task being dragged */}
      <DragOverlay>
        {activeTask ? (
          <div className="w-72 bg-white dark:bg-gray-800 rounded-lg shadow-lg ring-2 ring-brand-500 ring-opacity-50">
            <CompactTaskRow task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-40 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            top: contextMenu.y,
          }}
        >
          {/* Rediger: sidepanelet retter alle felter, også egne statusser */}
          <button
            type="button"
            onClick={() => {
              openSidePanel(contextMenu.task);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Edit className="h-4 w-4" />
            {t("board.editTask")}
          </button>

          {/* Start timer */}
          {(contextMenu.task.project?.id || contextMenu.task.client?.id) && (
            <button
              type="button"
              onClick={() => handleStartTimer(contextMenu.task)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <Play className="h-4 w-4" />
              {t("board.startTimer")}
            </button>
          )}

          {/* Divider */}
          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

          {/* Change status - submenu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowStatusSubmenu(!showStatusSubmenu)}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {t("board.changeStatus")}
              </span>
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Status submenu — every lane is clickable (routes through
                tasks.move with the lane UUID). */}
            {showStatusSubmenu && (
              <div className="absolute right-0 sm:right-auto sm:left-full top-full sm:top-0 ml-0 sm:ml-1 min-w-40 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                {orderedLanes.map((lane) => {
                  const isCurrentStatus =
                    findColumn(contextMenu.task.id) === lane.id;
                  return (
                    <button
                      key={lane.id}
                      type="button"
                      onClick={() => {
                        handleChangeStatus(contextMenu.task, lane.id);
                      }}
                      disabled={isCurrentStatus}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm ${
                        isCurrentStatus
                          ? "cursor-not-allowed text-gray-400 dark:text-gray-500"
                          : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      }`}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: lane.color }}
                      />
                      {lane.name}
                      {isCurrentStatus && (
                        <CheckCircle className="ml-auto h-4 w-4 text-green-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Priority submenu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPrioritySubmenu(!showPrioritySubmenu)}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <span className="flex items-center gap-2">
                {t("board.priority")}
              </span>
              <ChevronRight className="h-4 w-4" />
            </button>
            {showPrioritySubmenu && (
              <div className="absolute right-0 sm:right-auto sm:left-full top-full sm:top-0 ml-0 sm:ml-1 min-w-32 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                {(["urgent", "high", "medium", "low"] as const).map((p) => {
                  const cfg = PRIORITY_CONFIG[p];
                  const isCurrent = contextMenu.task.priority === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={isCurrent}
                      onClick={() => {
                        updatePriorityMutation.mutate({
                          id: contextMenu.task.id,
                          priority: p,
                        });
                        setContextMenu(null);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm ${
                        isCurrent
                          ? "cursor-not-allowed text-gray-400"
                          : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      }`}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: cfg.color }}
                      />
                      {t(`priority.${p}`)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick complete */}
          {contextMenu.task.status !== "done" && (
            <button
              type="button"
              onClick={() => {
                handleQuickComplete(contextMenu.task.id);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-green-600 hover:bg-gray-100 dark:text-green-400 dark:hover:bg-gray-700"
            >
              <CheckCircle className="h-4 w-4" />
              {t("board.markDone")}
            </button>
          )}

          {/* Divider */}
          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

          {/* Delete task */}
          <button
            type="button"
            onClick={() => handleDeleteTask(contextMenu.task)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-4 w-4" />
            {t("board.deleteTask")}
          </button>
        </div>
      )}
      <ConfirmDialog
        isOpen={!!deleteConfirmTask}
        onClose={() => setDeleteConfirmTask(null)}
        onConfirm={() => {
          if (deleteConfirmTask) {
            const snapshot = {
              title: deleteConfirmTask.title,
              description: deleteConfirmTask.description,
              projectId: deleteConfirmTask.project?.id,
              clientId: deleteConfirmTask.client?.id,
              status: deleteConfirmTask.status,
              priority: deleteConfirmTask.priority,
              deadline: deleteConfirmTask.deadline,
              estimatedMinutes: deleteConfirmTask.estimatedMinutes,
            };
            deleteMutation.mutate(
              { id: deleteConfirmTask.id },
              { onSuccess: () => showUndoToast(snapshot) },
            );
            setDeleteConfirmTask(null);
          }
        }}
        title={t("board.deleteTask")}
        description={t("board.deleteConfirm", {
          title: deleteConfirmTask?.title ?? "",
        })}
        confirmLabel={tc("delete")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
      <AddLaneModal
        projectId={projectId ?? null}
        isOpen={showAddLaneModal}
        onClose={() => {
          setShowAddLaneModal(false);
          closeLaneSubDialog();
        }}
        onSuccess={() =>
          utils.taskStatuses.listForContext.invalidate({
            projectId: projectId ?? null,
          })
        }
      />
      {pendingLane && (
        <DeleteLaneDialog
          laneId={pendingLane.id}
          laneName={pendingLane.name}
          taskCount={tasksInPending}
          otherLanes={otherLanes}
          isOpen={true}
          onClose={() => {
            setPendingDeleteLaneId(null);
            closeLaneSubDialog();
          }}
          onSuccess={() => {
            setPendingDeleteLaneId(null);
            utils.taskStatuses.listForContext.invalidate({
              projectId: projectId ?? null,
            });
            utils.tasks.listByStatus.invalidate();
          }}
        />
      )}
      <LaneSettingsDialog
        lanes={orderedLanes}
        taskCounts={taskCounts}
        isOpen={showLaneSettings}
        onClose={() => setShowLaneSettings(false)}
        onChanged={() => {
          handleLanesChange();
          refetch();
        }}
        onAddRequest={() => {
          setShowLaneSettings(false);
          setReturnToSettings(true);
          setShowAddLaneModal(true);
        }}
        onDeleteRequest={(laneId) => {
          setShowLaneSettings(false);
          setReturnToSettings(true);
          setPendingDeleteLaneId(laneId);
        }}
      />
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <TaskSidePanel taskId={sidePanelTask} onClose={closeSidePanel} />
    </DndContext>
  );
}
