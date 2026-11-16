"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { trpc } from "@/providers/trpc-provider";

interface DeleteLaneDialogProps {
  laneId: string;
  laneName: string;
  taskCount: number;
  otherLanes: Array<{ id: string; name: string }>;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteLaneDialog({
  laneId,
  laneName,
  taskCount,
  otherLanes,
  isOpen,
  onClose,
  onSuccess,
}: DeleteLaneDialogProps) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [destinationId, setDestinationId] = useState(otherLanes[0]?.id ?? "");
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Reset destination when otherLanes changes
  useEffect(() => {
    if (!otherLanes.find((l) => l.id === destinationId)) {
      setDestinationId(otherLanes[0]?.id ?? "");
    }
  }, [otherLanes, destinationId]);

  const deleteLane = trpc.taskStatuses.delete.useMutation({
    onSuccess: () => {
      toast.success(t("deleteLane.deleted"));
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(err.message || t("deleteLane.deleteFailed")),
  });

  if (!isOpen) return null;

  const hasTasks = taskCount > 0;
  const noAvailableDestination = hasTasks && otherLanes.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-lane-title"
        className="w-full max-w-sm rounded-lg bg-white dark:bg-gray-800 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <h2
            id="delete-lane-title"
            className="text-base font-semibold text-gray-900 dark:text-white"
          >
            {t("deleteLane.title", { name: laneName })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc("close")}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {noAvailableDestination ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {t.rich("deleteLane.noDestination", {
                count: taskCount,
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          ) : hasTasks ? (
            <>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t.rich("deleteLane.moveWhere", {
                  count: taskCount,
                  b: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
              <select
                aria-label={t("deleteLane.moveTo")}
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                {otherLanes.map((lane) => (
                  <option key={lane.id} value={lane.id}>
                    {lane.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {t("deleteLane.empty")}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              {tc("cancel")}
            </button>
            <button
              type="button"
              disabled={
                deleteLane.isPending ||
                noAvailableDestination ||
                (hasTasks && !destinationId)
              }
              onClick={() =>
                deleteLane.mutate({
                  id: laneId,
                  destinationLaneId: hasTasks ? destinationId : undefined,
                })
              }
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleteLane.isPending
                ? t("deleteLane.deleting")
                : hasTasks
                  ? t("deleteLane.moveAndDelete")
                  : tc("delete")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
