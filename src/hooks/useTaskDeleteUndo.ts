"use client";

import { toast } from "sonner";
import { sharedT } from "@/i18n/shared-text";
import { trpc } from "@/providers/trpc-provider";

const TASK_STATUSES = ["backlog", "todo", "in_progress", "done"] as const;
const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

type TaskStatus = (typeof TASK_STATUSES)[number];
type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Snapshot af de felter der kan genskabes via tasks.create */
export interface TaskUndoSnapshot {
  title: string;
  description?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  status?: string | null;
  priority?: string | null;
  deadline?: Date | string | null;
  estimatedMinutes?: number | null;
}

function asStatus(value: string | null | undefined): TaskStatus | undefined {
  return TASK_STATUSES.includes(value as TaskStatus)
    ? (value as TaskStatus)
    : undefined;
}

function asPriority(
  value: string | null | undefined,
): TaskPriority | undefined {
  return TASK_PRIORITIES.includes(value as TaskPriority)
    ? (value as TaskPriority)
    : undefined;
}

/**
 * Fortryd-toast efter sletning af en opgave. Gendannelse genskaber
 * opgavens felter via tasks.create — kommentarer, vedhæftninger og
 * subtasks genskabes IKKE (kræver soft-delete i backend).
 */
export function useTaskDeleteUndo() {
  const utils = trpc.useUtils();

  const restoreMutation = trpc.tasks.create.useMutation({
    onSuccess: () => {
      toast.success(sharedT("sharedLabels", "hooks.taskUndo.restored"));
      utils.tasks.invalidate();
    },
    onError: (error) =>
      toast.error(
        error.message ||
          sharedT("sharedLabels", "hooks.taskUndo.restoreFailed"),
      ),
  });

  const showUndoToast = (snapshot: TaskUndoSnapshot) => {
    toast(sharedT("sharedLabels", "hooks.taskUndo.deleted"), {
      description: snapshot.title,
      duration: 8000,
      action: {
        label: sharedT("sharedLabels", "hooks.taskUndo.undo"),
        onClick: () =>
          restoreMutation.mutate({
            title: snapshot.title,
            description: snapshot.description ?? undefined,
            projectId: snapshot.projectId ?? undefined,
            clientId: snapshot.clientId ?? undefined,
            status: asStatus(snapshot.status),
            priority: asPriority(snapshot.priority),
            deadline: snapshot.deadline ? new Date(snapshot.deadline) : null,
            estimatedMinutes: snapshot.estimatedMinutes ?? undefined,
          }),
      },
    });
  };

  return { showUndoToast };
}
