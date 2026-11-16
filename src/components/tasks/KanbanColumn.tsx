"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronsLeft, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, type MouseEvent, useRef, useState } from "react";
import type { LaneCategory } from "@/lib/kanban/lane-category";
import {
  CompactTaskRow,
  CompactTaskRowSkeleton,
  type KeyboardMove,
} from "./CompactTaskRow";
import { LaneHeader } from "./LaneHeader";
import type { TaskCardData } from "./TaskCard";

// Legacy enum — still used as the `tasks.status` varchar values across
// the rest of the codebase (TaskFormModal, filters, etc). The Kanban
// board itself now keys off lane UUIDs instead.
export type KanbanStatus = "backlog" | "todo" | "in_progress" | "done";

interface KanbanColumnProps {
  laneId: string;
  laneName: string;
  laneColor: string;
  laneCategory?: LaneCategory;
  isArchive: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  tasks: TaskCardData[];
  isLoading?: boolean;
  onTaskClick?: (task: TaskCardData) => void;
  onTaskContextMenu?: (e: MouseEvent, task: TaskCardData) => void;
  onAddTask?: (laneId: string) => void;
  onInlineAdd?: (laneId: string, title: string) => void;
  onDeleteLane?: (laneId: string) => void;
  onLanesChange?: () => void;
  onMoveLane?: (laneId: string, delta: -1 | 1) => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onOpenSettings?: () => void;
  onTaskKeyboardMove?: (task: TaskCardData, move: KeyboardMove) => void;
  focusTaskId?: string | null;
}

export function KanbanColumn({
  laneId,
  laneName,
  laneColor,
  laneCategory,
  isArchive: _isArchive,
  isCollapsed,
  onToggleCollapse,
  tasks,
  isLoading = false,
  onTaskClick,
  onTaskContextMenu,
  onAddTask,
  onInlineAdd,
  onDeleteLane,
  onLanesChange,
  onMoveLane,
  canMoveLeft,
  canMoveRight,
  onOpenSettings,
  onTaskKeyboardMove,
  focusTaskId,
}: KanbanColumnProps) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [visibleCount, setVisibleCount] = useState(15);
  const [showInlineInput, setShowInlineInput] = useState(false);
  const [inlineValue, setInlineValue] = useState("");
  const inlineInputRef = useRef<HTMLInputElement>(null);

  // Droppable ref for the inner task-list area (so dropping tasks on a
  // column still works as before).
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: laneId,
  });

  // Sortable wrapper for the COLUMN itself — enables horizontal
  // drag-to-reorder of lanes. Drag listeners are passed down to the
  // LaneHeader's color-dot so only that tiny area initiates a lane
  // drag — the rest of the column (task cards, buttons) stays clickable.
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: laneId });

  const columnStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (isCollapsed) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: indholdet er blokelementer (div'er), som ikke må ligge i en button
      <div
        ref={(node) => {
          setSortableRef(node);
          setDroppableRef(node);
        }}
        style={columnStyle}
        role="button"
        tabIndex={0}
        aria-expanded={false}
        aria-label={t("column.expandLane", {
          lane: laneName,
          count: tasks.length,
        })}
        title={t("column.expand")}
        onClick={onToggleCollapse}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleCollapse?.();
          }
        }}
        className={`flex flex-col items-center w-11 min-w-[44px] rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/80 transition-colors ${isOver ? "ring-2 ring-brand-500 ring-opacity-50" : ""}`}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: laneColor }}
        />
        <span className="mt-2 text-xs font-semibold text-gray-700 dark:text-gray-300 [writing-mode:vertical-rl] [text-orientation:mixed]">
          {laneName}
        </span>
        <span className="mt-2 text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>
    );
  }

  const visibleTasks = tasks.slice(0, visibleCount);
  const remaining = tasks.length - visibleCount;

  const handleInlineSubmit = () => {
    const trimmed = inlineValue.trim();
    if (!trimmed || !onInlineAdd) return;
    onInlineAdd(laneId, trimmed);
    setInlineValue("");
    // Keep input open for rapid-fire adding
    inlineInputRef.current?.focus();
  };

  const handleInlineKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleInlineSubmit();
    } else if (e.key === "Escape") {
      setInlineValue("");
      setShowInlineInput(false);
    }
  };

  const handlePlusClick = () => {
    if (onInlineAdd) {
      setShowInlineInput(true);
      // Focus input after state update
      setTimeout(() => inlineInputRef.current?.focus(), 0);
    } else if (onAddTask) {
      onAddTask(laneId);
    }
  };

  return (
    <section
      ref={setSortableRef}
      style={columnStyle}
      aria-label={`${laneName}, ${tasks.length} ${tasks.length === 1 ? "opgave" : "opgaver"}`}
      className={`
        flex flex-col
        min-h-[400px] sm:min-h-[500px] max-h-[calc(100vh-280px)]
        w-72 min-w-[280px]
        rounded-lg
        bg-white dark:bg-gray-800
        border border-gray-200 dark:border-gray-700
        ${isOver ? "ring-2 ring-brand-500 ring-opacity-50" : ""}
        transition-all duration-200
      `}
    >
      {/* Column header */}
      <div className="flex items-center justify-between gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex-1 min-w-0">
          {onDeleteLane && onLanesChange ? (
            <LaneHeader
              laneId={laneId}
              laneName={laneName}
              laneColor={laneColor}
              laneCategory={laneCategory}
              taskCount={tasks.length}
              onDeleteRequest={onDeleteLane}
              onChange={onLanesChange}
              onMove={onMoveLane}
              canMoveLeft={canMoveLeft}
              canMoveRight={canMoveRight}
              onCollapse={onToggleCollapse}
              onOpenSettings={onOpenSettings}
              dragAttributes={attributes}
              dragListeners={listeners}
            />
          ) : (
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: laneColor }}
              />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {laneName}
              </h3>
              {onToggleCollapse && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  aria-label={t("laneHeader.collapseLane", { lane: laneName })}
                  title={t("laneHeader.collapse")}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>
              )}
              <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full">
                {tasks.length}
              </span>
            </div>
          )}
        </div>
        {(onAddTask || onInlineAdd) && (
          <button
            type="button"
            onClick={handlePlusClick}
            className="shrink-0 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            title={t("column.addToLane", { lane: laneName })}
            aria-label={t("column.addToLane", { lane: laneName })}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Scrollable task list */}
      <div
        ref={setDroppableRef}
        className="flex-1 overflow-y-auto p-2 space-y-3"
      >
        {isLoading ? (
          // Loading skeletons
          <>
            <CompactTaskRowSkeleton />
            <CompactTaskRowSkeleton />
            <CompactTaskRowSkeleton />
            <CompactTaskRowSkeleton />
            <CompactTaskRowSkeleton />
            <CompactTaskRowSkeleton />
          </>
        ) : tasks.length === 0 && !showInlineInput ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full opacity-50"
              style={{ backgroundColor: laneColor }}
            />
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t("column.empty")}
            </p>
            <button
              type="button"
              onClick={handlePlusClick}
              className="mt-2 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              {t("column.addTask")}
            </button>
          </div>
        ) : (
          // Task rows
          <>
            <SortableContext
              items={visibleTasks.map((task) => task.id)}
              strategy={verticalListSortingStrategy}
            >
              {visibleTasks.map((task) => (
                <CompactTaskRow
                  key={task.id}
                  task={task}
                  onClick={onTaskClick}
                  onContextMenu={onTaskContextMenu}
                  onKeyboardMove={onTaskKeyboardMove}
                  focusRequested={focusTaskId === task.id}
                />
              ))}
            </SortableContext>
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + 15)}
                className="w-full py-1.5 text-center text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded transition-colors"
              >
                {t("column.showMore", { count: remaining })}
              </button>
            )}
          </>
        )}

        {/* Inline add input (Phase 2) */}
        {showInlineInput && (
          <div className="mt-1">
            <input
              ref={inlineInputRef}
              type="text"
              value={inlineValue}
              onChange={(e) => setInlineValue(e.target.value)}
              onKeyDown={handleInlineKeyDown}
              onBlur={() => {
                if (!inlineValue.trim()) {
                  setShowInlineInput(false);
                }
              }}
              placeholder={t("column.newTaskPlaceholder")}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {t("column.enterToCreate")}
              </span>
              <button
                type="button"
                onClick={() => {
                  setInlineValue("");
                  setShowInlineInput(false);
                }}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {tc("close")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Drop indicator when dragging over */}
      {isOver && (
        <div className="mx-2 mb-2 h-16 border-2 border-dashed border-brand-400 rounded-lg bg-brand-50 dark:bg-tt-gran-lys flex items-center justify-center">
          <span className="text-sm text-brand-500 dark:text-brand-400">
            {t("column.dropHere")}
          </span>
        </div>
      )}
    </section>
  );
}
