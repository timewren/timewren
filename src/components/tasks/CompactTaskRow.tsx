"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { type CSSProperties, type MouseEvent, useEffect, useRef } from "react";
import { getClientAccent } from "./client-accent";
import { PRIORITY_CONFIG } from "./priority-config";
import type { TaskCardData } from "./TaskCard";
import { TaskTimeBar, TaskTimeChip } from "./TaskTimeProgress";

/** Alt+piletast på et kort: op/ned i kolonnen, venstre/højre til nabokolonnen. */
export type KeyboardMove = "up" | "down" | "left" | "right";

const KEYBOARD_MOVES: Record<string, KeyboardMove> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

interface CompactTaskRowProps {
  task: TaskCardData;
  onClick?: (task: TaskCardData) => void;
  onContextMenu?: (e: MouseEvent, task: TaskCardData) => void;
  onKeyboardMove?: (task: TaskCardData, move: KeyboardMove) => void;
  /** Hold fokus på kortet, mens en tastaturflytning lander. */
  focusRequested?: boolean;
}

export function CompactTaskRow({
  task,
  onClick,
  onContextMenu,
  onKeyboardMove,
  focusRequested,
}: CompactTaskRowProps) {
  const t = useTranslations("tasks");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Uden afhængigheder: kortet kan være flyttet i DOM'en (og har mistet
  // fokus) ved enhver gengivelse, indtil tavlen har hentet flytningen.
  useEffect(() => {
    if (focusRequested && document.activeElement !== rowRef.current) {
      rowRef.current?.focus();
    }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const priority =
    PRIORITY_CONFIG[
      (task.priority || "medium") as keyof typeof PRIORITY_CONFIG
    ];
  const priorityColor = priority?.color || "#d1d5db";
  const priorityLabel = t(`priority.${task.priority || "medium"}`);

  const accent = task.client?.color ? getClientAccent(task.client.color) : null;
  const meta = getMetaDisplay(task, t);
  const place = [task.client?.name, task.project?.name]
    .filter(Boolean)
    .join(" · ");

  return (
    // biome-ignore lint/a11y/useSemanticElements: indholdet er blokelementer (div'er), som ikke må ligge i en button
    <div
      ref={(node) => {
        setNodeRef(node);
        rowRef.current = node;
      }}
      style={{
        ...style,
        ...(accent
          ? ({
              borderLeftColor: accent.border,
              "--client-tint-light": accent.tintLight,
              "--client-tint-dark": accent.tintDark,
              "--client-text-light": accent.badgeTextLight,
              "--client-text-dark": accent.badgeTextDark,
            } as CSSProperties)
          : {}),
      }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={[
        task.title,
        place,
        priorityLabel && `prioritet ${priorityLabel.toLowerCase()}`,
      ]
        .filter(Boolean)
        .join(", ")}
      aria-keyshortcuts="Enter Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
      title={t("compactRow.openHint")}
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        onClick?.(task);
      }}
      onKeyDown={(e) => {
        const move = e.altKey ? KEYBOARD_MOVES[e.key] : undefined;
        if (move && onKeyboardMove && !isDragging) {
          e.preventDefault();
          onKeyboardMove(task, move);
          return;
        }
        if (e.key === "Enter" && !isDragging) {
          e.preventDefault();
          onClick?.(task);
          return;
        }
        // Mellemrum samler kortet op (dnd-kit): piletaster flytter,
        // mellemrum slipper, Escape fortryder.
        listeners?.onKeyDown?.(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e, task);
      }}
      className={`
        group flex flex-col gap-1 px-2 py-1.5 rounded-md cursor-pointer
        border-l-[3px]
        transition-all duration-100
        hover:bg-gray-50 dark:hover:bg-gray-700/50
        ${
          accent
            ? "bg-[var(--client-tint-light)] dark:bg-[var(--client-tint-dark)]"
            : "border-transparent hover:border-l-brand-500"
        }
        ${task.status === "done" ? "opacity-60" : ""}
      `}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: priorityColor }}
        />
        <span
          className={`
            flex-1 text-xs font-semibold text-gray-900 dark:text-gray-100 truncate
            ${task.status === "done" ? "line-through text-gray-500 dark:text-gray-400" : ""}
          `}
        >
          {task.title}
        </span>
        {/* Registreret tid mod estimat (#212) */}
        <TaskTimeChip
          trackedMinutes={task.trackedMinutes ?? task.actualMinutes}
          estimatedMinutes={task.estimatedMinutes}
        />
        {meta}
      </div>
      {place && (
        <div
          className={`ml-3.5 truncate text-[11px] ${
            accent
              ? "text-[var(--client-text-light)] dark:text-[var(--client-text-dark)]"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {task.client?.name && (
            <span className="font-medium">{task.client.name}</span>
          )}
          {task.client?.name && task.project?.name && (
            <span aria-hidden="true"> · </span>
          )}
          {task.project?.name && (
            <span className="opacity-80">{task.project.name}</span>
          )}
        </div>
      )}
      <TaskTimeBar
        trackedMinutes={task.trackedMinutes ?? task.actualMinutes}
        estimatedMinutes={task.estimatedMinutes}
        className="ml-3.5"
      />
    </div>
  );
}

function getMetaDisplay(
  task: TaskCardData,
  t: ReturnType<typeof useTranslations<"tasks">>,
) {
  if (task.deadline && task.status !== "done") {
    const now = new Date();
    const deadline = new Date(task.deadline);
    const daysUntil = Math.ceil(
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntil < 0) {
      return (
        <span className="shrink-0 flex items-center gap-0.5 text-[10px] font-medium text-red-600">
          <AlertCircle className="h-2.5 w-2.5" />
          {t("compactRow.overdue")}
        </span>
      );
    }
    if (daysUntil === 0) {
      return (
        <span className="shrink-0 flex items-center gap-0.5 text-[10px] font-medium text-red-600">
          <AlertCircle className="h-2.5 w-2.5" />
          {t("compactRow.today")}
        </span>
      );
    }
    if (daysUntil <= 3) {
      return (
        <span className="shrink-0 flex items-center gap-0.5 text-[10px] font-medium text-amber-600">
          <AlertCircle className="h-2.5 w-2.5" />
          {t("compactRow.daysShort", { count: daysUntil })}
        </span>
      );
    }
  }

  return null;
}

export function CompactTaskRowSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 animate-pulse">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700" />
      <span className="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded" />
      <span className="w-12 h-3 bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  );
}
