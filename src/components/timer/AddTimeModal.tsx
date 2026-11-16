"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

interface AddTimeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTime: (minutes: number) => void;
}

export function AddTimeModal({
  isOpen,
  onClose,
  onAddTime,
}: AddTimeModalProps) {
  const t = useTranslations("timer");
  const tc = useTranslations("common");
  const [minutesToAdd, setMinutesToAdd] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard handling
  const handleEscKey = useCallback(
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
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      document.addEventListener("keydown", handleEscKey);
      document.addEventListener("keydown", handleTabKey);
      document.body.style.overflow = "hidden";

      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }

    return () => {
      document.removeEventListener("keydown", handleEscKey);
      document.removeEventListener("keydown", handleTabKey);
      document.body.style.overflow = "";

      if (!isOpen && previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, handleEscKey, handleTabKey]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const minutes = Number.parseInt(minutesToAdd, 10);
    if (Number.isNaN(minutes) || minutes <= 0) {
      return;
    }
    onAddTime(minutes);
    setMinutesToAdd("");
    // Det frie felt afslutter dialogen; hurtigvalgene gør ikke, så de kan
    // klikkes flere gange i træk og lægges sammen.
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  // Quick time presets in minutes. Små spring, fordi de kan stables:
  // fire klik på +15 giver en time.
  const quickOptions = [5, 10, 15, 30].map((mins) => ({
    mins,
    label: t("addTime.plusMinutes", { mins }),
  }));

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-time-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-800 shadow-xl mx-4 animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3
            id="add-time-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {t("addTime.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            aria-label={t("addTime.closeDialog")}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Quick options */}
          {/* biome-ignore lint/a11y/useSemanticElements: gruppe med aria-label; fieldset/legend ville ændre layout og styling */}
          <div
            className="grid grid-cols-4 gap-2"
            role="group"
            aria-label={t("addTime.quickOptions")}
          >
            {quickOptions.map(({ mins, label }) => (
              <button
                key={mins}
                type="button"
                onClick={() => onAddTime(mins)}
                className="py-2.5 px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-brand-50 hover:border-brand-300 dark:hover:bg-tt-gran-lys dark:hover:border-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                aria-label={t("addTime.addMinutesAria", { mins })}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative" aria-hidden="true">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200 dark:border-gray-700" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-gray-800 px-2 text-gray-500 dark:text-gray-400">
                {t("addTime.or")}
              </span>
            </div>
          </div>

          {/* Custom input */}
          <div>
            <label
              htmlFor="minutes-input"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("addTime.minutes")}
            </label>
            <input
              ref={inputRef}
              id="minutes-input"
              type="number"
              value={minutesToAdd}
              onChange={(e) => setMinutesToAdd(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 px-3 py-2 focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
              placeholder={t("addTime.minutesPlaceholder")}
              min="1"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2.5 font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              {tc("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!minutesToAdd || Number.parseInt(minutesToAdd, 10) <= 0}
              className="flex-1 rounded-lg bg-tt-gran hover:bg-tt-gran-moerk px-4 py-2.5 font-medium text-tt-paa-gran transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              {t("addTime.add")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
