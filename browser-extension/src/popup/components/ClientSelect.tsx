import { Building2, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type { Client } from "../../types";

function ClientItem({
  client,
  idx,
  highlightedIndex,
  selectedClientId,
  onSelect,
}: {
  client: Client;
  idx: number;
  highlightedIndex: number;
  selectedClientId: string | null;
  onSelect: (clientId: string | null) => void;
}) {
  return (
    <button
      type="button"
      data-index={idx}
      onClick={() => onSelect(client.id)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
        highlightedIndex === idx
          ? "bg-primary-50 ring-1 ring-primary-300"
          : client.id === selectedClientId
            ? "bg-primary-50 text-primary-700"
            : "hover:bg-[var(--color-surface-sunken)]"
      }`}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
          highlightedIndex === idx || client.id === selectedClientId
            ? "bg-primary-100"
            : "bg-[var(--color-surface-sunken)]"
        }`}
      >
        <Building2
          size={16}
          className={
            highlightedIndex === idx || client.id === selectedClientId
              ? "text-primary-600"
              : "text-[var(--color-text-tertiary)]"
          }
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {client.name}
        </p>
        {client.company && (
          <p className="text-xs text-[var(--color-text-tertiary)] truncate">
            {client.company}
          </p>
        )}
      </div>
    </button>
  );
}

interface ClientSelectProps {
  clients: Client[];
  selectedClientId: string | null;
  onSelect: (clientId: string | null) => void;
  onClose: () => void;
}

export function ClientSelect({
  clients,
  selectedClientId,
  onSelect,
  onClose,
}: ClientSelectProps) {
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus search on open
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Filter clients by search
  const filteredClients = useMemo(() => {
    const filtered = search
      ? clients.filter(
          (c) =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.company?.toLowerCase().includes(search.toLowerCase()),
        )
      : clients;
    // Sort by timeEntryCount descending
    return [...filtered].sort(
      (a, b) => (b.timeEntryCount ?? 0) - (a.timeEntryCount ?? 0),
    );
  }, [clients, search]);

  // Split into frequently used and all clients (only when not searching)
  const { frequentClients, otherClients } = useMemo(() => {
    if (search) {
      return { frequentClients: [], otherClients: filteredClients };
    }
    const frequent = filteredClients.filter((c) => (c.timeEntryCount ?? 0) > 0);
    const others = filteredClients.filter((c) => (c.timeEntryCount ?? 0) === 0);
    return { frequentClients: frequent, otherClients: others };
  }, [filteredClients, search]);

  // Build flat list for keyboard navigation
  // Index 0 = "No client" (only without search), then filteredClients
  const flatItems = useMemo(() => {
    const items: Array<string | null> = [];
    if (!search) {
      items.push(null); // "No client" option
    }
    if (search) {
      for (const client of otherClients) {
        items.push(client.id);
      }
    } else {
      for (const client of frequentClients) {
        items.push(client.id);
      }
      for (const client of otherClients) {
        items.push(client.id);
      }
    }
    return items;
  }, [search, frequentClients, otherClients]);

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
        onSelect(flatItems[highlightedIndex]);
      }
    },
    [flatItems, highlightedIndex, onSelect, onClose],
  );

  let itemIndex = 0;
  const getNextIndex = () => itemIndex++;

  return (
    <div
      className="fixed inset-0 bg-[var(--color-surface-overlay)] z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("select.client.title")}
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full bg-[var(--color-surface-elevated)] rounded-t-2xl max-h-[80%] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t("select.client.title")}
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
              placeholder={t("select.client.searchPlaceholder")}
              className="w-full pl-10 pr-4 py-2 border border-[var(--color-border-default)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 placeholder:text-[var(--color-text-muted)]"
            />
          </div>
        </div>

        {/* Client List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {/* No client option */}
          {!search &&
            (() => {
              const idx = getNextIndex();
              return (
                <button
                  type="button"
                  data-index={idx}
                  onClick={() => onSelect(null)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors mb-2 ${
                    highlightedIndex === idx
                      ? "bg-primary-50 ring-1 ring-primary-300"
                      : selectedClientId === null
                        ? "bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]"
                        : "hover:bg-[var(--color-surface-sunken)]"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      selectedClientId === null
                        ? "bg-[var(--color-border-default)]"
                        : "bg-[var(--color-surface-sunken)]"
                    }`}
                  >
                    <Building2
                      size={16}
                      className="text-[var(--color-text-tertiary)]"
                    />
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {t("select.client.none")}
                  </p>
                </button>
              );
            })()}

          {filteredClients.length === 0 && search ? (
            <div className="text-center py-8 text-[var(--color-text-tertiary)]">
              <Building2 size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t("select.client.notFound")}</p>
            </div>
          ) : search ? (
            <div className="space-y-1">
              {otherClients.map((client) => {
                const idx = getNextIndex();
                return (
                  <ClientItem
                    key={client.id}
                    client={client}
                    idx={idx}
                    highlightedIndex={highlightedIndex}
                    selectedClientId={selectedClientId}
                    onSelect={onSelect}
                  />
                );
              })}
            </div>
          ) : (
            <>
              {frequentClients.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-1 text-xs font-medium text-[var(--color-text-tertiary)]">
                    {t("select.frequent")}
                  </p>
                  <div className="space-y-1">
                    {frequentClients.map((client) => {
                      const idx = getNextIndex();
                      return (
                        <ClientItem
                          key={client.id}
                          client={client}
                          idx={idx}
                          highlightedIndex={highlightedIndex}
                          selectedClientId={selectedClientId}
                          onSelect={onSelect}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
              {otherClients.length > 0 && (
                <div>
                  {frequentClients.length > 0 && (
                    <p className="px-3 py-1 text-xs font-medium text-[var(--color-text-tertiary)]">
                      {t("select.allClients")}
                    </p>
                  )}
                  <div className="space-y-1">
                    {otherClients.map((client) => {
                      const idx = getNextIndex();
                      return (
                        <ClientItem
                          key={client.id}
                          client={client}
                          idx={idx}
                          highlightedIndex={highlightedIndex}
                          selectedClientId={selectedClientId}
                          onSelect={onSelect}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
