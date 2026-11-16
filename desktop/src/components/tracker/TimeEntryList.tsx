import { AnimatePresence, motion } from "framer-motion";
import { Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "@/components/ui/LoadError";
import { useListKeyboard } from "@/hooks/useListKeyboard";
import { formatDuration, formatTime, toLocalDateStr } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { TimeEntry } from "@/lib/types";
import { useTimerStore } from "@/stores/timerStore";
import { toast } from "@/stores/toastStore";
import { TimeEntryForm } from "./TimeEntryForm";

export function TimeEntryList() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);

  const isRunning = useTimerStore((s) => s.isRunning);

  // Keyboard navigation
  const keyboard = useListKeyboard({
    itemCount: entries.length,
    enabled: !formOpen,
    onEdit: (index) => {
      const entry = entries[index];
      if (entry) handleEdit(entry);
    },
    onDelete: (index) => {
      const entry = entries[index];
      if (entry) handleDelete(entry.id);
    },
  });

  const fetchEntries = useCallback(async () => {
    try {
      const today = new Date();
      const todayStr = toLocalDateStr(today);
      const from = `${todayStr}T00:00:00`;
      const to = `${todayStr}T23:59:59`;

      const result = await tauriInvoke<TimeEntry[]>("list_time_entries", {
        from,
        to,
      });
      // Filter out running entries — those are shown in TimerWidget
      setEntries(result.filter((e) => !e.is_running));
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to load time entries:", err);
      // Uden denne viser listen "Ingen registreringer endnu" — altså at brugeren
      // ikke har registreret noget — når det er dagens data der ikke kom.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Refresh when timer stops (isRunning becomes false)
  useEffect(() => {
    if (!isRunning) {
      fetchEntries();
    }
  }, [isRunning, fetchEntries]);

  async function handleDelete(id: string) {
    try {
      await tauriInvoke("delete_time_entry", { id });
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setDeleteConfirmId(null);
      toast.success(t("timeEntry.entryDeleted"));
    } catch (err) {
      console.error("Failed to delete time entry:", err);
      toast.error(t("timeEntry.couldNotDelete"));
    }
  }

  function handleEdit(entry: TimeEntry) {
    setEditingEntry(entry);
    setFormOpen(true);
  }

  function handleFormClose() {
    setFormOpen(false);
    setEditingEntry(null);
  }

  function handleFormSaved() {
    handleFormClose();
    fetchEntries();
  }

  // Calculate total duration for today
  const totalSeconds = entries.reduce((sum, e) => sum + (e.duration ?? 0), 0);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-(--color-text)">
            {t("dashboard.todayEntries")}
          </h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-border) border-t-(--color-accent)" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-(--color-text)">
            {t("dashboard.todayEntries")}
          </h2>
          {entries.length > 0 && (
            <span className="flex items-center gap-1 rounded-md bg-(--color-border)/40 px-2 py-0.5 font-mono text-xs text-(--color-text-muted)">
              <Clock size={12} />
              {formatDuration(totalSeconds)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingEntry(null);
            setFormOpen(true);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-(--color-text-muted) transition-colors hover:bg-(--color-border)/50 hover:text-(--color-text)"
          aria-label={t("dashboard.addEntry")}
          title={t("dashboard.addEntry")}
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Entry list */}
      {loadFailed ? (
        <LoadError
          message={t("timeEntry.listLoadFailed")}
          onRetry={() => {
            setLoading(true);
            fetchEntries();
          }}
        />
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-(--color-border) py-8">
          <Clock size={24} className="text-(--color-text-muted)/40" />
          <p className="text-sm text-(--color-text-muted)">
            {t("dashboard.noEntries")}
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingEntry(null);
              setFormOpen(true);
            }}
            className="mt-1 flex items-center gap-1.5 rounded-md bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-(--color-accent-hover)"
          >
            <Plus size={14} />
            {t("dashboard.addManually")}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <AnimatePresence mode="popLayout">
            {entries.map((entry, index) => (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.2 }}
                className={`group relative flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2.5 transition-colors hover:border-(--color-text-muted)/30 ${
                  index === keyboard.activeIndex
                    ? "ring-2 ring-(--color-accent)/50"
                    : ""
                }`}
              >
                {/* Project color indicator */}
                <div
                  className="h-8 w-1 shrink-0 rounded-full"
                  style={{
                    backgroundColor: entry.project_color ?? "#6b7280",
                  }}
                />

                {/* Entry info */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    {entry.project_name && (
                      <span className="text-sm font-medium text-(--color-text)">
                        {entry.project_name}
                      </span>
                    )}
                    {entry.client_name && (
                      <span className="text-xs text-(--color-text-muted)">
                        {entry.client_name}
                      </span>
                    )}
                    {!entry.is_billable && (
                      <span className="rounded bg-(--color-border)/60 px-1 py-px text-[10px] text-(--color-text-muted)">
                        {t("common.nonBillable")}
                      </span>
                    )}
                  </div>
                  {entry.description && (
                    <p className="truncate text-xs text-(--color-text-muted)">
                      {entry.description}
                    </p>
                  )}
                </div>

                {/* Time info */}
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="font-mono text-sm font-medium text-(--color-text)">
                    {formatDuration(entry.duration ?? 0)}
                  </span>
                  <span className="font-mono text-[11px] text-(--color-text-muted)">
                    {formatTime(entry.start_time)}
                    {entry.end_time && ` – ${formatTime(entry.end_time)}`}
                  </span>
                </div>

                {/* Hover actions */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleEdit(entry)}
                    className="flex h-6 w-6 items-center justify-center rounded text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
                    aria-label={t("common.edit")}
                    title={t("common.edit")}
                  >
                    <Pencil size={13} />
                  </button>
                  {deleteConfirmId === entry.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDelete(entry.id)}
                        className="flex h-6 items-center rounded bg-red-600 px-1.5 text-[11px] font-medium text-white transition-colors hover:bg-red-700"
                      >
                        {t("common.delete")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(null)}
                        className="flex h-6 items-center rounded bg-(--color-border) px-1.5 text-[11px] text-(--color-text-muted) transition-colors hover:text-(--color-text)"
                      >
                        {t("common.no")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(entry.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-(--color-text-muted) transition-colors hover:bg-red-500/10 hover:text-red-400"
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Keyboard hint */}
      {entries.length > 0 && (
        <p className="mt-2 text-center text-[10px] text-(--color-text-muted)/50">
          {t("keyboard.listHint")}
        </p>
      )}

      {/* Form dialog */}
      <TimeEntryForm
        open={formOpen}
        onClose={handleFormClose}
        onSaved={handleFormSaved}
        entry={editingEntry}
      />
    </div>
  );
}
