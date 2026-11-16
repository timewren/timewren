"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { goToShortcuts } from "@/components/dashboard-nav";

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{
    keys: string[];
    description: string;
  }>;
}

export function KeyboardShortcutsModal() {
  const t = useTranslations("shell.shortcuts");
  const tNav = useTranslations("nav");
  const [isOpen, setIsOpen] = useState(false);

  const shortcutGroups: ShortcutGroup[] = [
    {
      title: t("groupNavigation"),
      // Samme tabel som tastaturhåndteringen i DashboardShell
      shortcuts: goToShortcuts.map((s) => ({
        keys: ["G", s.key.toUpperCase()],
        description: t("goTo", {
          label: s.labelKey ? tNav(s.labelKey) : s.label,
        }),
      })),
    },
    {
      title: t("groupQuick"),
      shortcuts: [
        { keys: ["⌘/Ctrl", "K"], description: t("openPalette") },
        { keys: ["N"], description: t("createNew") },
        { keys: ["/"], description: t("focusSearch") },
        { keys: ["?"], description: t("showShortcuts") },
      ],
    },
    {
      title: t("groupTimer"),
      shortcuts: [
        { keys: ["T"], description: t("timerToggle") },
        { keys: ["Shift", "T"], description: t("timerPause") },
        { keys: ["F"], description: t("focusMode") },
      ],
    },
    {
      title: t("groupGeneral"),
      shortcuts: [
        { keys: ["Esc"], description: t("closeDialog") },
        { keys: ["↑", "↓"], description: t("navigateLists") },
        { keys: ["Enter"], description: t("confirm") },
      ],
    },
  ];

  useEffect(() => {
    const handleShowShortcuts = () => setIsOpen(true);
    window.addEventListener("show-keyboard-shortcuts", handleShowShortcuts);
    return () =>
      window.removeEventListener(
        "show-keyboard-shortcuts",
        handleShowShortcuts,
      );
  }, []);

  useEffect(() => {
    if (isOpen) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setIsOpen(false);
        }
      };
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
        aria-label={t("close")}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 px-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t("title")}
            </h2>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="max-h-[60vh] overflow-y-auto p-6">
            <div className="grid gap-6 md:grid-cols-2">
              {shortcutGroups.map((group) => (
                <div key={group.title}>
                  <h3 className="mb-3 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {group.title}
                  </h3>
                  <div className="space-y-2">
                    {group.shortcuts.map((shortcut) => (
                      <div
                        key={shortcut.description}
                        className="flex items-center justify-between gap-4"
                      >
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {shortcut.description}
                        </span>
                        <div className="flex items-center gap-1">
                          {shortcut.keys.map((key, index) => (
                            <span key={key}>
                              <kbd className="inline-flex min-w-[24px] items-center justify-center rounded bg-gray-100 dark:bg-gray-700 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-300 shadow-sm">
                                {key}
                              </kbd>
                              {index < shortcut.keys.length - 1 && (
                                <span className="mx-1 text-gray-400">+</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-6 py-3 rounded-b-xl">
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              {t.rich("footerHint", {
                kbd: (chunks) => (
                  <kbd className="rounded bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 text-xs font-semibold">
                    {chunks}
                  </kbd>
                ),
              })}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
