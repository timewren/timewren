import { useQuery } from "@tanstack/react-query";
import { Copy, Filter, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { apiClient } from "../../../api/client";
import { useT } from "../../../i18n";
import { getLocale, toIntlLocale } from "../../../i18n/core";
import { userErrorMessage } from "../../../lib/api-error";
import { formatHoursShort } from "../../../lib/format-hours";
import { openPopupWindow } from "../../../lib/popup-window";
import { quickEntryPath } from "../../../lib/quick-entry-draft";
import { BlockDetailPopup } from "../../../popup/components/calendar/BlockDetailPopup";
import { EditEntryPopup } from "../../../popup/components/calendar/EditEntryPopup";
import { useAuthStore } from "../../../stores/authStore";
import { useTimerStore } from "../../../stores/timerStore";
import {
  addDays,
  getMonday,
  toLocalDateStr,
} from "../../../utils/calendar-math";
import { historyDateLabel } from "../../../utils/date";

// Hele ugen: weekendtimer tæller med i ugetotalen
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const BAR_MAX_HEIGHT = 48;

const formatHours = formatHoursShort;

function formatTimeRange(
  start: string | null,
  end: string | null,
): string | null {
  if (!start || !end) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(toIntlLocale(getLocale()), {
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${fmt(start)}–${fmt(end)}`;
}

type RecentEntry = Awaited<
  ReturnType<typeof apiClient.getRecentEntries>
>[number];

export function HistoryTab() {
  const { t } = useT();
  const startTimer = useTimerStore((s) => s.startTimer);
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [selectedEntry, setSelectedEntry] = useState<RecentEntry | null>(null);
  const [editingEntry, setEditingEntry] = useState<RecentEntry | null>(null);

  // "Kopier" åbner popup'en med Hurtig registrering forudfyldt
  const handleCopy = (entry: RecentEntry) => {
    void openPopupWindow(
      quickEntryPath({
        projectId: entry.projectId,
        clientId: entry.clientId,
        hours: entry.hours,
        description: entry.description || "",
      }),
    );
  };

  const monday = useMemo(() => getMonday(new Date()), []);
  const sunday = useMemo(() => addDays(monday, 6), [monday]);
  const mondayStr = toLocalDateStr(monday);
  const sundayStr = toLocalDateStr(sunday);

  const weekQuery = useQuery({
    queryKey: ["timeEntries", mondayStr, sundayStr, selectedOrgId],
    queryFn: () => apiClient.getTimeEntries(mondayStr, sundayStr),
    staleTime: 1000 * 60 * 2,
    enabled: orgsLoaded,
  });

  const recentQuery = useQuery({
    queryKey: ["recentEntries", 30, selectedOrgId],
    queryFn: () => apiClient.getRecentEntries(30),
    staleTime: 1000 * 60 * 2,
    enabled: orgsLoaded,
  });

  const weekEntries = weekQuery.data;
  const recentEntries = recentQuery.data;

  // Unique clients for filter
  const clients = useMemo(() => {
    if (!recentEntries) return [];
    const map = new Map<string, string>();
    for (const entry of recentEntries) {
      if (entry.clientId && entry.clientName) {
        map.set(entry.clientId, entry.clientName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [recentEntries]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    if (!recentEntries) return [];
    if (clientFilter === "all") return recentEntries;
    return recentEntries.filter((e) => e.clientId === clientFilter);
  }, [recentEntries, clientFilter]);

  // Compute hours per weekday (Mon=0..Sun=6)
  const weekdayHours = useMemo(() => {
    const hours = [0, 0, 0, 0, 0, 0, 0];
    if (!weekEntries) return hours;
    for (let i = 0; i < 7; i++) {
      const dayDate = toLocalDateStr(addDays(monday, i));
      for (const entry of weekEntries) {
        if (entry.date === dayDate) {
          hours[i] += entry.hours;
        }
      }
    }
    return hours;
  }, [weekEntries, monday]);

  const totalWeekHours = weekdayHours.reduce((a, b) => a + b, 0);
  const maxHours = Math.max(...weekdayHours, 0.1);

  // Group entries by date
  const groupedEntries = useMemo(() => {
    const groups: {
      label: string;
      entries: typeof filteredEntries;
    }[] = [];
    let currentLabel = "";

    for (const entry of filteredEntries) {
      const label = historyDateLabel(entry.date);
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, entries: [] });
      }
      groups[groups.length - 1].entries.push(entry);
    }

    return groups;
  }, [filteredEntries]);

  const isLoading = weekQuery.isLoading || recentQuery.isLoading;

  // En fejl må ikke ligne en tom uge
  if (weekQuery.isError || recentQuery.isError) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-center"
        role="alert"
      >
        <p className="text-sm text-red-700">
          {userErrorMessage(
            weekQuery.error ?? recentQuery.error,
            t("views.history.loadFailed"),
          )}
        </p>
        <button
          type="button"
          onClick={() => {
            if (weekQuery.isError) void weekQuery.refetch();
            if (recentQuery.isError) void recentQuery.refetch();
          }}
          className="mt-2 text-sm font-medium text-primary-600 hover:underline"
        >
          {t("views.history.retry")}
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="animate-tab-enter">
      {/* Weekly overview chart */}
      <div className="bg-[var(--color-surface-elevated)] rounded-[14px] p-5 border border-[var(--color-border-subtle)] mb-6">
        <div
          className="flex items-end justify-between gap-2"
          style={{ height: `${BAR_MAX_HEIGHT + 24}px` }}
        >
          {weekdayHours.map((hours, i) => {
            const barHeight =
              maxHours > 0 ? (hours / maxHours) * BAR_MAX_HEIGHT : 0;
            return (
              <div
                key={toLocalDateStr(addDays(monday, i))}
                className="flex-1 flex flex-col items-center gap-1"
              >
                {hours > 0 && (
                  <span className="text-[11px] text-[var(--color-text-muted)] font-medium">
                    {formatHours(hours)}
                  </span>
                )}
                <div
                  className="w-full max-w-[40px] bg-primary-500 rounded-sm transition-all duration-300"
                  style={{
                    height: `${Math.max(barHeight, hours > 0 ? 3 : 1)}px`,
                    opacity: hours > 0 ? 1 : 0.2,
                  }}
                />
                <span className="text-[11px] text-[var(--color-text-muted)] font-medium">
                  {t(`format.weekdayLetter.${WEEKDAY_KEYS[i]}`)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-center">
          <span className="text-xl font-bold text-[var(--color-text-primary)]">
            {formatHours(totalWeekHours)}
          </span>
          <span className="text-xs text-[var(--color-text-muted)] ml-1">
            {t("views.history.thisWeek")}
          </span>
        </div>
      </div>

      {/* Filter + entries list */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {t("views.history.recent")}
        </h3>
        {clients.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter
              size={12}
              className="text-[var(--color-text-muted)]"
              aria-hidden="true"
            />
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              aria-label={t("views.history.filterByClient")}
              className="tt-select text-xs"
            >
              <option value="all">{t("views.history.allClients")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {groupedEntries.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-[var(--color-text-muted)]">
            {t("views.history.empty")}
          </p>
          <button
            type="button"
            onClick={() => void openPopupWindow(quickEntryPath())}
            className="mt-2 text-sm font-medium text-primary-600 hover:underline"
          >
            {t("views.history.logTime")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedEntries.map((group) => (
            <div key={group.label}>
              <h4 className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 px-1">
                {group.label}
              </h4>
              <div className="space-y-1">
                {group.entries.map((entry, i) => (
                  <div
                    key={entry.id}
                    className="animate-fade-in-up flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-[var(--color-surface-elevated)] transition-colors group"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedEntry(entry)}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
                      title={t("views.history.openEdit")}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {(entry.clientName || entry.projectName) && (
                            <span className="text-xs text-[var(--color-text-tertiary)] truncate">
                              {[entry.clientName, entry.projectName]
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          )}
                        </div>
                        {entry.description && (
                          <p className="text-sm text-[var(--color-text-secondary)] truncate">
                            {entry.description}
                          </p>
                        )}
                      </div>
                      {formatTimeRange(entry.startTime, entry.endTime) && (
                        <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                          {formatTimeRange(entry.startTime, entry.endTime)}
                        </span>
                      )}
                      <span className="text-sm font-medium text-[var(--color-text-primary)] whitespace-nowrap">
                        {formatHours(entry.hours)}
                      </span>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => handleCopy(entry)}
                        className="w-6 h-6 inline-flex items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)] focus-visible:opacity-100 transition-colors"
                        title={t("views.history.copy")}
                        aria-label={t("views.history.copy")}
                      >
                        <Copy size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          startTimer(
                            entry.projectId,
                            entry.clientId,
                            entry.description || "",
                          )
                        }
                        className="w-6 h-6 inline-flex items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:text-primary-600 hover:bg-[var(--color-surface-sunken)] focus-visible:opacity-100 transition-colors"
                        title={t("views.history.startTimer")}
                        aria-label={t("views.history.startSame")}
                      >
                        <Play size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedEntry && (
        <BlockDetailPopup
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onEdit={() => {
            setEditingEntry(selectedEntry);
            setSelectedEntry(null);
          }}
        />
      )}

      {editingEntry && (
        <EditEntryPopup
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}
