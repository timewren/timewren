import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { apiClient } from "../../../api/client";
import { toIntlLocale, useT } from "../../../i18n";
import { userErrorMessage } from "../../../lib/api-error";
import { useCalendarStartDate } from "../../../lib/calendar-start";
import { invalidateEntryQueries } from "../../../lib/query-invalidation";
import { useAuthStore } from "../../../stores/authStore";
import { newEntrySlot } from "../../../utils/calendar-math";
import { useCalendarDrag } from "../../hooks/useCalendarDrag";
import {
  addDays,
  END_HOUR,
  getMonday,
  minutesToDate,
  pixelToMinutes,
  toLocalDateStr,
} from "../../utils/calendar-math";
import { BlockDetailPopup } from "../calendar/BlockDetailPopup";
import { CreateEntryPopup } from "../calendar/CreateEntryPopup";
import { DayGrid } from "../calendar/DayGrid";
import { EditEntryPopup } from "../calendar/EditEntryPopup";
import { UntimedEntries } from "../calendar/UntimedEntries";
import { WeekStrip } from "../calendar/WeekStrip";

export function CalendarTab() {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [createPopup, setCreatePopup] = useState<{
    date: Date;
    startMinutes: number;
    endMinutes: number;
  } | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<typeof selectedEntry>(null);

  const monday = getMonday(selectedDate);
  const sunday = addDays(monday, 6);
  const mondayStr = toLocalDateStr(monday);
  const sundayStr = toLocalDateStr(sunday);
  const selectedStr = toLocalDateStr(selectedDate);
  // "Åbn kalender på" i Indstillinger (i dag eller sidst viste dag)
  useCalendarStartDate(selectedStr, setSelectedDate);

  // Fetch week's entries
  const weekQuery = useQuery({
    queryKey: ["timeEntries", mondayStr, sundayStr, selectedOrgId],
    queryFn: () => apiClient.getTimeEntries(mondayStr, sundayStr),
    staleTime: 1000 * 60 * 2,
    enabled: orgsLoaded,
  });
  const weekEntries = weekQuery.data;

  // Update mutation for move/resize. En fejlet flytning skal siges højt —
  // blokken hopper ellers bare tilbage uden forklaring.
  const [moveError, setMoveError] = useState<string | null>(null);
  const updateMutation = useMutation({
    mutationFn: apiClient.updateTimeEntry,
    onMutate: () => setMoveError(null),
    onSuccess: () => {
      invalidateEntryQueries(queryClient);
    },
    onError: (error) => {
      setMoveError(userErrorMessage(error, t("views.calendar.moveFailed")));
    },
  });

  // Filter entries for selected day
  const dayEntries = useMemo(() => {
    if (!weekEntries) return [];
    return weekEntries.filter((e) => e.date === selectedStr);
  }, [weekEntries, selectedStr]);
  // Poster uden start/slut har ingen plads i gitteret — de listes for sig
  const untimedEntries = useMemo(
    () => dayEntries.filter((e) => !e.startTime || !e.endTime),
    [dayEntries],
  );

  // Count entries per date for WeekStrip dots
  const entryCountsByDate = useMemo(() => {
    if (!weekEntries) return {};
    const counts: Record<string, number> = {};
    for (const entry of weekEntries) {
      counts[entry.date] = (counts[entry.date] || 0) + 1;
    }
    return counts;
  }, [weekEntries]);

  // Find selected entry for detail popup
  const selectedEntry = useMemo(() => {
    if (!selectedBlockId || !weekEntries) return null;
    return weekEntries.find((e) => e.id === selectedBlockId) || null;
  }, [selectedBlockId, weekEntries]);

  // Drag callbacks
  const handleCreateEnd = useCallback(
    (
      _dateStr: string,
      date: Date,
      startMinutes: number,
      endMinutes: number,
    ) => {
      setCreatePopup({ date, startMinutes, endMinutes });
    },
    [],
  );

  const handleMoveEnd = useCallback(
    (
      blockId: string,
      dateStr: string,
      date: Date,
      startMinutes: number,
      endMinutes: number,
    ) => {
      // blockId is "block-{entryId}", extract the raw ID
      const rawId = blockId.replace(/^block-/, "");
      const entry = weekEntries?.find((e) => e.id === rawId);
      if (!entry) return;

      const hours = (endMinutes - startMinutes) / 60;
      const startTime = minutesToDate(date, startMinutes).toISOString();
      const endTime = minutesToDate(date, endMinutes).toISOString();

      updateMutation.mutate({
        id: rawId,
        hours,
        date: dateStr,
        startTime,
        endTime,
        description: entry.description,
        projectId: entry.projectId,
        clientId: entry.clientId,
      });
    },
    [weekEntries, updateMutation],
  );

  const handleResizeEnd = useCallback(
    (blockId: string, startMinutes: number, endMinutes: number) => {
      const rawId = blockId.replace(/^block-/, "");
      const entry = weekEntries?.find((e) => e.id === rawId);
      if (!entry) return;

      const hours = (endMinutes - startMinutes) / 60;
      const entryDate = new Date(`${entry.date}T00:00:00`);
      const startTime = minutesToDate(entryDate, startMinutes).toISOString();
      const endTime = minutesToDate(entryDate, endMinutes).toISOString();

      updateMutation.mutate({
        id: rawId,
        hours,
        date: entry.date,
        startTime,
        endTime,
        description: entry.description,
        projectId: entry.projectId,
        clientId: entry.clientId,
      });
    },
    [weekEntries, updateMutation],
  );

  const {
    dragState,
    registerGridRef,
    handleGridMouseDown,
    handleBlockMouseDown,
    handleResizeMouseDown,
  } = useCalendarDrag({
    onCreateEnd: handleCreateEnd,
    onMoveEnd: handleMoveEnd,
    onResizeEnd: handleResizeEnd,
  });

  const handleBlockClick = useCallback((id: string) => {
    setSelectedBlockId((prev) => (prev === id ? null : id));
  }, []);

  const handleGridDoubleClick = useCallback(
    (e: React.MouseEvent, _dateStr: string, date: Date) => {
      // Double-click to create a 1-hour entry at clicked position
      const gridEl = e.currentTarget as HTMLDivElement;
      const rect = gridEl.getBoundingClientRect();
      const snapped = pixelToMinutes(e.clientY - rect.top, rect.height);
      const startMinutes = Math.min(snapped, END_HOUR * 60 - 15);
      setCreatePopup({
        date,
        startMinutes,
        endMinutes: Math.min(startMinutes + 60, END_HOUR * 60),
      });
    },
    [],
  );

  // Navigate weeks
  const goToPrevWeek = () => setSelectedDate(addDays(selectedDate, -7));
  const goToNextWeek = () => setSelectedDate(addDays(selectedDate, 7));
  const goToToday = () => setSelectedDate(new Date());

  return (
    <div className="flex flex-col h-full">
      {/* Week navigation */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--color-surface-elevated)]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goToPrevWeek}
            className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded transition-colors"
            aria-label={t("views.calendar.prevWeek")}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={goToToday}
            className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-primary-600 transition-colors px-2 py-0.5 rounded hover:bg-[var(--color-surface-sunken)]"
          >
            {t("views.calendar.week", {
              week: getWeekNumber(monday),
              month: monday.toLocaleDateString(toIntlLocale(locale), {
                month: "short",
              }),
            })}
          </button>
          <button
            type="button"
            onClick={goToNextWeek}
            className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded transition-colors"
            aria-label={t("views.calendar.nextWeek")}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setCreatePopup(newEntrySlot(selectedDate))}
          className="inline-flex items-center gap-1 px-2.5 min-h-7 text-xs font-medium bg-primary-600 text-[var(--color-on-primary)] rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus size={14} aria-hidden="true" />
          {t("views.calendar.newEntry")}
        </button>
      </div>

      {/* Week strip */}
      <WeekStrip
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        entryCountsByDate={entryCountsByDate}
      />

      {moveError && (
        <div
          className="mx-3 mt-1 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg"
          role="alert"
        >
          <p className="flex-1 text-xs text-red-700">{moveError}</p>
          <button
            type="button"
            onClick={() => setMoveError(null)}
            className="text-xs font-medium text-red-700 hover:underline"
          >
            {t("views.calendar.close")}
          </button>
        </div>
      )}

      {/* Poster uden tidspunkt for den valgte dag */}
      {untimedEntries.length > 0 && (
        <div className="px-3 pt-1.5 pb-1">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-1">
            {t("views.calendar.untimed")}
          </p>
          <UntimedEntries
            entries={untimedEntries}
            onSelect={(entry) => setSelectedBlockId(entry.id)}
          />
        </div>
      )}

      {/* Day grid */}
      {weekQuery.isError ? (
        <div
          className="flex-1 flex flex-col items-center justify-center p-6 text-center"
          role="alert"
        >
          <p className="text-sm text-red-700">
            {userErrorMessage(weekQuery.error, t("views.calendar.loadFailed"))}
          </p>
          <button
            type="button"
            onClick={() => weekQuery.refetch()}
            className="mt-2 text-sm font-medium text-primary-600 hover:underline"
          >
            {t("views.calendar.retry")}
          </button>
        </div>
      ) : weekQuery.isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : (
        <DayGrid
          date={selectedDate}
          entries={dayEntries}
          dragState={dragState}
          selectedBlockId={selectedBlockId}
          onBlockClick={handleBlockClick}
          registerGridRef={registerGridRef}
          onGridMouseDown={handleGridMouseDown}
          onBlockMouseDown={handleBlockMouseDown}
          onResizeMouseDown={handleResizeMouseDown}
          onGridDoubleClick={handleGridDoubleClick}
        />
      )}

      {/* Create entry popup */}
      {createPopup && (
        <CreateEntryPopup
          date={createPopup.date}
          startMinutes={createPopup.startMinutes}
          endMinutes={createPopup.endMinutes}
          onClose={() => setCreatePopup(null)}
        />
      )}

      {/* Block detail popup */}
      {selectedEntry && (
        <BlockDetailPopup
          entry={selectedEntry}
          onClose={() => setSelectedBlockId(null)}
          onEdit={() => {
            setEditingEntry(selectedEntry);
            setSelectedBlockId(null);
          }}
        />
      )}

      {/* Edit entry popup */}
      {editingEntry && (
        <EditEntryPopup
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}

/** ISO 8601 week number */
function getWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
