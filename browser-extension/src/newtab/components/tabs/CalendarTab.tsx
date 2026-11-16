import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../../../api/client";
import { toIntlLocale, useT } from "../../../i18n";
import { userErrorMessage } from "../../../lib/api-error";
import { useCalendarStartDate } from "../../../lib/calendar-start";
import { formatHoursShort as formatHoursText } from "../../../lib/format-hours";
import { invalidateEntryQueries } from "../../../lib/query-invalidation";
import { BlockDetailPopup } from "../../../popup/components/calendar/BlockDetailPopup";
import { CreateEntryPopup } from "../../../popup/components/calendar/CreateEntryPopup";
import { EditEntryPopup } from "../../../popup/components/calendar/EditEntryPopup";
import { UntimedEntries } from "../../../popup/components/calendar/UntimedEntries";
import { useAuthStore } from "../../../stores/authStore";
import { clientColorVar } from "../../../utils/calendar-colors";
import {
  addDays,
  END_HOUR,
  formatMinutesOfDay,
  getMonday,
  getWeekNumber,
  minutesToDate,
  minutesToPercent,
  newEntrySlot,
  SNAP_MINUTES,
  START_HOUR,
  TOTAL_HOURS,
  toLocalDateStr,
} from "../../../utils/calendar-math";
import type { DragState } from "../../hooks/useWeekCalendarDrag";
import { useWeekCalendarDrag } from "../../hooks/useWeekCalendarDrag";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

interface CalendarEntry {
  id: string;
  description: string;
  hours: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  projectName: string | null;
  clientName: string | null;
  clientId: string | null;
  projectId?: string | null;
  isFromPrepaid?: boolean;
}

function formatHoursShort(h: number): string {
  if (h === 0) return "";
  return formatHoursText(h);
}

export function CalendarTab() {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(
    null,
  );
  const [editingEntry, setEditingEntry] = useState<CalendarEntry | null>(null);
  const [createPopup, setCreatePopup] = useState<{
    date: Date;
    startMinutes: number;
    endMinutes: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const weekEnd = addDays(weekStart, 6);
  const mondayStr = toLocalDateStr(weekStart);
  const sundayStr = toLocalDateStr(weekEnd);
  const todayStr = toLocalDateStr(new Date());
  // "Åbn kalender på" i Indstillinger (i dag eller sidst viste uge)
  useCalendarStartDate(mondayStr, (date) => setWeekStart(getMonday(date)));

  const weekQuery = useQuery({
    queryKey: ["timeEntries", mondayStr, sundayStr, selectedOrgId],
    queryFn: () => apiClient.getTimeEntries(mondayStr, sundayStr),
    staleTime: 1000 * 60 * 2,
    enabled: orgsLoaded,
  });
  const weekEntries = weekQuery.data;
  const isLoading = weekQuery.isLoading;

  // --- Mutations ---
  // En fejlet flytning/ændring af længde siges højt — blokken hopper ellers
  // bare tilbage uden forklaring.
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

  // --- Drag-and-drop ---
  const {
    dragState,
    isDragging,
    registerGridRef,
    handleGridMouseDown,
    handleBlockMouseDown,
    handleResizeMouseDown,
  } = useWeekCalendarDrag({
    onCreateEnd: (_dateStr, date, startMinutes, endMinutes) => {
      setCreatePopup({ date, startMinutes, endMinutes });
    },
    onMoveEnd: (blockId, dateStr, date, startMinutes, endMinutes) => {
      const entry = weekEntries?.find((e) => e.id === blockId);
      if (!entry) return;
      const hours = Math.max(0.01, (endMinutes - startMinutes) / 60);
      const startDate = minutesToDate(date, startMinutes);
      const endDate = minutesToDate(date, endMinutes);
      updateMutation.mutate({
        id: blockId,
        hours,
        date: dateStr,
        description: entry.description,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
      });
    },
    onResizeEnd: (blockId, startMinutes, endMinutes) => {
      const entry = weekEntries?.find((e) => e.id === blockId);
      if (!entry) return;
      const hours = Math.max(0.01, (endMinutes - startMinutes) / 60);
      const baseDate = new Date(`${entry.date}T00:00:00`);
      const startDate = minutesToDate(baseDate, startMinutes);
      const endDate = minutesToDate(baseDate, endMinutes);
      updateMutation.mutate({
        id: blockId,
        hours,
        date: entry.date,
        description: entry.description,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
      });
    },
  });

  // Group entries by day
  const entriesByDay = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    for (let i = 0; i < 7; i++) {
      const dayStr = toLocalDateStr(addDays(weekStart, i));
      map[dayStr] = [];
    }
    if (weekEntries) {
      for (const entry of weekEntries) {
        if (map[entry.date]) {
          map[entry.date].push(entry);
        }
      }
    }
    return map;
  }, [weekEntries, weekStart]);

  // Poster uden start/slut har ingen plads i gitteret — de listes pr. dag
  const untimedByDay = useMemo(() => {
    const result: Record<string, CalendarEntry[]> = {};
    let any = false;
    for (const [dayStr, entries] of Object.entries(entriesByDay)) {
      result[dayStr] = entries.filter((e) => !e.startTime || !e.endTime);
      if (result[dayStr].length > 0) any = true;
    }
    return any ? result : null;
  }, [entriesByDay]);

  // Hours per day
  const hoursByDay = useMemo(() => {
    const result: Record<string, number> = {};
    for (const [dayStr, entries] of Object.entries(entriesByDay)) {
      result[dayStr] = entries.reduce((sum, e) => sum + e.hours, 0);
    }
    return result;
  }, [entriesByDay]);

  // Now-line tracking
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to current hour, once the grid is rendered (it isn't while
  // loading). With the full 00–24 day this keeps "now" in view.
  const didScroll = useRef(false);
  useEffect(() => {
    if (isLoading || didScroll.current || !scrollRef.current) return;
    didScroll.current = true;
    const now = new Date();
    const currentHour = now.getHours();
    const scrollTarget = Math.max(
      0,
      ((currentHour - START_HOUR - 2) / TOTAL_HOURS) *
        scrollRef.current.scrollHeight,
    );
    scrollRef.current.scrollTop = scrollTarget;
  }, [isLoading]);

  // Navigation
  const goToPrevWeek = () => setWeekStart(addDays(weekStart, -7));
  const goToNextWeek = () => setWeekStart(getMonday(addDays(weekStart, 7)));
  const goToToday = () => setWeekStart(getMonday(new Date()));

  // Week label
  const weekNumber = getWeekNumber(weekStart);
  const startLabel = weekStart.toLocaleDateString(toIntlLocale(locale), {
    day: "numeric",
  });
  const endLabel = weekEnd.toLocaleDateString(toIntlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Hour labels
  const hours = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i),
    [],
  );

  const showNowLine =
    nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60;
  const nowPercent = minutesToPercent(nowMinutes);

  // Find today's column index (0-6, -1 if not visible)
  const todayColumnIndex = useMemo(() => {
    for (let i = 0; i < 7; i++) {
      if (toLocalDateStr(addDays(weekStart, i)) === todayStr) return i;
    }
    return -1;
  }, [weekStart, todayStr]);

  // Double-click to quick-create (30 min block)
  const handleDoubleClick = useCallback(
    (
      e: React.MouseEvent,
      _dayStr: string,
      day: Date,
      gridEl: HTMLDivElement,
    ) => {
      const rect = gridEl.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ratio = Math.max(0, Math.min(1, y / rect.height));
      const rawMinutes = START_HOUR * 60 + ratio * TOTAL_HOURS * 60;
      const snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
      setCreatePopup({
        date: day,
        startMinutes: Math.max(START_HOUR * 60, snapped),
        endMinutes: Math.min(END_HOUR * 60, snapped + 30),
      });
    },
    [],
  );

  // Block click handler (open detail popup unless we were dragging)
  const handleBlockClick = useCallback(
    (entry: CalendarEntry) => {
      if (isDragging) return;
      setSelectedEntry((prev) => (prev?.id === entry.id ? null : entry));
    },
    [isDragging],
  );

  /** Get visual position for a block, accounting for active drag state */
  const getBlockPosition = (
    entry: CalendarEntry,
    startMin: number,
    endMin: number,
    drag: DragState | null,
  ) => {
    if (drag && drag.blockId === entry.id) {
      return {
        dateStr: drag.dateStr,
        startMin: Math.min(drag.startMinutes, drag.endMinutes),
        endMin: Math.max(drag.startMinutes, drag.endMinutes),
      };
    }
    return { dateStr: entry.date, startMin, endMin };
  };

  return (
    <div className="flex flex-col h-full">
      {/* Week navigation */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToPrevWeek}
            className="p-1.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-md transition-colors"
            aria-label={t("views.calendar.prevWeek")}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={goToNextWeek}
            className="p-1.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-md transition-colors"
            aria-label={t("views.calendar.nextWeek")}
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            onClick={goToToday}
            className="px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-primary-600 hover:bg-[var(--color-surface-sunken)] rounded-md transition-colors"
          >
            {t("views.calendar.today")}
          </button>
        </div>

        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {t("views.calendar.weekRange", {
            week: weekNumber,
            range: `${startLabel}–${endLabel}`,
          })}
        </h2>

        <button
          type="button"
          onClick={() => {
            // Tastaturvejen til oprettelse: i dag, hvis ugen er den aktuelle
            const inWeek = Array.from({ length: 7 }, (_, i) =>
              toLocalDateStr(addDays(weekStart, i)),
            ).includes(todayStr);
            setCreatePopup(newEntrySlot(inWeek ? new Date() : weekStart));
          }}
          className="inline-flex items-center gap-1.5 px-3 min-h-8 text-sm font-medium bg-primary-600 text-[var(--color-on-primary)] rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus size={16} aria-hidden="true" />
          {t("views.calendar.newEntry")}
        </button>
      </div>

      {/* Day headers */}
      <div className="flex border-b border-[var(--color-border-subtle)]">
        {/* Time gutter spacer */}
        <div className="w-14 flex-shrink-0" />
        {Array.from({ length: 7 }, (_, i) => {
          const day = addDays(weekStart, i);
          const dayStr = toLocalDateStr(day);
          const isToday = dayStr === todayStr;
          const dayHours = hoursByDay[dayStr] ?? 0;

          return (
            <div
              key={dayStr}
              className={`flex-1 text-center py-2 ${
                isToday ? "bg-primary-50/50" : ""
              }`}
            >
              <div
                className={`text-xs font-semibold ${
                  isToday
                    ? "text-primary-600"
                    : "text-[var(--color-text-muted)]"
                }`}
              >
                {t(`format.weekdayShort.${DAY_KEYS[i]}`)}
              </div>
              <div
                className={`text-sm font-bold ${
                  isToday
                    ? "text-primary-600"
                    : "text-[var(--color-text-primary)]"
                }`}
              >
                {day.getDate()}
              </div>
              {dayHours > 0 && (
                <div className="text-[11px] text-[var(--color-text-muted)] font-medium tabular-nums">
                  {formatHoursShort(dayHours)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Poster uden tidspunkt, pr. dag */}
      {untimedByDay && (
        <div className="flex border-b border-[var(--color-border-subtle)] py-1.5">
          <div className="w-14 flex-shrink-0 pr-2 text-right text-[10px] leading-tight text-[var(--color-text-muted)]">
            {t("views.calendar.untimed")}
          </div>
          {Array.from({ length: 7 }, (_, i) => {
            const dayStr = toLocalDateStr(addDays(weekStart, i));
            return (
              <div key={dayStr} className="flex-1 min-w-0 px-0.5">
                <UntimedEntries
                  compact
                  entries={untimedByDay[dayStr] ?? []}
                  onSelect={(entry) => setSelectedEntry(entry)}
                />
              </div>
            );
          })}
        </div>
      )}

      {moveError && (
        <div
          className="mx-4 my-2 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg"
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

      {/* Time grid */}
      {weekQuery.isError ? (
        <div
          className="flex-1 flex flex-col items-center justify-center py-16 text-center"
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
      ) : isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="relative" style={{ height: `${TOTAL_HOURS * 48}px` }}>
            {/* Hour lines */}
            {hours.map((hour) => {
              const top = ((hour - START_HOUR) / TOTAL_HOURS) * 100;
              return (
                <div
                  key={hour}
                  className="absolute left-0 right-0 pointer-events-none"
                  style={{ top: `${top}%` }}
                >
                  <div className="flex items-start">
                    <span className="text-[10px] text-[var(--color-text-muted)] w-14 text-right pr-3 -mt-2">
                      {String(hour).padStart(2, "0")}:00
                    </span>
                    <div className="flex-1 border-t border-[var(--color-border-subtle)]" />
                  </div>
                </div>
              );
            })}

            {/* Day columns with entries */}
            <div className="absolute top-0 bottom-0 left-14 right-0 flex">
              {Array.from({ length: 7 }, (_, i) => {
                const day = addDays(weekStart, i);
                const dayStr = toLocalDateStr(day);
                const isToday = dayStr === todayStr;
                const dayEntries = entriesByDay[dayStr] || [];

                // Collect entries that should render in this column
                // (includes blocks being dragged into this column)
                const visibleEntries: {
                  entry: CalendarEntry;
                  startMin: number;
                  endMin: number;
                  isDragged: boolean;
                }[] = [];

                for (const entry of dayEntries) {
                  if (!entry.startTime || !entry.endTime) continue;
                  const start = new Date(entry.startTime);
                  const end = new Date(entry.endTime);
                  const startMin = start.getHours() * 60 + start.getMinutes();
                  let endMin = end.getHours() * 60 + end.getMinutes();
                  if (endMin <= startMin) endMin = END_HOUR * 60;

                  const pos = getBlockPosition(
                    entry,
                    startMin,
                    endMin,
                    dragState,
                  );

                  // If block is being dragged to a different column, skip it here
                  if (pos.dateStr !== dayStr) continue;

                  visibleEntries.push({
                    entry,
                    startMin: pos.startMin,
                    endMin: pos.endMin,
                    isDragged: dragState?.blockId === entry.id,
                  });
                }

                // Also render blocks dragged INTO this column from another day
                if (
                  dragState &&
                  dragState.dateStr === dayStr &&
                  dragState.blockId
                ) {
                  const alreadyRendered = visibleEntries.some(
                    (v) => v.entry.id === dragState.blockId,
                  );
                  if (!alreadyRendered) {
                    // Find the entry from all week entries
                    const draggedEntry = weekEntries?.find(
                      (e) => e.id === dragState.blockId,
                    );
                    if (draggedEntry) {
                      visibleEntries.push({
                        entry: draggedEntry,
                        startMin: Math.min(
                          dragState.startMinutes,
                          dragState.endMinutes,
                        ),
                        endMin: Math.max(
                          dragState.startMinutes,
                          dragState.endMinutes,
                        ),
                        isDragged: true,
                      });
                    }
                  }
                }

                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: kun-mus-håndtag til træk/resize; tiderne kan også rettes via redigeringsformularen
                  <div
                    key={dayStr}
                    ref={(el) => {
                      if (el) registerGridRef(dayStr, el);
                    }}
                    className={`flex-1 relative border-l border-[var(--color-border-subtle)] cursor-crosshair ${
                      isToday ? "bg-primary-50/20" : ""
                    }`}
                    onMouseDown={(e) => handleGridMouseDown(e, dayStr, day)}
                    onDoubleClick={(e) => {
                      const gridEl = e.currentTarget as HTMLDivElement;
                      handleDoubleClick(e, dayStr, day, gridEl);
                    }}
                  >
                    {/* Drag-to-create overlay */}
                    {dragState &&
                      dragState.type === "create" &&
                      dragState.dateStr === dayStr && (
                        <div
                          className="absolute left-0.5 right-0.5 bg-primary-500/20 border border-primary-500/40 rounded-md pointer-events-none z-10"
                          style={{
                            top: `${minutesToPercent(
                              Math.min(
                                dragState.startMinutes,
                                dragState.endMinutes,
                              ),
                            )}%`,
                            height: `${Math.max(
                              minutesToPercent(
                                Math.max(
                                  dragState.startMinutes,
                                  dragState.endMinutes,
                                ),
                              ) -
                                minutesToPercent(
                                  Math.min(
                                    dragState.startMinutes,
                                    dragState.endMinutes,
                                  ),
                                ),
                              1.5,
                            )}%`,
                          }}
                        >
                          <div className="px-1.5 py-0.5 text-[11px] font-medium text-primary-700">
                            {t("views.calendar.newEntry")}
                          </div>
                        </div>
                      )}

                    {/* Time blocks */}
                    {visibleEntries.map(
                      ({ entry, startMin, endMin, isDragged }) => {
                        const topPct = minutesToPercent(startMin);
                        const heightPct = minutesToPercent(endMin) - topPct;
                        const color = clientColorVar(entry.clientId);
                        const isSelected = selectedEntry?.id === entry.id;
                        const title =
                          entry.clientName || t("views.calendar.internal");
                        const subtitle =
                          entry.projectName || entry.description || "";

                        return (
                          // biome-ignore lint/a11y/useSemanticElements: blokken har træk-håndtag inde i sig og kan ikke være en <button>
                          <div
                            key={entry.id}
                            role="button"
                            tabIndex={0}
                            aria-label={t("views.calendar.blockLabel", {
                              title,
                              subtitle: subtitle ? `, ${subtitle}` : "",
                              day: day.toLocaleDateString(
                                toIntlLocale(locale),
                                {
                                  weekday: "long",
                                  day: "numeric",
                                  month: "long",
                                },
                              ),
                              start: formatMinutesOfDay(startMin),
                              end: formatMinutesOfDay(endMin),
                            })}
                            aria-pressed={isSelected}
                            className={`tt-kal-blok absolute left-0.5 right-0.5 rounded-md overflow-hidden text-left group select-none ${
                              isDragged
                                ? "opacity-80 shadow-lg z-20"
                                : isSelected
                                  ? "ring-2 ring-primary-600 ring-offset-1 z-10"
                                  : "hover:scale-x-[1.02] z-[1]"
                            } transition-transform duration-100`}
                            style={
                              {
                                top: `${topPct}%`,
                                height: `${Math.max(heightPct, 1.5)}%`,
                                cursor: isDragged ? "grabbing" : "grab",
                                "--kal": color,
                              } as React.CSSProperties
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleBlockClick(entry);
                              }
                            }}
                            onMouseDown={(e) =>
                              handleBlockMouseDown(
                                e,
                                entry.id,
                                dayStr,
                                day,
                                startMin,
                                endMin,
                              )
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBlockClick(entry);
                            }}
                          >
                            {/* Resize handle: top */}
                            {/* biome-ignore lint/a11y/noStaticElementInteractions: kun-mus-håndtag til træk/resize; tiderne kan også rettes via redigeringsformularen */}
                            <div
                              className="tt-kal-greb absolute top-0 left-0 right-0 h-1.5 cursor-n-resize z-10 opacity-0 group-hover:opacity-100"
                              onMouseDown={(e) =>
                                handleResizeMouseDown(
                                  e,
                                  entry.id,
                                  dayStr,
                                  day,
                                  startMin,
                                  endMin,
                                  "top",
                                )
                              }
                            />

                            {/* Content */}
                            <div className="px-1.5 py-0.5 h-full flex flex-col justify-center overflow-hidden">
                              <span
                                className={`font-semibold truncate leading-tight ${
                                  heightPct > 3 ? "text-xs" : "text-[11px]"
                                }`}
                              >
                                {title}
                              </span>
                              {heightPct > 3 && subtitle && (
                                <span className="text-[11px] leading-tight text-[var(--color-text-secondary)] truncate">
                                  {subtitle}
                                </span>
                              )}
                            </div>

                            {/* Resize handle: bottom */}
                            {/* biome-ignore lint/a11y/noStaticElementInteractions: kun-mus-håndtag til træk/resize; tiderne kan også rettes via redigeringsformularen */}
                            <div
                              className="tt-kal-greb absolute bottom-0 left-0 right-0 h-1.5 cursor-s-resize z-10 opacity-0 group-hover:opacity-100"
                              onMouseDown={(e) =>
                                handleResizeMouseDown(
                                  e,
                                  entry.id,
                                  dayStr,
                                  day,
                                  startMin,
                                  endMin,
                                  "bottom",
                                )
                              }
                            />
                          </div>
                        );
                      },
                    )}
                  </div>
                );
              })}
            </div>

            {/* Now line */}
            {showNowLine && todayColumnIndex >= 0 && (
              <div
                className="absolute left-14 right-0 z-20 pointer-events-none"
                style={{ top: `${nowPercent}%` }}
              >
                <div className="relative">
                  <div
                    className="absolute -top-1 w-2 h-2 rounded-full bg-red-500"
                    style={{
                      left: `${(todayColumnIndex / 7) * 100}%`,
                    }}
                  />
                  <div className="border-t border-red-500" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Entry detail popup */}
      {selectedEntry && (
        <BlockDetailPopup
          entry={{
            ...selectedEntry,
            projectId: selectedEntry.projectId ?? null,
          }}
          onClose={() => setSelectedEntry(null)}
          onEdit={() => {
            setEditingEntry(selectedEntry);
            setSelectedEntry(null);
          }}
        />
      )}

      {/* Edit entry popup */}
      {editingEntry && (
        <EditEntryPopup
          entry={{
            ...editingEntry,
            projectId: editingEntry.projectId ?? null,
          }}
          onClose={() => setEditingEntry(null)}
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
    </div>
  );
}
