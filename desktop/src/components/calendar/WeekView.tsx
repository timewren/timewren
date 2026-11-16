import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "@/components/ui/LoadError";
import { useMergeGapSeconds } from "@/hooks/useMergeGapSeconds";
import { useSlotCursor } from "@/hooks/useSlotCursor";
import {
  type ActivityBlock,
  mergeActivitiesIntoBlocks,
} from "@/lib/activityBlocks";
import {
  getDayName,
  getWeekDays,
  isSameDay,
  isToday,
  splitAtMidnight,
  toISODateStr,
} from "@/lib/calendar";
import { formatDuration, toLocalDateStr } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { Activity, TimeEntry } from "@/lib/types";
import { CalendarEntry } from "./CalendarEntry";
import { GhostBlock } from "./GhostBlock";

interface WeekViewProps {
  date: Date;
  onEditEntry: (entry: TimeEntry) => void;
  onCreateEntry: (date: string, startTime: string, endTime: string) => void;
}

const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_HEIGHT = 60; // pixels per hour
const TOTAL_HOURS = END_HOUR - START_HOUR;

export function WeekView({ date, onEditEntry, onCreateEntry }: WeekViewProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const fetchNr = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Drag-to-create state
  const [dragState, setDragState] = useState<{
    dayIndex: number;
    startY: number;
    currentY: number;
  } | null>(null);

  const days = useMemo(() => getWeekDays(date), [date]);

  const fetchData = useCallback(() => {
    const from = toISODateStr(days[0]);
    const to = toISODateStr(days[6]);

    // Én fejl fælder for hele ugen: en delvis tegnet uge er værre end en
    // tydelig fejl, fordi summen så bare er for lav uden at sige det.
    //
    // Kaldene nummereres, fordi de ikke er samtidige: brugeren kan skifte
    // uge, og et kald for sidste uge kan komme tilbage efter et for denne.
    const kald = ++fetchNr.current;
    const gælder = () => fetchNr.current === kald;

    Promise.all([
      tauriInvoke<TimeEntry[]>("list_time_entries", { from, to }),
      // Single range query instead of 7 separate list_activities calls
      tauriInvoke<Activity[]>("list_activities_range", { from, to }),
    ])
      .then(([entriesResult, activityResult]) => {
        if (!gælder()) return;
        setEntries(entriesResult);
        setActivities(activityResult);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!gælder()) return;
        setEntries([]);
        setActivities([]);
        setLoadFailed(true);
      });
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const currentHour = now.getHours();
      const scrollTo = Math.max(
        0,
        (currentHour - START_HOUR - 1) * HOUR_HEIGHT,
      );
      scrollRef.current.scrollTop = scrollTo;
    }
  }, []);

  // Group entries by day, splitting midnight-crossing entries into visual segments
  const entriesByDay = useMemo(() => {
    const map = new Map<
      number,
      Array<{ entry: TimeEntry; displayStart: string; displayEnd: string }>
    >();
    for (let i = 0; i < 7; i++) map.set(i, []);

    for (const entry of entries) {
      const segments = splitAtMidnight(entry);
      for (const seg of segments) {
        for (let i = 0; i < 7; i++) {
          if (isSameDay(seg.dayDate, days[i])) {
            map.get(i)?.push({
              entry: seg.entry,
              displayStart: seg.displayStart,
              displayEnd: seg.displayEnd,
            });
            break;
          }
        }
      }
    }
    return map;
  }, [entries, days]);

  // Group activities by day (unconfirmed only), then merge adjacent
  // activities per day so a work session renders as one ghost block
  // instead of a fragmented stack — same approach as DayView
  const maxGapSeconds = useMergeGapSeconds();
  const activityBlocksByDay = useMemo(() => {
    const byDay = new Map<number, Activity[]>();
    for (let i = 0; i < 7; i++) byDay.set(i, []);

    for (const act of activities) {
      if (act.is_confirmed) continue;
      const actDate = new Date(act.started_at);
      for (let i = 0; i < 7; i++) {
        if (isSameDay(actDate, days[i])) {
          byDay.get(i)?.push(act);
          break;
        }
      }
    }

    const map = new Map<number, ActivityBlock[]>();
    for (const [i, dayActivities] of byDay) {
      map.set(i, mergeActivitiesIntoBlocks(dayActivities, { maxGapSeconds }));
    }
    return map;
  }, [activities, days, maxGapSeconds]);

  // Current time indicator position
  const [currentTimePos, setCurrentTimePos] = useState<number | null>(null);
  useEffect(() => {
    function updateTime() {
      const now = new Date();
      const h = now.getHours() + now.getMinutes() / 60;
      if (h >= START_HOUR && h <= END_HOUR) {
        setCurrentTimePos((h - START_HOUR) * HOUR_HEIGHT);
      } else {
        setCurrentTimePos(null);
      }
    }
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  // Is today visible in this week?
  const todayIndex = useMemo(() => {
    const now = new Date();
    return days.findIndex((d) => isSameDay(d, now));
  }, [days]);

  // Keyboard equivalent of drag-to-create. One cursor per view — the focused
  // day decides which column it appears in, so Left/Right can move between
  // days without losing the time.
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const cursorRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusDayRef = useRef<number | null>(null);
  // The day the cursor is shown in — the focused one, else the hovered one.
  const cursorDay = focusedDay ?? hoveredDay;

  const slot = useSlotCursor({
    startHour: START_HOUR,
    totalHours: TOTAL_HOURS,
    quarterHeight: HOUR_HEIGHT / 4,
    scrollRef,
    onCreate: (startTime, endTime) => {
      // A click can land in a hovered-but-unfocused column, so use the day the
      // cursor is drawn in — not the first day of the week.
      const day = days[cursorDay ?? 0];
      onCreateEntry(toLocalDateStr(day), startTime, endTime);
    },
    onHorizontal: (delta) => {
      // Start from the day the cursor is drawn in, so a hovered-but-not-yet-
      // focused column still moves from where the user is looking.
      const current = cursorDay ?? 0;
      const next = current + delta;
      if (next < 0 || next >= days.length) return false;
      // Only the cursor's own column holds a button, so it is mounted after
      // the state change — the effect below hands it the focus.
      focusDayRef.current = next;
      setFocusedDay(next);
      return true;
    },
  });

  // Drag-to-create handlers
  function handleMouseDown(dayIndex: number, e: React.MouseEvent) {
    if (e.button !== 0) return;
    // The cursor's own button handles its clicks — dragging from it would
    // both move the block and fire its click, creating two entries.
    if ((e.target as HTMLElement).closest("[data-slot-cursor]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setDragState({ dayIndex, startY: y, currentY: y });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragState) return;
    const dayCol = gridRef.current?.children[dragState.dayIndex + 1] as
      | HTMLElement
      | undefined;
    if (!dayCol) return;
    const rect = dayCol.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setDragState((prev) => (prev ? { ...prev, currentY: y } : null));
  }

  function handleMouseUp() {
    if (!dragState) return;

    const minY = Math.min(dragState.startY, dragState.currentY);
    const maxY = Math.max(dragState.startY, dragState.currentY);

    // Convert Y positions to times, snapped to 15-min grid
    const startHours = START_HOUR + minY / HOUR_HEIGHT;
    const endHours = START_HOUR + maxY / HOUR_HEIGHT;

    const snapTo15 = (h: number) => Math.round(h * 4) / 4;
    const snappedStart = snapTo15(startHours);
    const snappedEnd = snapTo15(endHours);

    // Only create if dragged at least 15 minutes
    if (snappedEnd - snappedStart >= 0.25) {
      const day = days[dragState.dayIndex];
      const dateStr = toLocalDateStr(day);
      const startH = Math.floor(snappedStart);
      const startM = Math.round((snappedStart - startH) * 60);
      const endH = Math.floor(snappedEnd);
      const endM = Math.round((snappedEnd - endH) * 60);

      const startTime = `${startH.toString().padStart(2, "0")}:${startM.toString().padStart(2, "0")}`;
      const endTime = `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;

      onCreateEntry(dateStr, startTime, endTime);
    }

    setDragState(null);
  }

  // Weekly totals by project
  const weeklyTotals = useMemo(() => {
    const totals = new Map<
      string,
      { name: string; color: string; seconds: number }
    >();
    let totalSeconds = 0;

    for (const entry of entries) {
      const dur = entry.duration ?? 0;
      totalSeconds += dur;
      const key = entry.project_id ?? "__none__";
      const existing = totals.get(key);
      if (existing) {
        existing.seconds += dur;
      } else {
        totals.set(key, {
          name: entry.project_name ?? t("calendar.withoutProject"),
          color: entry.project_color ?? "#6b7280",
          seconds: dur,
        });
      }
    }

    return { projects: Array.from(totals.values()), totalSeconds };
  }, [entries, t]);

  // Time labels
  const hours = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i),
    [],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Column headers */}
      <div className="flex shrink-0 border-b border-(--color-border)">
        {/* Time gutter */}
        <div className="w-14 shrink-0" />
        {/* Day columns */}
        {days.map((day) => {
          const today = isToday(day);
          return (
            <div
              key={toLocalDateStr(day)}
              className={`flex flex-1 flex-col items-center border-l border-(--color-border) py-2 ${today ? "bg-(--color-accent)/5" : ""}`}
            >
              <span
                className={`text-[11px] font-medium ${today ? "text-(--color-accent)" : "text-(--color-text-muted)"}`}
              >
                {getDayName(day)}
              </span>
              <span
                className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${today ? "bg-(--color-accent) text-white" : "text-(--color-text)"}`}
              >
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* En fejlet indlæsning erstatter gitteret, så en låst database ikke
          tegner en arbejdsuge uden registreringer. */}
      {loadFailed ? (
        <LoadError
          message={t("errors.couldNotLoadEntries")}
          onRetry={fetchData}
          className="flex-1"
        />
      ) : (
        <>
          {/* Scrollable time grid */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-create surface has no ARIA role; it only mirrors the mouse position while dragging */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div
              ref={gridRef}
              className="relative flex"
              style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}
            >
              {/* Time labels */}
              <div className="relative w-14 shrink-0">
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute right-2 -translate-y-1/2 text-[10px] text-(--color-text-muted)/60"
                    style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px` }}
                  >
                    {h.toString().padStart(2, "0")}:00
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {days.map((day, dayIndex) => {
                const today = isToday(day);
                const dayEntries = entriesByDay.get(dayIndex) ?? [];
                const dayBlocks = activityBlocksByDay.get(dayIndex) ?? [];

                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: day column is the drag-to-create surface; a role here would misdescribe it
                  <div
                    key={toLocalDateStr(day)}
                    className={`relative flex-1 border-l border-(--color-border) ${today ? "bg-(--color-accent)/3" : ""}`}
                    onMouseDown={(e) => handleMouseDown(dayIndex, e)}
                    onMouseEnter={() => setHoveredDay(dayIndex)}
                    onMouseLeave={() =>
                      setHoveredDay((prev) => (prev === dayIndex ? null : prev))
                    }
                  >
                    {/* Hour grid lines */}
                    {hours.map((h) => (
                      <div
                        key={h}
                        className="absolute inset-x-0 border-t border-(--color-border)/40"
                        style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px` }}
                      />
                    ))}

                    {/* 15-min grid lines (dotted) */}
                    {hours.map((h) =>
                      [1, 2, 3].map((q) => (
                        <div
                          key={`${h}-${q}`}
                          className="absolute inset-x-0 border-t border-dotted border-(--color-border)/15"
                          style={{
                            top: `${(h - START_HOUR) * HOUR_HEIGHT + q * (HOUR_HEIGHT / 4)}px`,
                          }}
                        />
                      )),
                    )}

                    {/* Ghost blocks (one per merged block of adjacent activities) */}
                    {dayBlocks.map((block) => {
                      // Only show a confidence % when every member has one — use
                      // the lowest so a merged block never overstates certainty
                      let confidence: number | null = 1;
                      for (const member of block.activities) {
                        if (member.confidence === null) {
                          confidence = null;
                          break;
                        }
                        confidence = Math.min(confidence, member.confidence);
                      }
                      return (
                        <GhostBlock
                          key={block.activityIds[0]}
                          activity={{
                            ...block.activities[0],
                            window_title: block.dominantTitle,
                            confidence,
                            started_at: block.startedAt,
                            ended_at: block.endedAt,
                            duration: block.totalDuration,
                          }}
                          activityIds={block.activityIds}
                          hourHeight={HOUR_HEIGHT}
                          startHour={START_HOUR}
                          onConfirmed={fetchData}
                        />
                      );
                    })}

                    {/* Confirmed entries */}
                    {dayEntries.map((seg) => (
                      <CalendarEntry
                        key={`${seg.entry.id}-${seg.displayStart}`}
                        entry={seg.entry}
                        hourHeight={HOUR_HEIGHT}
                        startHour={START_HOUR}
                        onClick={onEditEntry}
                        displayStart={seg.displayStart}
                        displayEnd={seg.displayEnd}
                      />
                    ))}

                    {/* Current time indicator */}
                    {todayIndex === dayIndex && currentTimePos !== null && (
                      <div
                        className="absolute inset-x-0 z-20 flex items-center"
                        style={{ top: `${currentTimePos}px` }}
                      >
                        <div className="h-2 w-2 -translate-x-1 rounded-full bg-red-500" />
                        <div className="h-px flex-1 bg-red-500" />
                      </div>
                    )}

                    {/* Keyboard cursor — the block a keyboard user moves with the
                    arrow keys and turns into an entry with Enter. */}
                    {cursorDay === dayIndex && (
                      <>
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-1 z-30 rounded-md border-2 border-dashed border-(--color-accent) bg-(--color-accent)/10"
                          style={{
                            top: `${slot.geometry.top}px`,
                            height: `${slot.geometry.height}px`,
                          }}
                        />
                        <button
                          type="button"
                          data-slot-cursor
                          ref={(el) => {
                            cursorRefs.current[dayIndex] = el;
                            // Left/Right aimed at this day while its button did
                            // not exist yet — take the focus as it is mounted.
                            if (el && focusDayRef.current === dayIndex) {
                              focusDayRef.current = null;
                              el.focus();
                            }
                          }}
                          // No onBlur: unmounting the pill while the keyboard
                          // focus is on it would send the next Tab back to the
                          // top of the window. The focused day simply wins over
                          // the hovered one until the focus leaves the grid.
                          onFocus={() => setFocusedDay(dayIndex)}
                          onKeyDown={slot.handleKeyDown}
                          onClick={slot.create}
                          aria-label={t("calendar.slotCursorLabel", {
                            start: slot.times.startTime,
                            end: slot.times.endTime,
                          })}
                          className="absolute left-1 z-30 inline-flex min-h-[24px] items-center gap-1 rounded-md border border-(--color-accent) bg-(--color-accent) px-1 text-[10px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/60 focus-visible:ring-offset-1 focus-visible:ring-offset-(--color-bg)"
                          style={{ top: `${slot.geometry.top}px` }}
                        >
                          <Plus size={10} />
                          {slot.times.startTime}
                        </button>
                        <span aria-live="polite" className="sr-only">
                          {`${slot.times.startTime}-${slot.times.endTime}`}
                        </span>
                      </>
                    )}

                    {/* Drag-to-create phantom */}
                    {dragState && dragState.dayIndex === dayIndex && (
                      <div
                        className="absolute inset-x-1 z-30 rounded-md border-2 border-dashed border-(--color-accent) bg-(--color-accent)/10"
                        style={{
                          top: `${Math.min(dragState.startY, dragState.currentY)}px`,
                          height: `${Math.abs(dragState.currentY - dragState.startY)}px`,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Weekly total footer */}
      {weeklyTotals.totalSeconds > 0 && (
        <div className="shrink-0 border-t border-(--color-border) px-4 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-(--color-text-muted)">
              {t("calendar.weeklyTotal")}
            </span>
            <span className="text-xs font-bold text-(--color-text)">
              {formatDuration(weeklyTotals.totalSeconds)}
            </span>
          </div>
          {/* Stacked bar */}
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            {weeklyTotals.projects.map((p) => (
              <div
                key={p.name}
                className="h-full transition-all"
                style={{
                  width: `${(p.seconds / weeklyTotals.totalSeconds) * 100}%`,
                  backgroundColor: p.color,
                }}
                title={`${p.name}: ${formatDuration(p.seconds)}`}
              />
            ))}
          </div>
          {/* Labels */}
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {weeklyTotals.projects.map((p) => (
              <div key={p.name} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="text-[10px] text-(--color-text-muted)">
                  {p.name} {formatDuration(p.seconds)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
