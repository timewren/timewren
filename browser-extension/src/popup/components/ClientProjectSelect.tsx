import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronRight,
  ExternalLink,
  Folder,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { apiClient } from "../../api/client";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useT } from "../../i18n";
import { userErrorMessage } from "../../lib/api-error";
import { formatHourlyRate } from "../../lib/format-hours";
import { useWebAppLink, WEB_PATHS } from "../../lib/web-links";
import { useAuthStore } from "../../stores/authStore";
import type { Client, Project } from "../../types";

interface ClientProjectSelectProps {
  clients: Client[];
  projects: Project[];
  selectedProjectId: string | null;
  selectedClientId: string | null;
  onSelect: (projectId: string | null, clientId: string | null) => void;
  onClose: () => void;
}

export function ClientProjectSelect({
  clients,
  projects,
  selectedProjectId,
  selectedClientId,
  onSelect,
  onClose,
}: ClientProjectSelectProps) {
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const newClientUrl = useWebAppLink(WEB_PATHS.newClient);
  const dialogRef = useModalDialog(onClose);
  const listId = useId();
  const optionId = (idx: number) => `${listId}-valg-${idx}`;
  // Listen styres med piletaster fra søgefeltet (aria-activedescendant), så
  // valgmulighederne er ikke selv i Tab-rækkefølgen.
  const optionProps = (idx: number, isSelected: boolean) => ({
    role: "option" as const,
    id: optionId(idx),
    "aria-selected": isSelected,
    tabIndex: -1,
    "data-index": idx,
  });
  const selectedMark = (
    <Check
      size={16}
      className="ml-auto text-primary-600 flex-shrink-0"
      aria-hidden="true"
    />
  );

  // Listen kommer fra kalderen; samme query (deler cache) giver status, så
  // "indlæser", "fejl" og "ingen kunder" kan skelnes.
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const listQuery = useQuery({
    queryKey: ["projectsAndClients", selectedOrgId],
    queryFn: apiClient.getProjectsAndClients,
    staleTime: 1000 * 60 * 5,
    enabled: orgsLoaded,
  });
  const listLoading =
    clients.length === 0 && (listQuery.isLoading || !orgsLoaded);
  const listError = clients.length === 0 && listQuery.isError;

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === "active"),
    [projects],
  );

  // Sort clients by timeEntryCount (most used first)
  const sortedClients = useMemo(() => {
    return [...clients].sort(
      (a, b) => (b.timeEntryCount ?? 0) - (a.timeEntryCount ?? 0),
    );
  }, [clients]);

  // Filter by search
  const filteredClients = useMemo(() => {
    if (!search) return sortedClients;
    const query = search.toLowerCase();
    return sortedClients.filter((client) => {
      const clientMatch =
        client.name.toLowerCase().includes(query) ||
        client.company?.toLowerCase().includes(query);
      const hasMatchingProject = activeProjects.some(
        (p) => p.clientId === client.id && p.name.toLowerCase().includes(query),
      );
      return clientMatch || hasMatchingProject;
    });
  }, [sortedClients, activeProjects, search]);

  // Split into frequent and other (only when not searching)
  const { frequentClients, otherClients } = useMemo(() => {
    if (search) {
      return { frequentClients: [], otherClients: filteredClients };
    }
    const frequent = filteredClients.filter((c) => (c.timeEntryCount ?? 0) > 0);
    const others = filteredClients.filter((c) => (c.timeEntryCount ?? 0) === 0);
    return { frequentClients: frequent, otherClients: others };
  }, [filteredClients, search]);

  // Get projects for a client
  const getClientProjects = useCallback(
    (clientId: string) => {
      const clientProjects = activeProjects.filter(
        (p) => p.clientId === clientId,
      );
      if (!search) return clientProjects;
      const query = search.toLowerCase();
      // If client name matches search, show all its projects
      const client = clients.find((c) => c.id === clientId);
      if (
        client?.name.toLowerCase().includes(query) ||
        client?.company?.toLowerCase().includes(query)
      ) {
        return clientProjects;
      }
      // Otherwise only show matching projects
      return clientProjects.filter((p) => p.name.toLowerCase().includes(query));
    },
    [activeProjects, clients, search],
  );

  // Build flat list for keyboard navigation
  // Each item is either a client-only selection or a project selection
  type FlatItem =
    | { type: "clear" }
    | { type: "client"; clientId: string }
    | { type: "project"; projectId: string; clientId: string };

  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];

    // "Clear selection" option when not searching
    if (!search) {
      items.push({ type: "clear" });
    }

    const addClientItems = (clientList: Client[]) => {
      for (const client of clientList) {
        const clientProjects = getClientProjects(client.id);
        if (clientProjects.length === 1) {
          // Auto-select: show as single item
          items.push({
            type: "project",
            projectId: clientProjects[0].id,
            clientId: client.id,
          });
        } else {
          // Client-only option
          items.push({ type: "client", clientId: client.id });
          // Then each project
          for (const project of clientProjects) {
            items.push({
              type: "project",
              projectId: project.id,
              clientId: client.id,
            });
          }
        }
      }
    };

    if (search) {
      addClientItems(otherClients);
    } else {
      addClientItems(frequentClients);
      addClientItems(otherClients);
    }

    return items;
  }, [search, frequentClients, otherClients, getClientProjects]);

  // Reset highlight when search changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: search er en udløser: markeringen nulstilles, når søgningen ændres
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [search]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0) return;
    const item = listRef.current?.querySelector(
      `[data-index="${highlightedIndex}"]`,
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const handleItemSelect = useCallback(
    (item: FlatItem) => {
      if (item.type === "clear") {
        onSelect(null, null);
      } else if (item.type === "client") {
        onSelect(null, item.clientId);
      } else {
        onSelect(item.projectId, item.clientId);
      }
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Esc lukker via useModalDialog
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
      if (e.key === "Enter") {
        // Fokus på en knap i listen: knappen vælger selv
        if (highlightedIndex < 0 && e.target !== searchRef.current) return;
        // Skriv-og-Enter vælger første træf, også uden piletaster
        const item =
          highlightedIndex >= 0
            ? flatItems[highlightedIndex]
            : search
              ? flatItems[0]
              : undefined;
        if (!item) return;
        e.preventDefault();
        handleItemSelect(item);
      }
    },
    [flatItems, highlightedIndex, handleItemSelect, search],
  );

  let itemIndex = 0;
  const getNextIndex = () => itemIndex++;

  const renderClientGroup = (client: Client) => {
    const clientProjects = getClientProjects(client.id);
    const isSelectedClient =
      selectedClientId === client.id && !selectedProjectId;

    // Auto-select: if client has exactly 1 project, show as single combined item
    if (clientProjects.length === 1) {
      const project = clientProjects[0];
      const idx = getNextIndex();
      const isSelected = selectedProjectId === project.id;

      return (
        <button
          key={client.id}
          type="button"
          {...optionProps(idx, isSelected)}
          onClick={() => onSelect(project.id, client.id)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
            highlightedIndex === idx
              ? "bg-primary-50 ring-2 ring-primary-600"
              : isSelected
                ? "bg-primary-50 text-primary-700"
                : "hover:bg-[var(--color-surface-sunken)]"
          }`}
        >
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              highlightedIndex === idx || isSelected
                ? "bg-primary-100"
                : "bg-[var(--color-surface-sunken)]"
            }`}
          >
            <Building2
              size={16}
              className={
                highlightedIndex === idx || isSelected
                  ? "text-primary-600"
                  : "text-[var(--color-text-tertiary)]"
              }
            />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={`text-sm text-[var(--color-text-primary)] truncate ${
                isSelected ? "font-semibold" : "font-medium"
              }`}
            >
              {client.name}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] truncate">
              {project.name}
            </p>
          </div>
          {isSelected && selectedMark}
        </button>
      );
    }

    // Multiple projects: show client header + nested projects
    const clientIdx = getNextIndex();

    return (
      <div key={client.id} role="none" className="space-y-0.5">
        {/* Client-only button */}
        <button
          type="button"
          {...optionProps(clientIdx, isSelectedClient)}
          onClick={() => onSelect(null, client.id)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
            highlightedIndex === clientIdx
              ? "bg-primary-50 ring-2 ring-primary-600"
              : isSelectedClient
                ? "bg-primary-50 text-primary-700"
                : "hover:bg-[var(--color-surface-sunken)]"
          }`}
        >
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              highlightedIndex === clientIdx || isSelectedClient
                ? "bg-primary-100"
                : "bg-[var(--color-surface-sunken)]"
            }`}
          >
            <Building2
              size={16}
              className={
                highlightedIndex === clientIdx || isSelectedClient
                  ? "text-primary-600"
                  : "text-[var(--color-text-tertiary)]"
              }
            />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={`text-sm text-[var(--color-text-primary)] truncate ${
                isSelectedClient ? "font-semibold" : "font-medium"
              }`}
            >
              {client.name}
            </p>
            {client.company && (
              <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                {client.company}
              </p>
            )}
          </div>
          {isSelectedClient && selectedMark}
          <ChevronRight
            aria-hidden="true"
            size={14}
            className="text-[var(--color-text-muted)] flex-shrink-0"
          />
        </button>

        {/* Projects under this client */}
        {clientProjects.length > 0 && (
          <div role="none" className="ml-4 space-y-0.5">
            {clientProjects.map((project) => {
              const idx = getNextIndex();
              const isSelected = selectedProjectId === project.id;

              return (
                <button
                  key={project.id}
                  type="button"
                  {...optionProps(idx, isSelected)}
                  onClick={() => onSelect(project.id, client.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    highlightedIndex === idx
                      ? "bg-primary-50 ring-2 ring-primary-600"
                      : isSelected
                        ? "bg-primary-50 text-primary-700"
                        : "hover:bg-[var(--color-surface-sunken)]"
                  }`}
                >
                  <Folder
                    size={14}
                    aria-hidden="true"
                    className={
                      isSelected
                        ? "text-primary-600"
                        : "text-[var(--color-text-muted)]"
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm text-[var(--color-text-primary)] truncate ${
                        isSelected ? "font-semibold" : ""
                      }`}
                    >
                      {project.name}
                    </p>
                    {project.hourlyRate && (
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {formatHourlyRate(project.hourlyRate)}
                      </p>
                    )}
                  </div>
                  {isSelected && selectedMark}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Use a portal so the modal renders on <body>, not inside the widget
  // container. Widget cards use backdrop-blur and transforms that create
  // new stacking contexts, which break `position: fixed` and trap the
  // modal inside the small widget bounds (especially on the new tab page).
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: klik på baggrunden lukker; tastaturet bruger Esc (useModalDialog)
    <div
      className="fixed inset-0 bg-[var(--color-surface-overlay)] z-50 flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${listId}-titel`}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md bg-[var(--color-surface-elevated)] rounded-[14px] max-h-[80%] flex flex-col shadow-xl animate-slide-up outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)]">
          <h2
            id={`${listId}-titel`}
            className="text-lg font-semibold text-[var(--color-text-primary)]"
          >
            {t("select.clientProject.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-lg"
            aria-label={t("select.close")}
          >
            <X size={20} aria-hidden="true" />
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
              placeholder={t("select.clientProject.searchPlaceholder")}
              aria-label={t("select.clientProject.searchLabel")}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined
              }
              data-autofocus
              className="w-full pl-10 pr-4 py-2 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm placeholder:text-[var(--color-text-muted)]"
            />
          </div>
        </div>

        {/* List */}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t("select.clientProject.listLabel")}
          className="flex-1 overflow-y-auto p-2"
        >
          {/* Clear selection option */}
          {!search &&
            (() => {
              const idx = getNextIndex();
              const isSelected = !selectedClientId && !selectedProjectId;
              return (
                <button
                  type="button"
                  {...optionProps(idx, isSelected)}
                  onClick={() => onSelect(null, null)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors mb-2 ${
                    highlightedIndex === idx
                      ? "bg-primary-50 ring-2 ring-primary-600"
                      : !selectedClientId && !selectedProjectId
                        ? "bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]"
                        : "hover:bg-[var(--color-surface-sunken)]"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      !selectedClientId && !selectedProjectId
                        ? "bg-[var(--color-border-default)]"
                        : "bg-[var(--color-surface-sunken)]"
                    }`}
                  >
                    <X
                      size={16}
                      className="text-[var(--color-text-tertiary)]"
                    />
                  </div>
                  <p
                    className={`text-sm text-[var(--color-text-secondary)] ${
                      isSelected ? "font-semibold" : ""
                    }`}
                  >
                    {t("select.clientProject.none")}
                  </p>
                  {isSelected && selectedMark}
                </button>
              );
            })()}

          {listLoading ? (
            <div
              className="text-center py-8 text-sm text-[var(--color-text-tertiary)]"
              role="status"
            >
              {t("select.clientProject.loading")}
            </div>
          ) : listError ? (
            <div className="text-center py-8 px-4" role="alert">
              <p className="text-sm text-red-700">
                {userErrorMessage(
                  listQuery.error,
                  t("select.clientProject.loadFailed"),
                )}
              </p>
              <button
                type="button"
                onClick={() => listQuery.refetch()}
                className="mt-2 text-sm font-medium text-primary-600 hover:underline"
              >
                {t("select.clientProject.retry")}
              </button>
            </div>
          ) : clients.length === 0 ? (
            <div className="text-center py-8 px-4 text-[var(--color-text-tertiary)]">
              <Building2 size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t("select.clientProject.noClients")}</p>
              <p className="text-xs mt-1">
                {t("select.clientProject.noClientsHint")}
              </p>
              <a
                href={newClientUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:underline"
              >
                <ExternalLink size={14} />
                {t("select.clientProject.createClient")}
              </a>
            </div>
          ) : filteredClients.length === 0 && search ? (
            <div className="text-center py-8 text-[var(--color-text-tertiary)]">
              <Building2 size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                {t("select.clientProject.noResults", { search })}
              </p>
            </div>
          ) : search ? (
            <div role="none" className="space-y-1">
              {otherClients.map((client) => renderClientGroup(client))}
            </div>
          ) : (
            <>
              {frequentClients.length > 0 && (
                <div role="none" className="mb-3">
                  <p
                    aria-hidden="true"
                    className="px-3 py-1 text-xs font-medium text-[var(--color-text-tertiary)]"
                  >
                    {t("select.frequent")}
                  </p>
                  <div role="none" className="space-y-1">
                    {frequentClients.map((client) => renderClientGroup(client))}
                  </div>
                </div>
              )}
              {otherClients.length > 0 && (
                <div role="none">
                  {frequentClients.length > 0 && (
                    <p
                      aria-hidden="true"
                      className="px-3 py-1 text-xs font-medium text-[var(--color-text-tertiary)]"
                    >
                      {t("select.allClients")}
                    </p>
                  )}
                  <div role="none" className="space-y-1">
                    {otherClients.map((client) => renderClientGroup(client))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
