"use client";

import { Play, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";

interface RecentTask {
  projectId: string | null;
  clientId: string | null;
  description: string;
  projectName: string | null;
  clientName: string | null;
  lastUsed: Date;
}

interface RecentTasksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTask: (task: RecentTask) => void;
  tasks: RecentTask[] | undefined;
}

export function RecentTasksModal({
  isOpen,
  onClose,
  onSelectTask,
  tasks,
}: RecentTasksModalProps) {
  const t = useTranslations("timer");
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  // Focus trap
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Tab" || !modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }, []);

  // Setup focus management
  useEffect(() => {
    if (isOpen && tasks && tasks.length > 0) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("keydown", handleTabKey);
      document.body.style.overflow = "hidden";

      setTimeout(() => {
        modalRef.current?.querySelector<HTMLElement>("button")?.focus();
      }, 50);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keydown", handleTabKey);
      document.body.style.overflow = "";

      if (!isOpen && previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, tasks, handleKeyDown, handleTabKey]);

  if (!isOpen || !tasks || tasks.length === 0) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recent-tasks-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-xl mx-4 animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3
            id="recent-tasks-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {t("recentTasks.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            aria-label={t("recentTasks.closeDialog")}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        {/* biome-ignore lint/a11y/useSemanticElements: rollen sidder på en container uden ul/ol-styling (reset), og punkterne er knapper/links; ul/li ville ændre layoutet */}
        <div
          className="p-4 space-y-2 max-h-80 overflow-y-auto"
          role="list"
          aria-label={t("recentTasks.listLabel")}
        >
          {tasks.map((task, index) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
              key={`${task.projectId || ""}-${task.clientId || ""}-${task.description}-${index}`}
              type="button"
              onClick={() => onSelectTask(task)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-brand-300 dark:hover:border-brand-600 group focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white truncate">
                    {task.description || t("common.noDescription")}
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">
                    {task.clientName}
                    {task.projectName && ` → ${task.projectName}`}
                  </p>
                </div>
                <Play
                  className="h-5 w-5 text-gray-400 group-hover:text-brand-600 dark:group-hover:text-brand-400 shrink-0 mt-0.5 transition-colors"
                  aria-hidden="true"
                />
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 pt-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {t("recentTasks.hint")}
          </p>
        </div>
      </div>
    </div>
  );
}
