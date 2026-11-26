"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  GripVertical,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useRef,
  useState,
} from "react";
import { PriorityBadge } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import { getClientAccent } from "./client-accent";

export interface TaskCardData {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  deadline: Date | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  /** Sum af tidsregistreringer på opgaven (tasks.list/listByStatus, #212). */
  trackedMinutes?: number;
  aiConfidence: string | null;
  aiSuggestedProject: string | null;
  project: { id: string; name: string } | null;
  client: { id: string; name: string; color: string | null } | null;
  subtasks?: { id: string; title: string; status: string }[];
  /** Assigned team member (null = unassigned). Only set in team context. */
  assignee?: { name: string; image: string | null } | null;
  assignedToUserId?: string | null;
}

/** First-letter initials for an avatar fallback. */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const priorityOrder = ["low", "medium", "high", "urgent"] as const;

interface TaskCardProps {
  task: TaskCardData;
  isDragging?: boolean;
  onQuickComplete?: (id: string) => void;
  onMenuClick?: (e: MouseEvent, task: TaskCardData) => void;
  onQuickPriorityChange?: (id: string, newPriority: string) => void;
  onTitleUpdate?: (id: string, newTitle: string) => void;
}

export function TaskCard({
  task,
  isDragging = false,
  onQuickComplete,
  onMenuClick,
  onQuickPriorityChange,
  onTitleUpdate,
}: TaskCardProps) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isCurrentlyDragging = isDragging || isSortableDragging;

  // Inline title editing state (Phase 3)
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Calculate deadline status
  const getDeadlineStatus = () => {
    if (!task.deadline || task.status === "done") return null;

    const now = new Date();
    const deadline = new Date(task.deadline);
    const daysUntil = Math.ceil(
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntil < 0) {
      return {
        label: t("deadline.overdue"),
        variant: "danger" as const,
        urgent: true,
      };
    } else if (daysUntil === 0) {
      return {
        label: t("deadline.today"),
        variant: "danger" as const,
        urgent: true,
      };
    } else if (daysUntil === 1) {
      return {
        label: t("deadline.tomorrow"),
        variant: "warning" as const,
        urgent: true,
      };
    } else if (daysUntil <= 3) {
      return {
        label: t("deadline.inDays", { count: daysUntil }),
        variant: "warning" as const,
        urgent: true,
      };
    }
    return {
      label: deadline.toLocaleDateString(toIntlLocale(locale), {
        day: "numeric",
        month: "short",
      }),
      variant: "default" as const,
      urgent: false,
    };
  };

  const deadlineStatus = getDeadlineStatus();

  // Calculate subtask progress
  const subtaskProgress =
    task.subtasks && task.subtasks.length > 0
      ? {
          total: task.subtasks.length,
          completed: task.subtasks.filter((s) => s.status === "done").length,
        }
      : null;

  // Check if task has AI suggestions
  const hasAiSuggestions = task.aiSuggestedProject !== null;

  // Cycle priority on click (Phase 3)
  const handlePriorityClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onQuickPriorityChange) return;
    const currentIdx = priorityOrder.indexOf(
      (task.priority || "medium") as (typeof priorityOrder)[number],
    );
    const nextPriority = priorityOrder[(currentIdx + 1) % priorityOrder.length];
    onQuickPriorityChange(task.id, nextPriority);
  };

  // Inline title edit handlers (Phase 3)
  const handleTitleDoubleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onTitleUpdate || isCurrentlyDragging) return;
    setEditTitle(task.title);
    setIsEditingTitle(true);
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  };

  const handleTitleSave = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== task.title && onTitleUpdate) {
      onTitleUpdate(task.id, trimmed);
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleSave();
    } else if (e.key === "Escape") {
      setEditTitle(task.title);
      setIsEditingTitle(false);
    }
  };

  const clientColor = task.client?.color || null;
  const accent = clientColor ? getClientAccent(clientColor) : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        ...(accent
          ? ({
              borderLeftWidth: "4px",
              borderLeftColor: accent.border,
              "--client-tint-light": accent.tintLight,
              "--client-tint-dark": accent.tintDark,
            } as CSSProperties)
          : {}),
      }}
      className={`
        group relative
        border border-gray-200 dark:border-gray-700
        ${
          accent
            ? "bg-[var(--client-tint-light)] dark:bg-[var(--client-tint-dark)]"
            : "bg-white dark:bg-gray-800"
        }
        rounded-lg shadow-sm
        transition-all duration-200
        ${isCurrentlyDragging ? "shadow-lg ring-2 ring-brand-500 ring-opacity-50 opacity-90" : "hover:shadow-md"}
        ${task.status === "done" ? "opacity-75" : ""}
      `}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="h-4 w-4 text-gray-400" />
      </div>

      {/* Card content */}
      <div className="p-3 pl-6">
        {/* Top row: Priority, AI indicator, menu */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {task.priority && task.priority !== "medium" && (
              <button
                type="button"
                onClick={handlePriorityClick}
                className="cursor-pointer rounded transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
                title={t("card.cyclePriority")}
              >
                <PriorityBadge
                  priority={
                    task.priority as "low" | "medium" | "high" | "urgent"
                  }
                  size="sm"
                />
              </button>
            )}
            {!task.priority || task.priority === "medium" ? (
              onQuickPriorityChange ? (
                <button
                  type="button"
                  onClick={handlePriorityClick}
                  className="rounded opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity text-xs text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:opacity-100"
                  title={t("card.setPriority")}
                >
                  <PriorityBadge priority="medium" size="sm" />
                </button>
              ) : null
            ) : null}
            {hasAiSuggestions && (
              <span
                className="inline-flex items-center text-brand-500 dark:text-brand-400"
                title={t("card.aiSuggestions")}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {task.assignee && (
              <span
                title={t("card.assignedTo", { name: task.assignee.name })}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
              >
                {initials(task.assignee.name)}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => onMenuClick?.(e, task)}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 opacity-0 group-hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Title - inline editable on double-click (Phase 3) */}
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            onBlur={handleTitleSave}
            className="w-full rounded border border-brand-400 bg-white px-1.5 py-0.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-brand-600 dark:bg-gray-700 dark:text-gray-100"
          />
        ) : (
          <Link
            href={`/dashboard/tasks/${task.id}`}
            className="block"
            onClick={(e) => {
              if (isCurrentlyDragging) {
                e.preventDefault();
              }
            }}
          >
            <h4
              onDoubleClick={handleTitleDoubleClick}
              className={`
                text-sm font-semibold text-gray-900 dark:text-gray-100
                hover:text-brand-600 dark:hover:text-brand-400
                line-clamp-2 break-words
                ${task.status === "done" ? "line-through text-gray-500" : ""}
              `}
            >
              {task.title}
            </h4>
          </Link>
        )}

        {/* Description preview */}
        {task.description && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2 break-words">
            {task.description}
          </p>
        )}

        {/* Meta info row */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Project/Client badges */}
          {task.project && (
            <span className="inline-flex items-center text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
              {task.project.name}
            </span>
          )}
          {task.client && !task.project && (
            <span
              className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded ${
                accent
                  ? "bg-[var(--badge-bg-light)] text-[var(--badge-text-light)] dark:bg-[var(--badge-bg-dark)] dark:text-[var(--badge-text-dark)]"
                  : ""
              }`}
              style={
                accent
                  ? ({
                      "--badge-bg-light": accent.badgeBgLight,
                      "--badge-text-light": accent.badgeTextLight,
                      "--badge-bg-dark": accent.badgeBgDark,
                      "--badge-text-dark": accent.badgeTextDark,
                    } as CSSProperties)
                  : undefined
              }
            >
              {task.client.name}
            </span>
          )}

          {/* Time estimate */}
          {task.estimatedMinutes && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <Clock className="h-3 w-3" />
              {task.estimatedMinutes >= 60
                ? `${Math.floor(task.estimatedMinutes / 60)}${t("timeUnits.hour")} ${task.estimatedMinutes % 60 > 0 ? `${task.estimatedMinutes % 60}${t("timeUnits.minute")}` : ""}`
                : `${task.estimatedMinutes}${t("timeUnits.minute")}`}
            </span>
          )}
        </div>

        {/* Bottom row: Deadline and subtasks */}
        <div className="mt-2 flex items-center justify-between">
          {/* Deadline */}
          {deadlineStatus && (
            <div
              className={`
                inline-flex items-center gap-1 text-xs
                ${deadlineStatus.urgent ? "font-medium" : ""}
                ${
                  deadlineStatus.variant === "danger"
                    ? "text-red-600"
                    : deadlineStatus.variant === "warning"
                      ? "text-amber-600"
                      : "text-gray-500"
                }
              `}
            >
              {deadlineStatus.urgent ? (
                <AlertCircle className="h-3 w-3" />
              ) : (
                <Calendar className="h-3 w-3" />
              )}
              {deadlineStatus.label}
            </div>
          )}

          {/* Subtask progress */}
          {subtaskProgress && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <CheckCircle2 className="h-3 w-3" />
              <span>
                {subtaskProgress.completed}/{subtaskProgress.total}
              </span>
              {/* Progress bar */}
              <div className="w-12 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{
                    width: `${(subtaskProgress.completed / subtaskProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Quick complete button for non-done tasks */}
          {task.status !== "done" &&
            onQuickComplete &&
            !deadlineStatus &&
            !subtaskProgress && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onQuickComplete(task.id);
                }}
                className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 opacity-0 group-hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:opacity-100"
                title={t("card.markDone")}
              >
                <CheckCircle2 className="h-4 w-4 text-gray-400 hover:text-green-600" />
              </button>
            )}
        </div>
      </div>
    </div>
  );
}

// Skeleton for loading state
export function TaskCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 animate-pulse">
      <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
      <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded mb-1" />
      <div className="h-4 w-2/3 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
      <div className="flex gap-2">
        <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-5 w-12 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    </div>
  );
}
