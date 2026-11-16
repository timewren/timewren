import { Check, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadError } from "@/components/ui/LoadError";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import {
  formatDate,
  formatDuration,
  formatHours,
  toLocalDateStr,
} from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { InvoiceDraft, TimeEntry } from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface EntrySelectorProps {
  open: boolean;
  onClose: () => void;
  onCreated: (invoice: InvoiceDraft) => void;
}

export function EntrySelector({
  open,
  onClose,
  onCreated,
}: EntrySelectorProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  // Kunderne er en vælger (filteret), posterne er en liste. De var samlet i ét
  // `Promise.all`, så en fejl i kundefilteret blev meldt som «posterne kunne
  // ikke hentes» — og omvendt. Hver har nu sin egen fejltilstand.
  const { clients, loadFailed, retry } = useProjectClientPicker({
    active: open,
    projects: false,
  });
  const [entriesLoadFailed, setEntriesLoadFailed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [clientFilter, setClientFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Set default date range to last 30 days
  useEffect(() => {
    if (open) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setDateFrom(toLocalDateStr(thirtyDaysAgo));
      setDateTo(toLocalDateStr(now));
      setSelectedIds(new Set());
      setClientFilter("");
      setSearch("");
    }
  }, [open]);

  // Load entries and clients
  //
  // `load` er en `useCallback` med `t` i afhængighederne, så et sprogskift
  // genindlæser listen med den nye sætning i stedet for at beholde den gamle.
  // Det er samme mønster som `ExclusionRulesManager`, og det har en pris: hvis
  // `t` ikke er stabil, genindlæser hvert render listen, og brugeren får en
  // henteløkke mod databasen. `EntrySelector.i18n.test.tsx` tæller kaldene ved
  // et sprogskift, så den løkke kan ikke slippe ind.
  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const entriesResult = await tauriInvoke<TimeEntry[]>(
        "list_time_entries",
        {
          from: dateFrom ? `${dateFrom}T00:00:00Z` : null,
          to: dateTo ? `${dateTo}T23:59:59Z` : null,
        },
      );
      // Only show completed, billable entries
      setEntries(
        entriesResult.filter(
          (e) => !e.is_running && e.is_billable && e.duration && e.duration > 0,
        ),
      );
      setEntriesLoadFailed(false);
    } catch (err) {
      // Stilhed var her en løgn: listen er tom, og den tomme liste siger
      // «Ingen fakturerbare poster fundet for denne klient» — brugeren tror
      // han har noget at fakturere og intet at være bange for. En post der
      // ikke kan hentes, må sige det.
      console.error("Failed to load entries:", err);
      setEntries([]);
      setEntriesLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [open, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let items = entries;

    if (clientFilter) {
      items = items.filter((e) => e.client_id === clientFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (e) =>
          e.description?.toLowerCase().includes(q) ||
          e.project_name?.toLowerCase().includes(q) ||
          e.client_name?.toLowerCase().includes(q),
      );
    }

    return items;
  }, [entries, clientFilter, search]);

  // Preview totals
  const selectedEntries = useMemo(
    () => entries.filter((e) => selectedIds.has(e.id)),
    [entries, selectedIds],
  );

  const totalHours = useMemo(
    () => selectedEntries.reduce((sum, e) => sum + (e.duration || 0), 0) / 3600,
    [selectedEntries],
  );

  function toggleEntry(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((e) => e.id)));
    }
  }

  async function handleCreate() {
    if (selectedIds.size === 0) return;

    // Determine client_id from selected entries
    const firstEntry = entries.find((e) => selectedIds.has(e.id));
    const clientId = clientFilter || firstEntry?.client_id;
    if (!clientId) return;

    setCreating(true);
    try {
      const invoice = await tauriInvoke<InvoiceDraft>(
        "create_invoice_from_entries",
        {
          clientId,
          entryIds: Array.from(selectedIds),
        },
      );
      toast.success(t("invoices.invoiceCreated"));
      onCreated(invoice);
      onClose();
    } catch (err) {
      console.error("Failed to create invoice:", err);
      toast.error(t("invoices.createFromEntriesFailed"));
    } finally {
      setCreating(false);
    }
  }

  const allSelected =
    filtered.length > 0 && selectedIds.size === filtered.length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("invoices.createFromEntries")}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={selectedIds.size === 0 || creating || !clientFilter}
          >
            {creating
              ? t("invoices.creating")
              : t("invoices.createWithCount", { count: selectedIds.size })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 -mx-5 -my-4 px-5 py-4 max-h-[70vh]">
        {loadFailed && <PickerLoadError kind={loadFailed} onRetry={retry} />}

        {/* Filters */}
        <div className="flex gap-2">
          <select
            value={clientFilter}
            aria-label={t("invoices.clientFilter")}
            onChange={(e) => {
              setClientFilter(e.target.value);
              setSelectedIds(new Set());
            }}
            className="h-9 flex-1 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
          >
            <option value="">{t("invoices.selectClientPlaceholder")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <input
            type="date"
            value={dateFrom}
            aria-label={t("invoices.dateFrom")}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
          />
          <input
            type="date"
            value={dateTo}
            aria-label={t("invoices.dateTo")}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
          />
        </div>

        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("invoices.searchEntriesPlaceholder")}
            aria-label={t("invoices.searchEntries")}
            className="h-9 w-full rounded-md border border-(--color-border) bg-(--color-bg) pl-9 pr-3 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 focus:border-(--color-accent) focus:outline-none"
          />
        </div>

        {/* Select all */}
        {filtered.length > 0 && (
          <button
            type="button"
            onClick={selectAll}
            className="flex items-center gap-2 text-xs text-(--color-text-muted) hover:text-(--color-text) transition-colors"
          >
            <div
              className={`flex h-4 w-4 items-center justify-center rounded border ${
                allSelected
                  ? "border-(--color-accent) bg-(--color-accent)"
                  : "border-(--color-border)"
              }`}
            >
              {allSelected && <Check size={10} className="text-white" />}
            </div>
            {t("invoices.selectAllEntries", { count: filtered.length })}
          </button>
        )}

        {/* Entry list */}
        <div className="overflow-y-auto max-h-[40vh] flex flex-col gap-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
            </div>
          ) : entriesLoadFailed ? (
            <LoadError
              message={t("invoices.entriesLoadFailed")}
              onRetry={load}
            />
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-(--color-text-muted) py-8">
              {clientFilter
                ? t("invoices.noBillableEntries")
                : t("invoices.selectClientToSeeEntries")}
            </p>
          ) : (
            filtered.map((entry) => {
              const selected = selectedIds.has(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => toggleEntry(entry.id)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    selected
                      ? "bg-(--color-accent)/10 border border-(--color-accent)/30"
                      : "border border-transparent hover:bg-(--color-border)/30"
                  }`}
                >
                  <div
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      selected
                        ? "border-(--color-accent) bg-(--color-accent)"
                        : "border-(--color-border)"
                    }`}
                  >
                    {selected && <Check size={10} className="text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-(--color-text) truncate">
                      {entry.description ||
                        entry.project_name ||
                        t("invoices.noDescription")}
                    </p>
                    <p className="text-xs text-(--color-text-muted)">
                      {formatDate(entry.start_time)}
                      {entry.project_name && ` · ${entry.project_name}`}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-(--color-text-muted) shrink-0">
                    {entry.duration ? formatDuration(entry.duration) : "-"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Preview summary */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-(--color-bg) border border-(--color-border) px-3 py-2">
            <span className="text-xs text-(--color-text-muted)">
              {t("invoices.entriesSelected", { count: selectedIds.size })}
            </span>
            <span className="text-sm font-mono font-medium text-(--color-text)">
              {t("invoices.selectedHours", {
                count: totalHours,
                hours: formatHours(totalHours),
              })}
            </span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
