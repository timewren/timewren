import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadError";
import { useListKeyboard } from "@/hooks/useListKeyboard";
import { formatCurrency } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { Client } from "@/lib/types";
import { toast } from "@/stores/toastStore";
import { ClientForm } from "./ClientForm";

export function ClientList() {
  const { t } = useTranslation();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const fetchClients = useCallback(async () => {
    try {
      const result = await tauriInvoke<Client[]>("list_clients", {
        includeArchived: showArchived,
      });
      setClients(result);
      // Ryddes kun når data faktisk er der — ellers ville et kald fra arkiver-
      // filteret blinke den gamle fejl hen over et fungerende listeindhold.
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to fetch clients:", err);
      // Uden denne viste listen "Ingen klienter endnu" — altså at brugeren
      // intet har — når det var databasen der svarede forkert.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const filtered = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.cvr?.includes(q),
    );
  }, [clients, search]);

  // Keyboard navigation
  const keyboard = useListKeyboard({
    itemCount: filtered.length,
    enabled: !formOpen,
    onEdit: (index) => {
      const client = filtered[index];
      if (client) openEdit(client);
    },
    onSelect: (index) => {
      const client = filtered[index];
      if (client) openEdit(client);
    },
  });

  async function handleArchive(client: Client) {
    try {
      await tauriInvoke("archive_client", { id: client.id });
      toast.success(t("projects.clientArchived"));
      fetchClients();
    } catch (err) {
      console.error("Failed to archive client:", err);
      toast.error(t("projects.couldNotArchiveClient"));
    }
  }

  function openCreate() {
    setEditingClient(null);
    setFormOpen(true);
  }

  function openEdit(client: Client) {
    setEditingClient(client);
    setFormOpen(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
          />
          <input
            type="text"
            aria-label={t("projects.searchClients")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("projects.searchClients")}
            className="h-9 w-full rounded-md border border-(--color-border) bg-(--color-bg) pl-9 pr-3 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowArchived(!showArchived)}
          title={
            showArchived
              ? t("projects.hideArchived")
              : t("projects.showArchived")
          }
        >
          {showArchived ? <Eye size={14} /> : <EyeOff size={14} />}
          <span className="hidden sm:inline">
            {showArchived
              ? t("projects.hideArchived")
              : t("projects.showArchived")}
          </span>
        </Button>

        <Button size="sm" onClick={openCreate}>
          <Plus size={14} />
          {t("projects.newClient")}
        </Button>
      </div>

      {/* List */}
      {loadFailed ? (
        <LoadError
          message={t("projects.clientsLoadFailed")}
          onRetry={() => {
            setLoading(true);
            fetchClients();
          }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          hasClients={clients.length > 0}
          onCreateClick={openCreate}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-(--color-border)">
          {/* Header */}
          <div className="grid grid-cols-[1fr_1fr_120px_100px_80px] gap-2 border-b border-(--color-border) bg-(--color-bg) px-4 py-2.5">
            <span className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider">
              {t("common.name")}
            </span>
            <span className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider">
              {t("projects.company")}
            </span>
            <span className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider">
              {t("projects.cvr")}
            </span>
            <span className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider text-right">
              {t("projects.hourlyRate")}
            </span>
            <span />
          </div>

          {/* Rows */}
          <AnimatePresence>
            {filtered.map((client, index) => (
              <motion.div
                key={client.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className={`grid grid-cols-[1fr_1fr_120px_100px_80px] gap-2 items-center border-b border-(--color-border) last:border-b-0 px-4 py-2.5 transition-colors hover:bg-(--color-border)/30 cursor-pointer group ${
                  client.is_archived ? "opacity-50" : ""
                } ${index === keyboard.activeIndex ? "ring-2 ring-(--color-accent)/50" : ""}`}
                onClick={() => openEdit(client)}
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-(--color-text) truncate">
                    {client.name}
                  </span>
                  {client.email && (
                    <span className="text-xs text-(--color-text-muted) truncate">
                      {client.email}
                    </span>
                  )}
                </div>

                <span className="text-sm text-(--color-text-muted) truncate">
                  {client.company || "—"}
                </span>

                <span className="text-sm text-(--color-text-muted) font-mono">
                  {client.cvr || "—"}
                </span>

                <span className="text-sm text-(--color-text) text-right font-mono">
                  {client.hourly_rate
                    ? formatCurrency(client.hourly_rate, 2)
                    : "—"}
                </span>

                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(client);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-(--color-text-muted) hover:bg-(--color-border) hover:text-(--color-text) transition-colors"
                    aria-label={`${t("common.edit")} ${client.name}`}
                    title={t("common.edit")}
                  >
                    <Pencil size={13} />
                  </button>
                  {!client.is_archived && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleArchive(client);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-(--color-text-muted) hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      aria-label={`${t("common.archive")} ${client.name}`}
                      title={t("common.archive")}
                    >
                      <Archive size={13} />
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Keyboard hint */}
      {filtered.length > 0 && (
        <p className="text-center text-[10px] text-(--color-text-muted)/50">
          {t("keyboard.listHint")}
        </p>
      )}

      {/* Form dialog */}
      <ClientForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={fetchClients}
        client={editingClient}
      />
    </div>
  );
}

function EmptyState({
  hasClients,
  onCreateClick,
}: {
  hasClients: boolean;
  onCreateClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-(--color-border)/40 mb-4">
        <Users size={22} className="text-(--color-text-muted)" />
      </div>
      <h3 className="text-sm font-medium text-(--color-text) mb-1">
        {hasClients ? t("common.noResults") : t("projects.noClients")}
      </h3>
      <p className="text-xs text-(--color-text-muted) mb-4 max-w-[240px]">
        {hasClients
          ? t("projects.noResultsSearch")
          : t("projects.createFirstClient")}
      </p>
      {!hasClients && (
        <Button size="sm" onClick={onCreateClick}>
          <Plus size={14} />
          {t("projects.newClient")}
        </Button>
      )}
    </div>
  );
}
