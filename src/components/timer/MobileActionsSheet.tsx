"use client";

import { Clock, History, Plus, Save, X, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";

interface MobileActionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  onOpenAddTime: () => void;
  onOpenRecentTasks: () => void;
  onOpenQuickActions: () => void;
  onSave: () => void;
  elapsedTime: number;
  isRunning: boolean;
  canSave: boolean;
  projectName?: string;
  clientName?: string;
}

export function MobileActionsSheet({
  isOpen,
  onClose,
  description,
  onDescriptionChange,
  onOpenAddTime,
  onOpenRecentTasks,
  onOpenQuickActions,
  onSave,
  elapsedTime,
  isRunning,
  canSave,
  projectName,
  clientName,
}: MobileActionsSheetProps) {
  const t = useTranslations("timer");
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (e.key !== "Tab" || !sheetRef.current) return;

    const focusableElements = sheetRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("keydown", handleTabKey);
      document.body.style.overflow = "hidden";

      setTimeout(() => {
        textareaRef.current?.focus();
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
  }, [isOpen, handleKeyDown, handleTabKey]);

  if (!isOpen) return null;

  // Format time display (HH:MM:SS)
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-actions-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className="w-full max-w-lg rounded-t-xl sm:rounded-xl bg-white dark:bg-gray-800 shadow-xl sm:mx-4 animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
      >
        {/* Handle bar for mobile */}
        <div className="flex justify-center pt-3 sm:hidden" aria-hidden="true">
          <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-full ${isRunning ? "bg-brand-100 dark:bg-tt-gran-lys" : "bg-gray-100 dark:bg-gray-700"}`}
            >
              <Clock
                className={`h-5 w-5 ${isRunning ? "text-brand-600 dark:text-brand-400 animate-pulse" : "text-gray-600 dark:text-gray-400"}`}
                aria-hidden="true"
              />
            </div>
            <div>
              <span
                id="mobile-actions-title"
                role="timer"
                className="tabular-nums text-xl sm:text-2xl font-bold text-gray-900 dark:text-white block"
                aria-label={t("mobileActions.timerAria", {
                  time: formatTime(elapsedTime),
                })}
              >
                {formatTime(elapsedTime)}
              </span>
              {(projectName || clientName) && (
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {clientName}
                  {projectName ? ` → ${projectName}` : ""}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            aria-label={t("mobileActions.closeDialog")}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Description */}
          <div>
            <label
              htmlFor="mobile-description"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("mobileActions.whatWorking")}
            </label>
            <textarea
              ref={textareaRef}
              id="mobile-description"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 px-4 py-3 text-base focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:focus:ring-brand-400/20 resize-none"
              placeholder={t("mobileActions.placeholder")}
              rows={3}
            />
          </div>

          {/* Quick action buttons grid */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                onOpenAddTime();
                onClose();
              }}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-3.5 font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              {t("mobileActions.addTime")}
            </button>

            <button
              type="button"
              onClick={() => {
                onOpenRecentTasks();
                onClose();
              }}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-3.5 font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <History className="h-5 w-5" aria-hidden="true" />
              {t("mobileActions.recent")}
            </button>

            {!isRunning && elapsedTime === 0 && (
              <button
                type="button"
                onClick={() => {
                  onOpenQuickActions();
                  onClose();
                }}
                className="col-span-2 flex items-center justify-center gap-2 rounded-lg border border-brand-300 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys px-4 py-3.5 font-medium text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-100 dark:hover:bg-tt-gran-lys active:bg-brand-200 dark:active:bg-tt-gran-lys focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <Zap className="h-5 w-5" aria-hidden="true" />
                {t("mobileActions.quickStart")}
              </button>
            )}
          </div>
        </div>

        {/* Footer with save button */}
        <div className="p-4 pt-0 space-y-3">
          {canSave && (isRunning || elapsedTime > 0) && (
            <button
              type="button"
              onClick={() => {
                onSave();
                onClose();
              }}
              className="w-full rounded-lg bg-green-600 hover:bg-green-700 active:bg-green-800 px-4 py-4 font-semibold text-white text-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 flex items-center justify-center gap-2"
            >
              <Save className="h-5 w-5" aria-hidden="true" />
              {t("mobileActions.save")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 px-4 py-3 font-medium text-gray-700 dark:text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            {t("mobileActions.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
