"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

interface Client {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  /** null = internt projekt uden kunde (#467) */
  clientId: string | null;
}

interface ProjectSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProject: (projectId: string | null, clientId: string | null) => void;
  onSelectClientOnly: (clientId: string) => void;
  clients: Client[] | undefined;
  projects: Project[] | undefined;
  selectedProjectId: string | null;
  selectedClientId: string | null;
  /** Client IDs ordered by recent usage (most recent first) */
  recentClientIds?: string[];
}

export function ClientProjectSelectModal({
  isOpen,
  onClose,
  onSelectProject,
  onSelectClientOnly,
  clients,
  projects,
  selectedProjectId,
  selectedClientId,
  recentClientIds,
}: ProjectSelectModalProps) {
  const t = useTranslations("timer");
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const [search, setSearch] = useState("");

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

  if (!isOpen) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-select-title"
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
            id="project-select-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {t("projectSelect.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            aria-label={t("projectSelect.closeDialog")}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-4">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
              aria-hidden="true"
            />
            <input
              type="text"
              // biome-ignore lint/a11y/noAutofocus: search field should be focused when modal opens
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("projectSelect.searchPlaceholder")}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-9 pr-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Content */}
        <div
          className="p-4 space-y-3 max-h-96 overflow-y-auto"
          role="tree"
          aria-label={t("projectSelect.treeLabel")}
        >
          {clients
            ?.filter((client) => {
              const query = search.toLowerCase();
              if (!query) return true;
              const clientMatch = client.name.toLowerCase().includes(query);
              const hasMatchingProject = projects?.some(
                (p) =>
                  p.clientId === client.id &&
                  p.name.toLowerCase().includes(query),
              );
              return clientMatch || hasMatchingProject;
            })
            .toSorted((a, b) => {
              if (!recentClientIds?.length) return 0;
              const aIdx = recentClientIds.indexOf(a.id);
              const bIdx = recentClientIds.indexOf(b.id);
              // Clients not in recent list go to the end
              const aRank = aIdx === -1 ? recentClientIds.length : aIdx;
              const bRank = bIdx === -1 ? recentClientIds.length : bIdx;
              return aRank - bRank;
            })
            .map((client) => {
              const query = search.toLowerCase();
              const clientProjects = projects?.filter(
                (p) =>
                  p.clientId === client.id &&
                  (!query ||
                    client.name.toLowerCase().includes(query) ||
                    p.name.toLowerCase().includes(query)),
              );

              return (
                <div
                  key={client.id}
                  className="space-y-2"
                  role="treeitem"
                  tabIndex={-1}
                  aria-expanded={true}
                >
                  {/* Client-only option */}
                  <button
                    type="button"
                    onClick={() => onSelectClientOnly(client.id)}
                    data-testid="timer-pick-client"
                    className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                      selectedClientId === client.id && !selectedProjectId
                        ? "border-brand-500 dark:border-brand-400 bg-brand-50 dark:bg-tt-gran-lys"
                        : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                    aria-pressed={
                      selectedClientId === client.id && !selectedProjectId
                    }
                  >
                    <div className="font-medium text-gray-900 dark:text-white">
                      {client.name}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {t("projectSelect.clientOnly")}
                    </div>
                  </button>

                  {/* Projects under this client */}
                  {clientProjects && clientProjects.length > 0 && (
                    // biome-ignore lint/a11y/useSemanticElements: gruppe med aria-label; fieldset/legend ville ændre layout og styling
                    <div className="ml-4 space-y-2" role="group">
                      {clientProjects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => onSelectProject(project.id, client.id)}
                          className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                            selectedProjectId === project.id
                              ? "border-brand-500 dark:border-brand-400 bg-brand-50 dark:bg-tt-gran-lys"
                              : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                          }`}
                          aria-pressed={selectedProjectId === project.id}
                        >
                          <div className="font-medium text-gray-900 dark:text-white">
                            {project.name}
                          </div>
                          {project.description && (
                            <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                              {project.description}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

          {/* Interne projekter uden kunde (#467) — ellers uopnåelige her */}
          {(() => {
            const query = search.toLowerCase();
            const internal =
              projects?.filter(
                (p) =>
                  p.clientId === null &&
                  (!query || p.name.toLowerCase().includes(query)),
              ) ?? [];
            if (internal.length === 0) return null;
            return (
              <div className="space-y-2">
                <div className="px-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("projectSelect.internal")}
                </div>
                <div className="ml-4 space-y-2">
                  {internal.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => onSelectProject(project.id, null)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                        selectedProjectId === project.id
                          ? "border-brand-500 dark:border-brand-400 bg-brand-50 dark:bg-tt-gran-lys"
                          : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                      }`}
                    >
                      <div className="font-medium text-gray-900 dark:text-white">
                        {project.name}
                      </div>
                      {project.description && (
                        <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                          {project.description}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {(!clients || clients.length === 0) && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <p>{t("projectSelect.noClients")}</p>
              <p className="text-sm mt-1">
                {t("projectSelect.createClientFirst")}
              </p>
            </div>
          )}

          {clients &&
            clients.length > 0 &&
            search &&
            clients.filter((client) => {
              const query = search.toLowerCase();
              const clientMatch = client.name.toLowerCase().includes(query);
              const hasMatchingProject = projects?.some(
                (p) =>
                  p.clientId === client.id &&
                  p.name.toLowerCase().includes(query),
              );
              return clientMatch || hasMatchingProject;
            }).length === 0 && (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <p>{t("projectSelect.noResults", { query: search })}</p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
