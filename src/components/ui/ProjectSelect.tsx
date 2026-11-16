"use client";

import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { currentSyncLocale } from "@/i18n/sync-text";
import { useUiText } from "./use-ui-text";

type RawProject = {
  id: string;
  name: string;
  /** null = internt projekt uden kunde (#467) */
  clientId: string | null;
  client?: { id: string; name: string } | { id: string; name: string }[] | null;
  status?: string | null;
};

type NormalizedProject = Omit<RawProject, "client"> & {
  client: { id: string; name: string } | null;
};

export interface ProjectSelectProps {
  projects: RawProject[] | undefined;
  value: string | null;
  onChange: (projectId: string | null) => void;
  clientId?: string | null;
  recentProjectIds?: string[];
  placeholder?: string;
  className?: string;
  showInactive?: boolean;
  disabled?: boolean;
  id?: string;
  alwaysIncludeValue?: boolean;
  allowClear?: boolean;
}

export function ProjectSelect({
  projects,
  value,
  onChange,
  clientId,
  recentProjectIds,
  placeholder,
  className = "",
  showInactive = false,
  disabled = false,
  id,
  alwaysIncludeValue = true,
  allowClear = true,
}: ProjectSelectProps) {
  const tUi = useUiText();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const { grouped, flat, selectedProject } = useMemo(() => {
    const normalized: NormalizedProject[] = (projects ?? []).map((p) => ({
      ...p,
      client: Array.isArray(p.client)
        ? (p.client[0] ?? null)
        : (p.client ?? null),
    }));

    let filtered = normalized.filter(
      (p) => showInactive || p.status === "active" || !p.status,
    );
    if (clientId) {
      filtered = filtered.filter((p) => p.clientId === clientId);
    }

    if (alwaysIncludeValue && value) {
      const inFiltered = filtered.some((p) => p.id === value);
      if (!inFiltered) {
        const current = normalized.find((p) => p.id === value);
        if (current) filtered = [...filtered, current];
      }
    }

    const query = search.toLowerCase();
    const searched = query
      ? filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            (p.client?.name ?? "").toLowerCase().includes(query),
        )
      : filtered;

    // Group by client
    const groups = new Map<
      string,
      { clientName: string; projects: NormalizedProject[] }
    >();
    const noClient: NormalizedProject[] = [];

    for (const p of searched) {
      const cId = p.clientId;
      if (!cId) {
        noClient.push(p);
        continue;
      }
      const cName = p.client?.name ?? tUi("project.unknownClient");
      const existing = groups.get(cId);
      if (existing) {
        existing.projects.push(p);
      } else {
        groups.set(cId, { clientName: cName, projects: [p] });
      }
    }

    for (const group of groups.values()) {
      group.projects.sort((a, b) =>
        a.name.localeCompare(b.name, currentSyncLocale()),
      );
    }
    noClient.sort((a, b) => a.name.localeCompare(b.name, currentSyncLocale()));

    const sortedGroups = Array.from(groups.entries());
    if (recentProjectIds?.length) {
      sortedGroups.sort((a, b) => {
        const aIdx = a[1].projects.reduce((best, p) => {
          const idx = recentProjectIds.indexOf(p.id);
          return idx !== -1 && (best === -1 || idx < best) ? idx : best;
        }, -1);
        const bIdx = b[1].projects.reduce((best, p) => {
          const idx = recentProjectIds.indexOf(p.id);
          return idx !== -1 && (best === -1 || idx < best) ? idx : best;
        }, -1);
        if (aIdx !== -1 && bIdx === -1) return -1;
        if (aIdx === -1 && bIdx !== -1) return 1;
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        return a[1].clientName.localeCompare(
          b[1].clientName,
          currentSyncLocale(),
        );
      });
    } else {
      sortedGroups.sort((a, b) =>
        a[1].clientName.localeCompare(b[1].clientName, currentSyncLocale()),
      );
    }

    const selected = value
      ? (normalized.find((p) => p.id === value) ?? null)
      : null;

    return {
      grouped: { groups: sortedGroups, noClient },
      flat: searched,
      selectedProject: selected,
    };
  }, [
    projects,
    clientId,
    showInactive,
    recentProjectIds,
    value,
    alwaysIncludeValue,
    search,
    tUi,
  ]);

  const recentProjects = useMemo(() => {
    if (!recentProjectIds?.length) return [];
    return recentProjectIds
      .map((rpId) => flat.find((p) => p.id === rpId))
      .filter(Boolean) as NormalizedProject[];
  }, [recentProjectIds, flat]);

  const isSingleClient = !!clientId && grouped.groups.length <= 1;
  const hasResults = grouped.groups.length > 0 || grouped.noClient.length > 0;

  const select = (projectId: string | null) => {
    onChange(projectId);
    setOpen(false);
    setSearch("");
    setHighlight(-1);
  };

  // Flat option list in render order, for keyboard navigation. Recent items
  // can duplicate grouped items, so each visible entry gets its own key.
  const visibleOptions: Array<{ id: string | null; key: string }> = [];
  if (allowClear) visibleOptions.push({ id: null, key: "clear" });
  if (recentProjects.length > 0 && !search) {
    for (const p of recentProjects.slice(0, 5)) {
      visibleOptions.push({ id: p.id, key: `recent-${p.id}` });
    }
  }
  if (isSingleClient) {
    for (const p of grouped.groups[0]?.[1].projects ?? []) {
      visibleOptions.push({ id: p.id, key: p.id });
    }
  } else {
    for (const [, group] of grouped.groups) {
      for (const p of group.projects) {
        visibleOptions.push({ id: p.id, key: p.id });
      }
    }
  }
  for (const p of grouped.noClient) {
    visibleOptions.push({ id: p.id, key: p.id });
  }
  const indexByKey = new Map(visibleOptions.map((o, i) => [o.key, i]));

  // Fresh highlight every time the dropdown opens
  useEffect(() => {
    if (open) setHighlight(-1);
  }, [open]);

  // Keep the highlighted option visible while arrowing through the list
  useEffect(() => {
    if (highlight < 0) return;
    containerRef.current
      ?.querySelector(`[data-option-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, visibleOptions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // No explicit highlight: pick the top search hit (skip the clear option)
      const option =
        visibleOptions[highlight] ??
        (search ? visibleOptions.find((o) => o.id !== null) : undefined);
      if (option) select(option.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setSearch("");
      setHighlight(-1);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} id={id}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        onClick={() => !disabled && setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open && !disabled) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        disabled={disabled}
        className="flex w-full items-center justify-between rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-left text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none disabled:opacity-50"
      >
        <span
          className={`truncate ${!selectedProject ? "text-gray-400 dark:text-gray-500" : ""}`}
        >
          {selectedProject
            ? isSingleClient
              ? selectedProject.name
              : selectedProject.client?.name
                ? `${selectedProject.client.name}: ${selectedProject.name}`
                : selectedProject.name
            : (placeholder ?? tUi("project.placeholder"))}
        </span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[240px] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
          {/* Search */}
          <div className="flex items-center border-b border-gray-200 dark:border-gray-600 px-3">
            <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setHighlight(-1);
              }}
              onKeyDown={handleInputKeyDown}
              aria-activedescendant={
                highlight >= 0 ? `${listboxId}-opt-${highlight}` : undefined
              }
              placeholder={tUi("project.searchPlaceholder")}
              className="w-full bg-transparent px-2 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
              // biome-ignore lint/a11y/noAutofocus: search should focus on open
              autoFocus
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="p-0.5 text-gray-400 hover:text-gray-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Options */}
          <div
            id={listboxId}
            role="listbox"
            aria-label={tUi("project.listLabel")}
            className="max-h-64 overflow-y-auto p-1"
          >
            {/* Clear option */}
            {allowClear && (
              <button
                id={`${listboxId}-opt-0`}
                data-option-index={0}
                type="button"
                onClick={() => select(null)}
                onMouseEnter={() => setHighlight(0)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 ${
                  highlight === 0 ? "bg-brand-50 dark:bg-gray-700" : ""
                }`}
              >
                <span className="italic">{tUi("project.none")}</span>
                {!value && (
                  <Check className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                )}
              </button>
            )}

            {/* Recent section */}
            {recentProjects.length > 0 && !search && (
              <>
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {tUi("project.recent")}
                </p>
                {recentProjects.slice(0, 5).map((p) => {
                  const idx = indexByKey.get(`recent-${p.id}`) ?? -1;
                  return (
                    <ProjectOption
                      key={`recent-${p.id}`}
                      project={p}
                      isSelected={p.id === value}
                      showClient={!isSingleClient}
                      onSelect={() => select(p.id)}
                      index={idx}
                      highlighted={highlight === idx}
                      onHover={setHighlight}
                      listboxId={listboxId}
                    />
                  );
                })}
              </>
            )}

            {/* Grouped by client */}
            {!hasResults && (
              <p className="px-3 py-2 text-sm text-gray-500">
                {tUi("project.empty")}
              </p>
            )}

            {isSingleClient ? (
              // Flat list for single client
              <>
                {grouped.groups[0]?.[1].projects.map((p) => {
                  const idx = indexByKey.get(p.id) ?? -1;
                  return (
                    <ProjectOption
                      key={p.id}
                      project={p}
                      isSelected={p.id === value}
                      showClient={false}
                      onSelect={() => select(p.id)}
                      index={idx}
                      highlighted={highlight === idx}
                      onHover={setHighlight}
                      listboxId={listboxId}
                    />
                  );
                })}
                {grouped.noClient.map((p) => {
                  const idx = indexByKey.get(p.id) ?? -1;
                  return (
                    <ProjectOption
                      key={p.id}
                      project={p}
                      isSelected={p.id === value}
                      showClient={false}
                      onSelect={() => select(p.id)}
                      index={idx}
                      highlighted={highlight === idx}
                      onHover={setHighlight}
                      listboxId={listboxId}
                    />
                  );
                })}
              </>
            ) : (
              <>
                {grouped.groups.map(([cId, group]) => (
                  <div key={cId}>
                    <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      {group.clientName}
                    </p>
                    {group.projects.map((p) => {
                      const idx = indexByKey.get(p.id) ?? -1;
                      return (
                        <ProjectOption
                          key={p.id}
                          project={p}
                          isSelected={p.id === value}
                          showClient={false}
                          onSelect={() => select(p.id)}
                          index={idx}
                          highlighted={highlight === idx}
                          onHover={setHighlight}
                          listboxId={listboxId}
                        />
                      );
                    })}
                  </div>
                ))}
                {grouped.noClient.length > 0 && (
                  <div>
                    <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      {tUi("project.noClient")}
                    </p>
                    {grouped.noClient.map((p) => {
                      const idx = indexByKey.get(p.id) ?? -1;
                      return (
                        <ProjectOption
                          key={p.id}
                          project={p}
                          isSelected={p.id === value}
                          showClient={false}
                          onSelect={() => select(p.id)}
                          index={idx}
                          highlighted={highlight === idx}
                          onHover={setHighlight}
                          listboxId={listboxId}
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectOption({
  project,
  isSelected,
  showClient,
  onSelect,
  index,
  highlighted,
  onHover,
  listboxId,
}: {
  project: NormalizedProject;
  isSelected: boolean;
  showClient: boolean;
  onSelect: () => void;
  index: number;
  highlighted: boolean;
  onHover: (index: number) => void;
  listboxId: string;
}) {
  return (
    <button
      id={`${listboxId}-opt-${index}`}
      data-option-index={index}
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      onMouseEnter={() => onHover(index)}
      className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm ${
        highlighted ? "bg-brand-50 dark:bg-gray-700" : ""
      } ${
        isSelected
          ? "text-brand-700 dark:text-brand-400 bg-brand-50/50 dark:bg-tt-gran-lys"
          : "text-gray-900 dark:text-white"
      }`}
    >
      <span className="truncate">
        {project.name}
        {showClient && project.client && (
          <span className="ml-1.5 text-xs text-gray-400">
            {project.client.name}
          </span>
        )}
      </span>
      {isSelected && (
        <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
      )}
    </button>
  );
}
