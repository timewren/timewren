import { Building2, Clock, Folder, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type { Client, Project } from "../../types";

interface ProjectSelectProps {
  projects: Project[];
  clients: Client[];
  selectedProjectId: string | null;
  onSelect: (projectId: string | null, clientId: string | null) => void;
  onClose: () => void;
}

/** Load recent project IDs from chrome.storage.local */
async function loadRecentProjectIds(): Promise<string[]> {
  try {
    const result = await chrome.storage.local.get(["recentProjectIds"]);
    return (result.recentProjectIds as string[]) || [];
  } catch {
    return [];
  }
}

/** Save a project ID to recent list (max 5, most recent first) */
async function saveRecentProjectId(projectId: string): Promise<void> {
  try {
    const ids = await loadRecentProjectIds();
    const updated = [projectId, ...ids.filter((id) => id !== projectId)].slice(
      0,
      5,
    );
    await chrome.storage.local.set({ recentProjectIds: updated });
  } catch {
    // Ignore storage errors
  }
}

export function ProjectSelect({
  projects,
  clients,
  selectedProjectId,
  onSelect,
  onClose,
}: ProjectSelectProps) {
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load recent project IDs on mount
  useEffect(() => {
    loadRecentProjectIds().then(setRecentIds);
  }, []);

  // Auto-focus search on open
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Group projects by client
  const groupedProjects = useMemo(() => {
    const activeProjects = projects.filter((p) => p.status === "active");
    const filtered = search
      ? activeProjects.filter(
          (p) =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.clientName.toLowerCase().includes(search.toLowerCase()),
        )
      : activeProjects;

    const groups: Record<
      string,
      { client: Client | undefined; projects: Project[] }
    > = {};

    for (const project of filtered) {
      if (!groups[project.clientId]) {
        groups[project.clientId] = {
          client: clients.find((c) => c.id === project.clientId),
          projects: [],
        };
      }
      groups[project.clientId].projects.push(project);
    }

    return Object.values(groups).sort((a, b) =>
      (a.client?.name || "").localeCompare(b.client?.name || ""),
    );
  }, [projects, clients, search]);

  // Recent projects (only when not searching)
  const recentProjects = useMemo(() => {
    if (search) return [];
    return recentIds
      .map((id) => projects.find((p) => p.id === id && p.status === "active"))
      .filter((p): p is Project => !!p);
  }, [recentIds, projects, search]);

  // Build flat list of selectable items for keyboard navigation
  const flatItems = useMemo(() => {
    const items: Array<{ projectId: string | null; clientId: string | null }> =
      [];

    // "No project" option (only without search)
    if (!search) {
      items.push({ projectId: null, clientId: null });
    }

    // Recent projects
    for (const project of recentProjects) {
      items.push({ projectId: project.id, clientId: project.clientId });
    }

    // Grouped projects (skip if already in recents)
    const recentIdSet = new Set(recentProjects.map((p) => p.id));
    for (const group of groupedProjects) {
      for (const project of group.projects) {
        if (!recentIdSet.has(project.id)) {
          items.push({ projectId: project.id, clientId: project.clientId });
        }
      }
    }

    return items;
  }, [search, recentProjects, groupedProjects]);

  // Reset highlight when search changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: search er en udløser: markeringen nulstilles, når søgningen ændres
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [search]);

  const handleSelect = useCallback(
    (projectId: string | null, clientId: string | null) => {
      if (projectId) {
        saveRecentProjectId(projectId);
      }
      onSelect(projectId, clientId);
    },
    [onSelect],
  );

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0) return;
    const item = listRef.current?.querySelector(
      `[data-index="${highlightedIndex}"]`,
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < flatItems.length - 1 ? prev + 1 : 0,
        );
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : flatItems.length - 1,
        );
        return;
      }

      if (e.key === "Enter" && highlightedIndex >= 0) {
        e.preventDefault();
        const item = flatItems[highlightedIndex];
        handleSelect(item.projectId, item.clientId);
      }
    },
    [flatItems, highlightedIndex, handleSelect, onClose],
  );

  // Compute data-index for each item
  let itemIndex = 0;
  const getNextIndex = () => itemIndex++;

  // Track which recent IDs are rendered so we can skip them in grouped
  const recentIdSet = new Set(recentProjects.map((p) => p.id));

  return (
    <div
      className="fixed inset-0 bg-[var(--color-surface-overlay)] z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("select.project.title")}
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full bg-[var(--color-surface-elevated)] rounded-t-2xl max-h-[80%] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t("select.project.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-lg"
            aria-label={t("select.close")}
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-[var(--color-border-default)]">
          <div className="relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("select.project.searchPlaceholder")}
              className="w-full pl-10 pr-4 py-2 border border-[var(--color-border-default)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 placeholder:text-[var(--color-text-muted)]"
            />
          </div>
        </div>

        {/* Project List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {/* No project option */}
          {!search &&
            (() => {
              const idx = getNextIndex();
              return (
                <button
                  type="button"
                  data-index={idx}
                  onClick={() => handleSelect(null, null)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors mb-2 ${
                    highlightedIndex === idx
                      ? "bg-primary-50 ring-1 ring-primary-300"
                      : selectedProjectId === null
                        ? "bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]"
                        : "hover:bg-[var(--color-surface-sunken)]"
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full ${
                      selectedProjectId === null
                        ? "bg-[var(--color-text-tertiary)]"
                        : "bg-[var(--color-text-muted)]"
                    }`}
                  />
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {t("select.project.none")}
                  </p>
                </button>
              );
            })()}

          {/* Recent Projects */}
          {recentProjects.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)]">
                <Clock size={14} />
                {t("select.recent")}
              </div>
              {recentProjects.map((project) => {
                const idx = getNextIndex();
                return (
                  <button
                    type="button"
                    key={`recent-${project.id}`}
                    data-index={idx}
                    onClick={() => handleSelect(project.id, project.clientId)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      highlightedIndex === idx
                        ? "bg-primary-50 ring-1 ring-primary-300"
                        : project.id === selectedProjectId
                          ? "bg-primary-50 text-primary-700"
                          : "hover:bg-[var(--color-surface-sunken)]"
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${
                        project.id === selectedProjectId
                          ? "bg-primary-500"
                          : "bg-[var(--color-text-muted)]"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {project.name}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                        {project.clientName}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {groupedProjects.length === 0 && search ? (
            <div className="text-center py-8 text-[var(--color-text-tertiary)]">
              <Folder size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t("select.project.notFound")}</p>
            </div>
          ) : (
            groupedProjects.map(({ client, projects: clientProjects }) => {
              // Filter out projects already shown in recents
              const filtered = clientProjects.filter(
                (p) => !recentIdSet.has(p.id),
              );
              if (filtered.length === 0) return null;

              return (
                <div key={client?.id || "unknown"} className="mb-4">
                  {/* Client Header */}
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)]">
                    <Building2 size={14} />
                    {client?.name || t("select.project.unknownClient")}
                  </div>

                  {/* Projects */}
                  {filtered.map((project) => {
                    const idx = getNextIndex();
                    return (
                      <button
                        type="button"
                        key={project.id}
                        data-index={idx}
                        onClick={() =>
                          handleSelect(project.id, project.clientId)
                        }
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                          highlightedIndex === idx
                            ? "bg-primary-50 ring-1 ring-primary-300"
                            : project.id === selectedProjectId
                              ? "bg-primary-50 text-primary-700"
                              : "hover:bg-[var(--color-surface-sunken)]"
                        }`}
                      >
                        <div
                          className={`w-2 h-2 rounded-full ${
                            project.id === selectedProjectId
                              ? "bg-primary-500"
                              : "bg-[var(--color-text-muted)]"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {project.name}
                          </p>
                          {project.hourlyRate && (
                            <p className="text-xs text-[var(--color-text-tertiary)]">
                              {t("select.project.rate", {
                                rate: project.hourlyRate,
                              })}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
