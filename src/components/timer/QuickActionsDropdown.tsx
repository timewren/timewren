"use client";

import {
  ChevronRight,
  Clock,
  Folder,
  History,
  Plus,
  Star,
  X,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc-provider";

interface QuickActionsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTimer: (options: {
    projectId: string | null;
    clientId: string | null;
    description: string;
    templateId?: string;
  }) => void;
  onCreateTemplate: () => void;
}

type Tab = "recent" | "favorites" | "templates";

export function QuickActionsDropdown({
  isOpen,
  onClose,
  onStartTimer,
  onCreateTemplate,
}: QuickActionsDropdownProps) {
  const t = useTranslations("timer");
  const [activeTab, setActiveTab] = useState<Tab>("recent");
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
    if (isOpen) {
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
  }, [isOpen, handleKeyDown, handleTabKey]);

  // Fetch data
  const { data: recentTasks } = trpc.time.getRecent.useQuery(
    { limit: 5 },
    { enabled: isOpen },
  );
  const { data: templates } = trpc.timerTemplates.list.useQuery(undefined, {
    enabled: isOpen,
  });
  const { data: favoriteTemplates } = trpc.timerTemplates.list.useQuery(
    { favoritesOnly: true },
    { enabled: isOpen },
  );

  const recordUsage = trpc.timerTemplates.recordUsage.useMutation();

  if (!isOpen) return null;

  const handleStartFromRecent = (task: {
    projectId: string | null;
    clientId: string | null;
    description: string;
  }) => {
    onStartTimer({
      projectId: task.projectId,
      clientId: task.clientId,
      description: task.description,
    });
  };

  const handleStartFromTemplate = (template: {
    id: string;
    projectId: string | null;
    clientId: string | null;
    description: string | null;
  }) => {
    // Record usage in background
    recordUsage.mutate({ id: template.id });
    onStartTimer({
      projectId: template.projectId,
      clientId: template.clientId,
      description: template.description || "",
      templateId: template.id,
    });
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: "recent",
      label: t("quickActions.tabRecent"),
      icon: <History className="h-4 w-4" />,
    },
    {
      id: "favorites",
      label: t("quickActions.tabFavorites"),
      icon: <Star className="h-4 w-4" />,
    },
    {
      id: "templates",
      label: t("quickActions.tabTemplates"),
      icon: <Zap className="h-4 w-4" />,
    },
  ];

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 sm:pt-24 bg-black/50 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-actions-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-xl mx-4 animate-in zoom-in-95 slide-in-from-top-4 duration-200 max-h-[70vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <Zap
              className="h-5 w-5 text-brand-600 dark:text-brand-400"
              aria-hidden="true"
            />
            <h2
              id="quick-actions-title"
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              {t("quickActions.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            aria-label={t("quickActions.closeDialog")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-brand-600 dark:text-brand-400 border-b-2 border-brand-600 dark:border-brand-400 -mb-px"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Recent Tasks */}
          {activeTab === "recent" && (
            <div className="space-y-2">
              {recentTasks && recentTasks.length > 0 ? (
                recentTasks.map((task, index) => (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                    key={`${task.projectId || ""}-${task.clientId || ""}-${task.description}-${index}`}
                    type="button"
                    onClick={() => handleStartFromRecent(task)}
                    className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-brand-300 dark:hover:border-brand-600 group"
                  >
                    <div className="flex-shrink-0 p-2 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover:bg-brand-100 dark:group-hover:bg-tt-gran-lys transition-colors">
                      <Clock className="h-4 w-4 text-gray-600 dark:text-gray-400 group-hover:text-brand-600 dark:group-hover:text-brand-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white truncate">
                        {task.description || t("common.noDescription")}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {task.clientName}
                        {task.projectName && ` → ${task.projectName}`}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-brand-600 dark:group-hover:text-brand-400 shrink-0" />
                  </button>
                ))
              ) : (
                <div className="text-center py-8">
                  <History className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("quickActions.emptyRecent")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Favorites */}
          {activeTab === "favorites" && (
            <div className="space-y-2">
              {favoriteTemplates && favoriteTemplates.length > 0 ? (
                favoriteTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleStartFromTemplate(template)}
                    className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-yellow-300 dark:hover:border-yellow-600 group"
                  >
                    <div
                      className="flex-shrink-0 p-2 rounded-lg transition-colors"
                      style={{ backgroundColor: `${template.color}20` }}
                    >
                      <Star
                        className="h-4 w-4"
                        style={{ color: template.color || "#3b82f6" }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white truncate">
                        {template.name}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {(() => {
                          const proj = Array.isArray(template.project)
                            ? template.project[0]
                            : template.project;
                          const cli = Array.isArray(template.client)
                            ? template.client[0]
                            : template.client;
                          const projClient = proj?.client
                            ? Array.isArray(proj.client)
                              ? proj.client[0]
                              : proj.client
                            : null;
                          return `${cli?.name || projClient?.name || ""}${proj?.name ? ` → ${proj.name}` : ""}`;
                        })()}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-yellow-600 dark:group-hover:text-yellow-400 shrink-0" />
                  </button>
                ))
              ) : (
                <div className="text-center py-8">
                  <Star className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("quickActions.emptyFavorites")}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {t("quickActions.emptyFavoritesHint")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Templates */}
          {activeTab === "templates" && (
            <div className="space-y-2">
              {templates && templates.length > 0 ? (
                templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleStartFromTemplate(template)}
                    className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-brand-300 dark:hover:border-brand-600 group"
                  >
                    <div
                      className="flex-shrink-0 p-2 rounded-lg transition-colors"
                      style={{ backgroundColor: `${template.color}20` }}
                    >
                      <Folder
                        className="h-4 w-4"
                        style={{ color: template.color || "#3b82f6" }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 dark:text-white truncate">
                          {template.name}
                        </p>
                        {template.isFavorite && (
                          <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 shrink-0" />
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {(() => {
                          const proj = Array.isArray(template.project)
                            ? template.project[0]
                            : template.project;
                          const cli = Array.isArray(template.client)
                            ? template.client[0]
                            : template.client;
                          const projClient = proj?.client
                            ? Array.isArray(proj.client)
                              ? proj.client[0]
                              : proj.client
                            : null;
                          return `${cli?.name || projClient?.name || ""}${proj?.name ? ` → ${proj.name}` : ""}`;
                        })()}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-brand-600 dark:group-hover:text-brand-400 shrink-0" />
                  </button>
                ))
              ) : (
                <div className="text-center py-8">
                  <Zap className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("quickActions.emptyTemplates")}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {t("quickActions.emptyTemplatesHint")}
                  </p>
                </div>
              )}

              {/* Create Template Button */}
              <button
                type="button"
                onClick={onCreateTemplate}
                className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 p-3 text-sm font-medium text-gray-600 dark:text-gray-400 transition-colors hover:border-brand-400 dark:hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-tt-gran-lys"
              >
                <Plus className="h-4 w-4" />
                {t("quickActions.createTemplate")}
              </button>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {t("quickActions.footerHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
