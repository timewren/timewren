"use client";

import { Check, ChevronDown, ChevronsUpDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { currentSyncLocale } from "@/i18n/sync-text";
import { useUiText } from "./use-ui-text";

type TaskItem = {
  id: string;
  title: string;
  status: string;
  completedAt?: Date | string | null;
  projectId?: string | null;
  clientId?: string | null;
  project?: {
    id: string;
    name: string;
    client?: { id: string; name: string } | null;
  } | null;
  client?: { id: string; name: string } | null;
};

export interface TaskSelectProps {
  tasks: Record<string, TaskItem[]> | undefined;
  value: string | null;
  onChange: (taskId: string | null) => void;
  clientId?: string | null;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
  backlogLimit?: number;
}

export function TaskSelect({
  tasks,
  value,
  onChange,
  clientId,
  placeholder,
  className = "",
  disabled = false,
  allowClear = true,
  backlogLimit = 5,
}: TaskSelectProps) {
  const tUi = useUiText();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showAllBacklog, setShowAllBacklog] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setShowAllBacklog(false);
    }
  }, [open]);

  const { sections, selectedTask } = useMemo(() => {
    if (!tasks) return { sections: [], selectedTask: null };

    const allTasks = Object.values(tasks).flat();

    const active = allTasks.filter((t) => !t.completedAt);

    const filtered = clientId
      ? active.filter((t) => {
          const tClientId = t.clientId ?? t.project?.client?.id ?? null;
          return tClientId === clientId;
        })
      : active;

    const query = search.toLowerCase();
    const searched = query
      ? filtered.filter(
          (t) =>
            t.title.toLowerCase().includes(query) ||
            (t.project?.name ?? "").toLowerCase().includes(query) ||
            (t.client?.name ?? t.project?.client?.name ?? "")
              .toLowerCase()
              .includes(query),
        )
      : filtered;

    const inProgress: TaskItem[] = [];
    const todo: TaskItem[] = [];
    const backlog: TaskItem[] = [];
    const other: TaskItem[] = [];

    for (const t of searched) {
      const s = t.status?.toLowerCase() ?? "";
      if (s === "in_progress" || s === "i gang") {
        inProgress.push(t);
      } else if (s === "todo") {
        todo.push(t);
      } else if (s === "backlog") {
        backlog.push(t);
      } else {
        other.push(t);
      }
    }

    const sortByTitle = (a: TaskItem, b: TaskItem) =>
      a.title.localeCompare(b.title, currentSyncLocale());
    inProgress.sort(sortByTitle);
    todo.sort(sortByTitle);
    backlog.sort(sortByTitle);
    other.sort(sortByTitle);

    const sections: Array<{
      key: string;
      label: string;
      color: string;
      tasks: TaskItem[];
      collapsible?: boolean;
    }> = [];

    if (inProgress.length > 0) {
      sections.push({
        key: "in_progress",
        label: tUi("task.inProgress"),
        color: "text-amber-500",
        tasks: inProgress,
      });
    }
    if (todo.length > 0) {
      sections.push({
        key: "todo",
        label: tUi("task.todo"),
        color: "text-blue-500",
        tasks: todo,
      });
    }
    if (backlog.length > 0) {
      sections.push({
        key: "backlog",
        label: tUi("task.backlog"),
        color: "text-gray-400",
        tasks: backlog,
        collapsible: true,
      });
    }
    if (other.length > 0) {
      sections.push({
        key: "other",
        label: tUi("task.other"),
        color: "text-gray-400",
        tasks: other,
      });
    }

    const selected = value
      ? (allTasks.find((t) => t.id === value) ?? null)
      : null;

    return { sections, selectedTask: selected };
  }, [tasks, clientId, search, value, tUi]);

  const select = (taskId: string | null) => {
    onChange(taskId);
    setOpen(false);
    setSearch("");
  };

  const taskContext = (t: TaskItem) => {
    const parts: string[] = [];
    const cName = t.client?.name ?? t.project?.client?.name;
    if (cName) parts.push(cName);
    if (t.project?.name) parts.push(t.project.name);
    return parts.join(" · ");
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex w-full items-center justify-between rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-left text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none disabled:opacity-50"
      >
        <span
          className={`truncate ${!selectedTask ? "text-gray-400 dark:text-gray-500" : ""}`}
        >
          {selectedTask
            ? selectedTask.title
            : (placeholder ?? tUi("task.placeholder"))}
        </span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[260px] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
          {/* Search */}
          <div className="flex items-center border-b border-gray-200 dark:border-gray-600 px-3">
            <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tUi("task.searchPlaceholder")}
              className="w-full bg-transparent px-2 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
              // biome-ignore lint/a11y/noAutofocus: search should focus on open
              autoFocus
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="p-0.5 text-gray-400 hover:text-gray-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Options */}
          <div className="max-h-72 overflow-y-auto p-1">
            {/* Clear */}
            {allowClear && (
              <button
                type="button"
                onClick={() => select(null)}
                className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:bg-brand-50 dark:hover:bg-gray-700"
              >
                <span className="italic">{tUi("task.none")}</span>
                {!value && (
                  <Check className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                )}
              </button>
            )}

            {sections.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-500">
                {search ? tUi("task.noMatch") : tUi("task.noActive")}
              </p>
            )}

            {sections.map((section) => {
              const isBacklog = section.collapsible && !search;
              const visibleTasks =
                isBacklog && !showAllBacklog
                  ? section.tasks.slice(0, backlogLimit)
                  : section.tasks;
              const hiddenCount = isBacklog
                ? section.tasks.length - backlogLimit
                : 0;

              return (
                <div key={section.key}>
                  <p
                    className={`px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider ${section.color}`}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full mr-1"
                      style={{
                        backgroundColor:
                          section.key === "in_progress"
                            ? "#f59e0b"
                            : section.key === "todo"
                              ? "#3b82f6"
                              : section.key === "backlog"
                                ? "#9ca3af"
                                : "#6b7280",
                      }}
                    />
                    {section.label}
                    <span className="ml-1 font-normal text-gray-400">
                      ({section.tasks.length})
                    </span>
                  </p>
                  {visibleTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => select(t.id)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm hover:bg-brand-50 dark:hover:bg-gray-700 ${
                        t.id === value
                          ? "text-brand-700 dark:text-brand-400 bg-brand-50/50 dark:bg-tt-gran-lys"
                          : "text-gray-900 dark:text-white"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="block truncate">{t.title}</span>
                        {taskContext(t) && (
                          <span className="block truncate text-[10px] text-gray-400">
                            {taskContext(t)}
                          </span>
                        )}
                      </div>
                      {t.id === value && (
                        <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
                      )}
                    </button>
                  ))}
                  {isBacklog && hiddenCount > 0 && !showAllBacklog && (
                    <button
                      type="button"
                      onClick={() => setShowAllBacklog(true)}
                      className="flex w-full items-center gap-1 px-3 py-1.5 text-xs text-brand-600 dark:text-brand-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md"
                    >
                      <ChevronDown className="h-3 w-3" />
                      {tUi("task.showMoreBacklog", { count: hiddenCount })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
