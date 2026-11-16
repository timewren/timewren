"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

interface Subtask {
  id: string;
  title: string;
  status: string;
}

interface SubtasksSectionProps {
  taskId: string;
  subtasks: Subtask[];
}

export function SubtasksSection({ taskId, subtasks }: SubtasksSectionProps) {
  const t = useTranslations("tasks");
  const utils = trpc.useUtils();
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const completed = subtasks.filter((s) => s.status === "done").length;
  const total = subtasks.length;
  const pct = total > 0 ? (completed / total) * 100 : 0;

  function invalidateAll() {
    utils.tasks.listByStatus.invalidate();
    utils.tasks.list.invalidate();
    utils.tasks.getById.invalidate({ id: taskId });
  }

  // -- Toggle done/undone --
  const toggleMutation = trpc.tasks.update.useMutation({
    onSuccess: () => invalidateAll(),
    onError: (err) => toast.error(err.message || t("subtasks.statusFailed")),
  });

  // -- Rename --
  const renameMutation = trpc.tasks.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      invalidateAll();
    },
    onError: (err) => toast.error(err.message || t("subtasks.renameFailed")),
  });

  // -- Create --
  const createMutation = trpc.tasks.create.useMutation({
    onSuccess: () => {
      setNewTitle("");
      addInputRef.current?.focus();
      invalidateAll();
    },
    onError: (err) => toast.error(err.message || t("subtasks.createFailed")),
  });

  // -- Delete --
  const deleteMutation = trpc.tasks.delete.useMutation({
    onSuccess: (_data, variables) => {
      const deleted = subtasks.find((s) => s.id === variables.id);
      invalidateAll();
      if (deleted) {
        toast(t("subtasks.deleted"), {
          action: {
            label: t("subtasks.undo"),
            onClick: () => {
              createMutation.mutate({
                title: deleted.title,
                parentTaskId: taskId,
                status: deleted.status as
                  | "backlog"
                  | "todo"
                  | "in_progress"
                  | "done",
              });
            },
          },
        });
      }
    },
    onError: (err) => toast.error(err.message || t("subtasks.deleteFailed")),
  });

  function handleToggle(subtask: Subtask) {
    const newStatus = subtask.status === "done" ? "backlog" : "done";
    toggleMutation.mutate({ id: subtask.id, status: newStatus });
  }

  function startRename(subtask: Subtask) {
    setEditingId(subtask.id);
    setEditingTitle(subtask.title);
  }

  function commitRename(subtaskId: string) {
    const trimmed = editingTitle.trim();
    if (
      !trimmed ||
      trimmed === subtasks.find((s) => s.id === subtaskId)?.title
    ) {
      setEditingId(null);
      return;
    }
    renameMutation.mutate({ id: subtaskId, title: trimmed });
  }

  function handleAdd() {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    createMutation.mutate({
      title: trimmed,
      parentTaskId: taskId,
      status: "backlog",
    });
  }

  return (
    <div className="space-y-2">
      {/* Progress bar */}
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{t("subtasks.progress", { completed, total })}</span>
        <div className="flex-1 h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className="h-1 rounded-full bg-green-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Subtask list */}
      <ul className="space-y-1">
        {subtasks.map((subtask) => (
          <li
            key={subtask.id}
            className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700/50"
          >
            <input
              type="checkbox"
              checked={subtask.status === "done"}
              onChange={() => handleToggle(subtask)}
              aria-label={
                subtask.status === "done"
                  ? t("subtasks.markNotDone", { title: subtask.title })
                  : t("subtasks.markDone", { title: subtask.title })
              }
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-green-600 focus:ring-green-500 accent-green-600 shrink-0"
            />

            {editingId === subtask.id ? (
              <input
                type="text"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={() => commitRename(subtask.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const trimmed = editingTitle.trim();
                    setEditingId(null); // unmounts input, preventing blur handler
                    if (trimmed && trimmed !== subtask.title) {
                      renameMutation.mutate({ id: subtask.id, title: trimmed });
                    }
                  }
                  if (e.key === "Escape") setEditingId(null);
                }}
                // biome-ignore lint/a11y/noAutofocus: feltet vises som følge af brugerens handling (inline-redigering/dialog), så fokus flytter forventeligt
                autoFocus
                className="flex-1 min-w-0 bg-transparent border-b border-gray-300 dark:border-gray-600 text-sm text-gray-900 dark:text-white outline-none focus:border-brand-500"
              />
            ) : (
              // biome-ignore lint/a11y/useSemanticElements: indholdet er blokelementer (div'er), som ikke må ligge i en button
              <span
                onClick={() => startRename(subtask)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") startRename(subtask);
                }}
                role="button"
                tabIndex={0}
                className={`flex-1 min-w-0 text-sm cursor-pointer truncate ${
                  subtask.status === "done"
                    ? "line-through text-gray-400 dark:text-gray-500"
                    : "text-gray-900 dark:text-white"
                }`}
              >
                {subtask.title}
              </span>
            )}

            <button
              type="button"
              onClick={() => deleteMutation.mutate({ id: subtask.id })}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400"
              aria-label={t("subtasks.deleteLabel", { title: subtask.title })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      {/* Add subtask */}
      <div className="flex items-center gap-2 rounded border border-dashed border-gray-300 dark:border-gray-600 px-2 py-1.5">
        <Plus className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
        <input
          ref={addInputRef}
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder={t("subtasks.addPlaceholder")}
          className="flex-1 min-w-0 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none"
        />
      </div>
    </div>
  );
}
