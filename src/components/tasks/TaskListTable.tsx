"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import { useTaskPreferencesStore } from "@/stores/taskPreferencesStore";
import { PRIORITY_CONFIG, type PriorityKey } from "./priority-config";
import { TaskTimeProgressCell } from "./TaskTimeProgress";

export interface TaskForList {
  id: string;
  title: string;
  description: string | null;
  status: string;
  statusId?: string | null;
  priority: string | null;
  deadline: Date | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  /** Sum af tidsregistreringer på opgaven (tasks.list, #212). */
  trackedMinutes?: number;
  project: { id: string; name: string } | null;
  client: { id: string; name: string; color: string | null } | null;
  subtasks?: { id: string; title: string; status: string }[];
  sourceType?: string | null;
  createdAt?: Date | string | null;
}

interface TaskListTableProps {
  tasks: TaskForList[];
  isLoading?: boolean;
  onTaskClick: (task: TaskForList) => void;
  onContextMenu: (e: React.MouseEvent, task: TaskForList) => void;
  selectedTasks: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onMarkDone?: (taskId: string) => void;
  onEditTask?: (task: TaskForList) => void;
  onUpdateTask?: (
    taskId: string,
    updates: {
      status?: "backlog" | "todo" | "in_progress" | "done";
      priority?: "low" | "medium" | "high" | "urgent";
      deadline?: Date | null;
    },
  ) => void;
}

type TasksT = ReturnType<typeof useTranslations<"tasks">>;

const COLUMN_DEFS: {
  key: string;
  width: string;
  sortable: boolean;
}[] = [
  { key: "status", width: "w-20", sortable: true },
  { key: "priority", width: "w-24", sortable: true },
  { key: "client", width: "w-24", sortable: true },
  { key: "project", width: "w-24", sortable: true },
  { key: "deadline", width: "w-20", sortable: true },
  { key: "estimate", width: "w-16", sortable: true },
  { key: "actualTime", width: "w-16", sortable: true },
  { key: "progress", width: "w-24", sortable: true },
  { key: "subtasks", width: "w-16", sortable: false },
  { key: "source", width: "w-16", sortable: false },
  { key: "createdAt", width: "w-20", sortable: true },
];

const WIDTH_MAP: Record<string, string> = {
  "16": "64px",
  "20": "80px",
  "24": "96px",
};

/** Registreret tid: summen fra tasks.list, ellers den denormaliserede kolonne. */
function trackedOf(task: TaskForList): number {
  return task.trackedMinutes ?? task.actualMinutes ?? 0;
}

/** Fremdrift som brøk til sortering; opgaver uden estimat sidst (-1). */
function progressOf(task: TaskForList): number {
  return task.estimatedMinutes ? trackedOf(task) / task.estimatedMinutes : -1;
}

function formatMinutes(mins: number, t: TasksT) {
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  const h = t("timeUnits.hour");
  const m = t("timeUnits.minute");
  if (hours > 0) return `${hours}${h}${rest > 0 ? ` ${rest}${m}` : ""}`;
  return `${rest}${m}`;
}

function statusLabel(status: string, t: TasksT): string {
  return t.has(`status.${status}`) ? t(`status.${status}`) : status;
}

const STATUS_COLORS: Record<string, string> = {
  backlog: "text-gray-500",
  todo: "text-blue-600",
  in_progress: "text-amber-600",
  done: "text-green-600",
};

const STATUS_ORDER = ["backlog", "todo", "in_progress", "done"];
const PRIORITY_ORDER = ["low", "medium", "high", "urgent"];

function getDeadlineDisplay(
  task: TaskForList,
  t: TasksT,
  locale: string,
): React.ReactNode {
  if (!task.deadline)
    return (
      <span className="text-[11px] text-gray-300 dark:text-gray-600">–</span>
    );
  const d = new Date(task.deadline);
  const now = new Date();
  const daysUntil = Math.ceil(
    (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (task.status === "done")
    return (
      <span className="text-[11px] text-gray-400">
        {d.toLocaleDateString(toIntlLocale(locale), {
          day: "numeric",
          month: "short",
        })}
      </span>
    );
  if (daysUntil < 0)
    return (
      <span className="text-[11px] font-medium text-red-600">
        {t("deadline.overdue")}
      </span>
    );
  if (daysUntil === 0)
    return (
      <span className="text-[11px] font-medium text-red-600">
        {t("deadline.today")}
      </span>
    );
  if (daysUntil <= 3)
    return (
      <span className="text-[11px] font-medium text-amber-600">
        {t("deadline.inDays", { count: daysUntil })}
      </span>
    );
  return (
    <span className="text-[11px] text-gray-500">
      {d.toLocaleDateString(toIntlLocale(locale), {
        day: "numeric",
        month: "short",
      })}
    </span>
  );
}

function DeadlineCell({
  task,
  onUpdate,
}: {
  task: TaskForList;
  onUpdate: (date: Date | null) => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const d = task.deadline ? new Date(task.deadline) : null;
  const currentValue = d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : "";

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        defaultValue={currentValue}
        // biome-ignore lint/a11y/noAutofocus: feltet vises som følge af brugerens handling (inline-redigering/dialog), så fokus flytter forventeligt
        autoFocus
        className="w-28 text-[11px] border border-brand-300 rounded px-1 py-0.5 bg-white dark:bg-gray-700 dark:border-brand-600 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
        onChange={(e) => {
          const val = e.target.value;
          onUpdate(val ? new Date(`${val}T12:00:00`) : null);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
        setTimeout(() => inputRef.current?.showPicker?.(), 0);
      }}
      className="cursor-pointer hover:opacity-70 transition-opacity"
      title={t("list.changeDeadline")}
    >
      {getDeadlineDisplay(task, t, locale)}
    </button>
  );
}

type TaskUpdates = {
  status?: "backlog" | "todo" | "in_progress" | "done";
  priority?: "low" | "medium" | "high" | "urgent";
  deadline?: Date | null;
};

function renderCell(
  task: TaskForList,
  columnKey: string,
  onUpdateTask: ((taskId: string, updates: TaskUpdates) => void) | undefined,
  t: TasksT,
  locale: string,
): React.ReactNode {
  switch (columnKey) {
    case "status": {
      if (onUpdateTask) {
        const currentIdx = STATUS_ORDER.indexOf(task.status);
        const nextStatus = STATUS_ORDER[
          (currentIdx + 1) % STATUS_ORDER.length
        ] as TaskUpdates["status"];
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateTask(task.id, { status: nextStatus });
            }}
            className={`text-[11px] cursor-pointer hover:opacity-70 transition-opacity ${STATUS_COLORS[task.status] ?? "text-gray-500"}`}
            title={t("list.changeStatus")}
          >
            {statusLabel(task.status, t)}
          </button>
        );
      }
      return (
        <span
          className={`text-[11px] ${STATUS_COLORS[task.status] ?? "text-gray-500"}`}
        >
          {statusLabel(task.status, t)}
        </span>
      );
    }
    case "priority": {
      const currentPriority = task.priority || "medium";
      const p =
        PRIORITY_CONFIG[currentPriority as PriorityKey] ||
        PRIORITY_CONFIG.medium;
      const priorityKey: PriorityKey =
        currentPriority in PRIORITY_CONFIG
          ? (currentPriority as PriorityKey)
          : "medium";
      if (onUpdateTask) {
        const currentIdx = PRIORITY_ORDER.indexOf(currentPriority);
        const nextPriority = PRIORITY_ORDER[
          (currentIdx + 1) % PRIORITY_ORDER.length
        ] as TaskUpdates["priority"];
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateTask(task.id, { priority: nextPriority });
            }}
            className="flex items-center gap-1 cursor-pointer hover:opacity-70 transition-opacity"
            title={t("list.changePriority")}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-[11px] text-gray-600 dark:text-gray-400">
              {t(`priority.${priorityKey}`)}
            </span>
          </button>
        );
      }
      return (
        <span className="flex items-center gap-1">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-[11px] text-gray-600 dark:text-gray-400">
            {t(`priority.${priorityKey}`)}
          </span>
        </span>
      );
    }
    case "client":
      return task.client ? (
        <span
          className="text-[11px] truncate inline-flex items-center gap-1"
          style={task.client.color ? { color: task.client.color } : undefined}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: task.client.color || "#9ca3af" }}
          />
          {task.client.name}
        </span>
      ) : (
        <span className="text-[11px] text-gray-300 dark:text-gray-600">–</span>
      );
    case "project":
      return task.project ? (
        <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate">
          {task.project.name}
        </span>
      ) : (
        <span className="text-[11px] text-gray-300 dark:text-gray-600">–</span>
      );
    case "deadline": {
      if (onUpdateTask) {
        return (
          <DeadlineCell
            task={task}
            onUpdate={(date) => onUpdateTask(task.id, { deadline: date })}
          />
        );
      }
      return getDeadlineDisplay(task, t, locale);
    }
    case "estimate":
      return task.estimatedMinutes ? (
        <span className="text-[11px] text-gray-500">
          {formatMinutes(task.estimatedMinutes, t)}
        </span>
      ) : (
        <span className="text-[11px] text-gray-300 dark:text-gray-600">–</span>
      );
    case "actualTime": {
      const tracked = trackedOf(task);
      return tracked ? (
        <span className="text-[11px] text-gray-500">
          {formatMinutes(tracked, t)}
        </span>
      ) : (
        <span className="text-[11px] text-gray-300 dark:text-gray-600">–</span>
      );
    }
    case "progress":
      return (
        <TaskTimeProgressCell
          trackedMinutes={trackedOf(task)}
          estimatedMinutes={task.estimatedMinutes}
        />
      );
    case "subtasks": {
      if (!task.subtasks?.length) return null;
      const done = task.subtasks.filter((s) => s.status === "done").length;
      return (
        <span className="text-[11px] text-gray-500">
          {done}/{task.subtasks.length}
        </span>
      );
    }
    case "source":
      if (task.sourceType === "email")
        return (
          <span className="text-[10px] bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded">
            {t("list.emailSource")}
          </span>
        );
      return null;
    case "createdAt": {
      if (!task.createdAt)
        return <span className="text-[11px] text-gray-300">–</span>;
      return (
        <span className="text-[11px] text-gray-500">
          {new Date(task.createdAt).toLocaleDateString(toIntlLocale(locale), {
            day: "numeric",
            month: "short",
          })}
        </span>
      );
    }
    default:
      return null;
  }
}

function getColumnPixelWidth(widthClass: string): string {
  const size = widthClass.replace("w-", "");
  return WIDTH_MAP[size] || "80px";
}

function SortableColumnHeader({
  columnKey,
  label,
  sortable,
  isActive,
  sortDir,
  onSort,
}: {
  columnKey: string;
  label: string;
  sortable: boolean;
  isActive: boolean;
  sortDir: string;
  onSort: () => void;
}) {
  const t = useTranslations("tasks");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: columnKey });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: wrapper stopper kun bobling af klik, den er ikke selv et kontrolelement
    // biome-ignore lint/a11y/useKeyWithClickEvents: wrapper stopper kun bobling af klik, den er ikke selv et kontrolelement
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (sortable && !isDragging) {
          e.stopPropagation();
          onSort();
        }
      }}
      className={`
        flex items-center gap-1 text-left truncate text-[11px] font-medium select-none
        ${sortable ? "cursor-grab active:cursor-grabbing" : "cursor-default"}
        ${isActive ? "text-gray-700 dark:text-gray-300" : "text-gray-500 dark:text-gray-400"}
        hover:text-gray-700 dark:hover:text-gray-300 transition-colors
      `}
      title={sortable ? t("list.sortHint") : t("list.dragHint")}
    >
      {label}
      {sortable &&
        (isActive ? (
          sortDir === "asc" ? (
            <ArrowUp className="w-3 h-3 shrink-0" />
          ) : (
            <ArrowDown className="w-3 h-3 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30 shrink-0" />
        ))}
    </div>
  );
}

function buildGridTemplate(
  visibleColumns: { key: string; width: string }[],
): string {
  const colWidths = visibleColumns
    .map((c) => getColumnPixelWidth(c.width))
    .join(" ");
  return `28px 1fr ${colWidths}`;
}

export function TaskListTable({
  tasks,
  isLoading,
  onTaskClick,
  onContextMenu,
  selectedTasks,
  onSelectionChange,
  onMarkDone,
  onEditTask,
  onUpdateTask,
}: TaskListTableProps) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const {
    listDensity,
    listColumns,
    listSortBy,
    listSortDir,
    setListSortBy,
    setListSortDir,
    setListColumns,
    listGroupBy,
  } = useTaskPreferencesStore();

  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const visibleColumns = useMemo(() => {
    return listColumns
      .map((key) => COLUMN_DEFS.find((c) => c.key === key))
      .filter((c): c is (typeof COLUMN_DEFS)[number] => c !== undefined);
  }, [listColumns]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleColumnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = listColumns.indexOf(active.id as string);
    const newIndex = listColumns.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    setListColumns(arrayMove(listColumns, oldIndex, newIndex));
  };

  const sortedTasks = useMemo(() => {
    const sorted = [...tasks];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (listSortBy) {
        case "priority": {
          const order: Record<string, number> = {
            urgent: 0,
            high: 1,
            medium: 2,
            low: 3,
          };
          comparison =
            (order[a.priority ?? "medium"] ?? 2) -
            (order[b.priority ?? "medium"] ?? 2);
          break;
        }
        case "status": {
          const order: Record<string, number> = {
            in_progress: 0,
            todo: 1,
            backlog: 2,
            done: 3,
          };
          comparison = (order[a.status] ?? 2) - (order[b.status] ?? 2);
          break;
        }
        case "deadline": {
          if (!a.deadline && !b.deadline) comparison = 0;
          else if (!a.deadline) comparison = 1;
          else if (!b.deadline) comparison = -1;
          else
            comparison =
              new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
          break;
        }
        case "client":
          comparison = (a.client?.name ?? "").localeCompare(
            b.client?.name ?? "",
          );
          break;
        case "project":
          comparison = (a.project?.name ?? "").localeCompare(
            b.project?.name ?? "",
          );
          break;
        case "estimate":
          comparison = (a.estimatedMinutes ?? 0) - (b.estimatedMinutes ?? 0);
          break;
        case "actualTime":
          comparison = trackedOf(a) - trackedOf(b);
          break;
        case "progress":
          comparison = progressOf(a) - progressOf(b);
          break;
        case "createdAt": {
          const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          comparison = aDate - bDate;
          break;
        }
        default:
          comparison = a.title.localeCompare(b.title);
      }
      return listSortDir === "desc" ? -comparison : comparison;
    });
    return sorted;
  }, [tasks, listSortBy, listSortDir]);

  // Grouping logic
  interface TaskGroup {
    key: string;
    label: string;
    tasks: TaskForList[];
  }

  const groups: TaskGroup[] = useMemo(() => {
    if (listGroupBy === "none") {
      return [{ key: "_all", label: "", tasks: sortedTasks }];
    }

    const map = new Map<string, TaskForList[]>();
    const labelMap = new Map<string, string>();

    for (const task of sortedTasks) {
      let key: string;
      let label: string;

      switch (listGroupBy) {
        case "client":
          key = task.client?.id ?? "_none";
          label = task.client?.name ?? t("taskForm.noClient");
          break;
        case "project":
          key = task.project?.id ?? "_none";
          label = task.project?.name ?? t("taskForm.noProject");
          break;
        case "priority": {
          const p = task.priority || "medium";
          key = p;
          label = p in PRIORITY_CONFIG ? t(`priority.${p as PriorityKey}`) : p;
          break;
        }
        case "status":
          key = task.status;
          label = statusLabel(task.status, t);
          break;
        default:
          key = "_all";
          label = "";
      }

      const bucket = map.get(key);
      if (bucket) bucket.push(task);
      else map.set(key, [task]);
      labelMap.set(key, label);
    }

    return Array.from(map.entries()).map(([key, tasks]) => ({
      key,
      label: labelMap.get(key) ?? key,
      tasks,
    }));
  }, [sortedTasks, listGroupBy, t]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const flatVisibleTasks = useMemo(() => {
    return groups.flatMap((g) => (collapsedGroups.has(g.key) ? [] : g.tasks));
  }, [groups, collapsedGroups]);

  const handleSort = (columnKey: string) => {
    if (listSortBy === columnKey) {
      setListSortDir(listSortDir === "asc" ? "desc" : "asc");
    } else {
      setListSortBy(columnKey);
      setListSortDir("asc");
    }
  };

  const allSelected =
    flatVisibleTasks.length > 0 &&
    selectedTasks.size === flatVisibleTasks.length;

  const handleSelectAll = () => {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(flatVisibleTasks.map((t) => t.id)));
    }
  };

  const toggleTask = (id: string) => {
    const next = new Set(selectedTasks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const gridTemplate = buildGridTemplate(visibleColumns);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Also skip if inside a contenteditable element
      if ((e.target as HTMLElement).isContentEditable) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, flatVisibleTasks.length - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          if (focusedIndex >= 0 && focusedIndex < flatVisibleTasks.length) {
            onTaskClick(flatVisibleTasks[focusedIndex]);
          }
          break;
        case "e":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < flatVisibleTasks.length) {
            onEditTask?.(flatVisibleTasks[focusedIndex]);
          }
          break;
        case "x":
          if (focusedIndex >= 0 && focusedIndex < flatVisibleTasks.length) {
            const task = flatVisibleTasks[focusedIndex];
            const next = new Set(selectedTasks);
            if (next.has(task.id)) next.delete(task.id);
            else next.add(task.id);
            onSelectionChange(next);
          }
          break;
        case "d":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < flatVisibleTasks.length) {
            const task = flatVisibleTasks[focusedIndex];
            if (task.status !== "done") {
              onMarkDone?.(task.id);
            }
          }
          break;
        case "Escape":
          setFocusedIndex(-1);
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    focusedIndex,
    flatVisibleTasks,
    onTaskClick,
    onEditTask,
    selectedTasks,
    onSelectionChange,
    onMarkDone,
  ]);

  // Scroll focused row into view
  useEffect(() => {
    if (focusedIndex < 0) return;
    const row = document.querySelector(`[data-task-index="${focusedIndex}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIndex]);

  // Reset focused index when tasks change
  useEffect(() => {
    setFocusedIndex((i) => {
      if (i >= flatVisibleTasks.length) return flatVisibleTasks.length - 1;
      return i;
    });
  }, [flatVisibleTasks.length]);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
            key={`skeleton-${i}`}
            className={`grid items-center gap-2 px-3 border-b border-gray-100 dark:border-gray-800 ${
              listDensity === "compact"
                ? "py-1"
                : listDensity === "detailed"
                  ? "py-2.5"
                  : "py-2"
            }`}
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="h-3.5 w-3.5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="space-y-1">
              <div className="h-3.5 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              {listDensity !== "compact" && (
                <div className="h-2.5 w-1/2 rounded bg-gray-100 dark:bg-gray-700/50 animate-pulse" />
              )}
            </div>
            {visibleColumns.map((col) => (
              <div
                key={col.key}
                className="h-3 w-2/3 rounded bg-gray-100 dark:bg-gray-700/50 animate-pulse"
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="flex items-center justify-center py-16 text-sm text-gray-400 dark:text-gray-500">
          {t("list.empty")}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header — hidden on mobile */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleColumnDragEnd}
      >
        <SortableContext
          items={visibleColumns.map((c) => c.key)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            className="hidden sm:grid items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 text-[11px] font-medium text-gray-500 dark:text-gray-400 select-none"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={handleSelectAll}
              className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={() => handleSort("title")}
              className="flex items-center gap-1 text-left hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              {t("listColumns.title")}
              {listSortBy === "title" ? (
                listSortDir === "asc" ? (
                  <ArrowUp className="w-3 h-3" />
                ) : (
                  <ArrowDown className="w-3 h-3" />
                )
              ) : (
                <ArrowUpDown className="w-3 h-3 opacity-30" />
              )}
            </button>
            {visibleColumns.map((col) => (
              <SortableColumnHeader
                key={col.key}
                columnKey={col.key}
                label={t(`listColumns.${col.key}`)}
                sortable={col.sortable}
                isActive={listSortBy === col.key}
                sortDir={listSortDir}
                onSort={() => handleSort(col.key)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Rows (grouped) */}
      {(() => {
        let globalIndex = 0;
        return groups.map((group) => (
          <div key={group.key}>
            {/* Group header (only if grouping is active) */}
            {listGroupBy !== "none" && (
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="flex items-center gap-2 w-full px-3 py-2 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50"
              >
                <ChevronRight
                  className={`h-3 w-3 transition-transform ${collapsedGroups.has(group.key) ? "" : "rotate-90"}`}
                />
                {listGroupBy === "priority" && (
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor:
                        PRIORITY_CONFIG[group.key as PriorityKey]?.color ??
                        "#d1d5db",
                    }}
                  />
                )}
                {group.label}
                <span className="text-gray-400 font-normal ml-1">
                  {group.tasks.length}
                </span>
              </button>
            )}
            {/* Group tasks (hidden if collapsed) */}
            {!collapsedGroups.has(group.key) &&
              group.tasks.map((task) => {
                const flatIndex = globalIndex++;
                return (
                  <div key={task.id}>
                    {/* Desktop row */}
                    {/* biome-ignore lint/a11y/useSemanticElements: indholdet er blokelementer (div'er), som ikke må ligge i en button */}
                    <div
                      role="button"
                      tabIndex={0}
                      data-task-index={flatIndex}
                      onClick={() => {
                        setFocusedIndex(flatIndex);
                        onTaskClick(task);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setFocusedIndex(flatIndex);
                        onContextMenu(e, task);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onTaskClick(task);
                        }
                      }}
                      className={`
                      hidden sm:grid group items-center gap-2 px-3 border-b border-gray-100 dark:border-gray-800 cursor-pointer
                      hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-l-[3px]
                      ${listDensity === "compact" ? "py-1" : listDensity === "detailed" ? "py-2.5" : "py-2"}
                      ${task.status === "done" ? "opacity-60" : ""}
                      ${flatIndex === focusedIndex ? "ring-2 ring-brand-500 ring-inset bg-brand-50/50 dark:bg-tt-gran-lys" : ""}
                    `}
                      style={{
                        gridTemplateColumns: gridTemplate,
                        borderLeftColor: task.client?.color || "transparent",
                        ...(task.client?.color
                          ? { backgroundColor: `${task.client.color}10` }
                          : {}),
                      }}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={selectedTasks.has(task.id)}
                        onChange={() => toggleTask(task.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                      />
                      {/* Title cell */}
                      <div className="min-w-0">
                        <span
                          className={`
                          block truncate
                          ${listDensity === "compact" ? "text-xs font-semibold" : "text-sm font-semibold"}
                          ${task.status === "done" ? "line-through text-gray-500" : "text-gray-900 dark:text-gray-100"}
                        `}
                        >
                          {task.title}
                        </span>
                        {listDensity !== "compact" && task.description && (
                          <span className="block text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                            {task.description}
                          </span>
                        )}
                        {listDensity === "detailed" && (
                          <div className="flex gap-1.5 mt-1 empty:hidden">
                            {task.subtasks && task.subtasks.length > 0 && (
                              <span className="text-[9px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded">
                                {
                                  task.subtasks.filter(
                                    (s) => s.status === "done",
                                  ).length
                                }
                                /{task.subtasks.length}
                              </span>
                            )}
                            {task.sourceType === "email" && (
                              <span className="text-[9px] bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded">
                                {t("list.emailSource")}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Data columns */}
                      {visibleColumns.map((col) => (
                        <div key={col.key} className="min-w-0 truncate">
                          {renderCell(task, col.key, onUpdateTask, t, locale)}
                        </div>
                      ))}
                    </div>

                    {/* Mobile row — simplified stacked layout */}
                    {/* biome-ignore lint/a11y/useSemanticElements: indholdet er blokelementer (div'er), som ikke må ligge i en button */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onTaskClick(task)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onContextMenu(e, task);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onTaskClick(task);
                        }
                      }}
                      className={`
                      sm:hidden flex items-start gap-2 px-3 border-b border-gray-100 dark:border-gray-800 cursor-pointer
                      hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-l-[3px]
                      ${listDensity === "compact" ? "py-1.5" : "py-2.5"}
                      ${task.status === "done" ? "opacity-60" : ""}
                    `}
                      style={{
                        borderLeftColor: task.client?.color || "transparent",
                        ...(task.client?.color
                          ? { backgroundColor: `${task.client.color}10` }
                          : {}),
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTasks.has(task.id)}
                        onChange={() => toggleTask(task.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <span
                          className={`
                          block truncate
                          ${listDensity === "compact" ? "text-xs font-semibold" : "text-sm font-semibold"}
                          ${task.status === "done" ? "line-through text-gray-500" : "text-gray-900 dark:text-gray-100"}
                        `}
                        >
                          {task.title}
                        </span>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          {renderCell(task, "status", undefined, t, locale)}
                          {renderCell(task, "priority", undefined, t, locale)}
                          {task.deadline &&
                            renderCell(task, "deadline", undefined, t, locale)}
                          {task.client && (
                            <span
                              className="text-[11px] truncate max-w-[100px] inline-flex items-center gap-1"
                              style={
                                task.client.color
                                  ? { color: task.client.color }
                                  : undefined
                              }
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    task.client.color || "#9ca3af",
                                }}
                              />
                              {task.client.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        ));
      })()}

      {/* Keyboard hints */}
      <div className="hidden sm:flex items-center gap-4 px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800">
        <span>
          <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[9px]">
            J
          </kbd>
          /
          <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[9px]">
            K
          </kbd>{" "}
          {t("list.hintNavigate")}
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[9px]">
            Enter
          </kbd>{" "}
          {t("list.hintOpen")}
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[9px]">
            E
          </kbd>{" "}
          {t("list.hintEdit")}
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[9px]">
            X
          </kbd>{" "}
          {t("list.hintSelect")}
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[9px]">
            D
          </kbd>{" "}
          {t("list.hintDone")}
        </span>
      </div>
    </div>
  );
}
