import { CalendarClock, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadError";
import { useMergeGapSeconds } from "@/hooks/useMergeGapSeconds";
import { useSlotCursor } from "@/hooks/useSlotCursor";
import { mergeActivitiesIntoBlocks } from "@/lib/activityBlocks";
import {
  formatShortDate,
  getDayName,
  isSameDay,
  isToday,
  splitAtMidnight,
  timeToHours,
  toISODateStr,
} from "@/lib/calendar";
import { formatDuration, formatTime, toLocalDateStr } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { Activity, TimeEntry, UncoveredCalendarEvent } from "@/lib/types";
import { toast } from "@/stores/toastStore";
import { CalendarSuggestionBlock } from "./CalendarSuggestionBlock";
import { GhostBlock } from "./GhostBlock";

interface DayViewProps {
  date: Date;
  onEditEntry: (entry: TimeEntry) => void;
  onCreateEntry: (date: string, startTime: string, endTime: string) => void;
  /**
   * Moves a whole day back/forward. Arrow keys on the slot cursor call this,
   * so a keyboard user can reach another day without the mouse.
   *
   * The view is deliberately *not* remounted when the date changes — see the
   * effect that resets the day's data — so the cursor keeps its position and
   * the focus stays on the button the user is pressing keys on.
   */
  onNavigateDay: (delta: -1 | 1) => void;
}

const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_HEIGHT = 80; // Taller for day view
const TOTAL_HOURS = END_HOUR - START_HOUR;

function isDarkColor(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
}

export function DayView({
  date,
  onEditEntry,
  onCreateEntry,
  onNavigateDay,
}: DayViewProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [suggestions, setSuggestions] = useState<UncoveredCalendarEvent[]>([]);
  const [bulkLogging, setBulkLogging] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fetchNr = useRef(0);

  // Drag state
  const [dragState, setDragState] = useState<{
    startY: number;
    currentY: number;
  } | null>(null);

  const dateStr = useMemo(() => toISODateStr(date), [date]);
  const today = useMemo(() => isToday(date), [date]);

  const fetchData = useCallback(() => {
    // Alle tre læsninger hører til det samme billede af dagen: uden
    // `list_time_entries` er dagen tom, uden `list_activities` er de
    // ubekræftede blokke væk, og uden kalenderkaldene mangler møderne. Før
    // tømte hvert `catch` sin egen liste, så en låst database tegnede en hel
    // arbejdsdag uden en eneste registrering — den værste løgn i en app, der
    // skal hjælpe brugeren med at holde styr på sit arbejde.
    //
    // Kaldene nummereres, fordi de ikke er samtidige: brugeren kan skifte dag,
    // og et kald for i går kan komme tilbage efter et for i dag. Uden nummeret
    // kunne den gamle dags fejl tømme den nye dags indhold og hænge en
    // fejltekst op den dag, der virker.
    const kald = ++fetchNr.current;
    const gælder = () => fetchNr.current === kald;

    Promise.all([
      tauriInvoke<TimeEntry[]>("list_time_entries", {
        from: dateStr,
        to: dateStr,
      }),
      tauriInvoke<Activity[]>("list_activities", { date: dateStr }),
      // Calendar events not yet covered by a time entry — shown as dashed
      // suggestion blocks the user can log with one click.
      tauriInvoke<UncoveredCalendarEvent[]>("list_uncovered_calendar_events", {
        from: `${dateStr}T00:00:00`,
        to: `${dateStr}T23:59:59`,
      }),
    ])
      .then(([entriesResult, activityResult, suggestionResult]) => {
        if (!gælder()) return;
        setEntries(entriesResult);
        setActivities(activityResult.filter((a) => !a.is_confirmed));
        setSuggestions(suggestionResult);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!gælder()) return;
        setEntries([]);
        setActivities([]);
        setSuggestions([]);
        setLoadFailed(true);
      });
  }, [dateStr]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Dagens data hører til den dag de blev hentet for. `CalendarView` monterer
  // ikke længere viewet igen ved dataskift (det ville smide markørens
  // placering og tastaturfokus midt i en ←→-navigation), så tilstanden skal
  // nulstilles her i stedet. Uden nulstillingen tegner gårsdagens
  // registreringer dagens gitter, indtil det nye svar kommer — præcis den løgn
  // en beskyttet database giver (en fejlet indlæsning må aldrig se ud som en
  // hel arbejdsdag), bare med den modsatte forklaring.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `dateStr` er ikke læst i kroppen, men den er hele pointen — den skal *køre* effekten igen ved dataskift. Uden den ville nulstillingen kun ske ved mount.
  useEffect(() => {
    setEntries([]);
    setActivities([]);
    setSuggestions([]);
    setLoadFailed(false);
  }, [dateStr]);

  // Scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const scrollTo = Math.max(
        0,
        (now.getHours() - START_HOUR - 1) * HOUR_HEIGHT,
      );
      scrollRef.current.scrollTop = scrollTo;
    }
  }, []);

  // Current time indicator
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

  const hours = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i),
    [],
  );

  // Keyboard equivalent of drag-to-create
  const slot = useSlotCursor({
    startHour: START_HOUR,
    totalHours: TOTAL_HOURS,
    quarterHeight: HOUR_HEIGHT / 4,
    scrollRef,
    onCreate: (startTime, endTime) =>
      onCreateEntry(toLocalDateStr(date), startTime, endTime),
    onHorizontal: (delta) => {
      onNavigateDay(delta);
      return true;
    },
  });

  // Merge adjacent unconfirmed activities into blocks so a work session
  // renders as one ghost block instead of a fragmented stack
  const maxGapSeconds = useMergeGapSeconds();
  const activityBlocks = useMemo(
    () => mergeActivitiesIntoBlocks(activities, { maxGapSeconds }),
    [activities, maxGapSeconds],
  );

  // Daily total
  const totalSeconds = useMemo(
    () => entries.reduce((sum, e) => sum + (e.duration ?? 0), 0),
    [entries],
  );

  // Bulk: log every uncovered meeting for the day, each with its project guess.
  async function handleLogAllMeetings() {
    if (suggestions.length === 0 || bulkLogging) return;
    setBulkLogging(true);
    try {
      let logged = 0;
      for (const s of suggestions) {
        await tauriInvoke("convert_calendar_event", {
          eventId: s.event.id,
          projectId: s.guess_project_id,
        });
        logged++;
      }
      toast.success(t("calendar.meetingsLogged", { count: logged }));
      fetchData();
    } catch (err) {
      console.error("Failed to bulk-log meetings:", err);
      toast.error(t("calendar.couldNotLogMeeting"));
    } finally {
      setBulkLogging(false);
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    // The cursor's own button handles its clicks — dragging from it would
    // both move the block and fire its click, creating two entries.
    if ((e.target as HTMLElement).closest("[data-slot-cursor]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setDragState({ startY: y, currentY: y });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragState) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setDragState((prev) => (prev ? { ...prev, currentY: y } : null));
  }

  function handleMouseUp() {
    if (!dragState) return;
    const minY = Math.min(dragState.startY, dragState.currentY);
    const maxY = Math.max(dragState.startY, dragState.currentY);

    const snapTo15 = (h: number) => Math.round(h * 4) / 4;
    const snappedStart = snapTo15(START_HOUR + minY / HOUR_HEIGHT);
    const snappedEnd = snapTo15(START_HOUR + maxY / HOUR_HEIGHT);

    if (snappedEnd - snappedStart >= 0.25) {
      const startH = Math.floor(snappedStart);
      const startM = Math.round((snappedStart - startH) * 60);
      const endH = Math.floor(snappedEnd);
      const endM = Math.round((snappedEnd - endH) * 60);

      onCreateEntry(
        toLocalDateStr(date),
        `${startH.toString().padStart(2, "0")}:${startM.toString().padStart(2, "0")}`,
        `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`,
      );
    }
    setDragState(null);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-(--color-border) px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${today ? "text-(--color-accent)" : "text-(--color-text-muted)"}`}
          >
            {getDayName(date)}
          </span>
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold ${today ? "bg-(--color-accent) text-white" : "text-(--color-text)"}`}
          >
            {date.getDate()}
          </span>
          {/* ←/→ bytter dag, og fokus bliver liggende på markøren. Uden
              denne ville en skærmlæser høre intet, fordi markørens navn kun er
              klokkeslættet — den nye dag er usynlig, selv om dagen er ændret. */}
          <span aria-live="polite" className="sr-only" data-dag-status>
            {`${getDayName(date)} ${formatShortDate(date)} ${date.getFullYear()}`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {suggestions.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleLogAllMeetings}
              disabled={bulkLogging}
            >
              <CalendarClock size={14} />
              {t("calendar.logAllMeetings", { count: suggestions.length })}
            </Button>
          )}
          {totalSeconds > 0 && (
            <span className="text-sm font-medium text-(--color-text-muted)">
              {t("calendar.total")}: {formatDuration(totalSeconds)}
            </span>
          )}
        </div>
      </div>

      {/* En fejlet indlæsning erstatter gitteret, ikke bare indholdet i det.
          Uden dette viste en låst database en helt tom dag. */}
      {loadFailed ? (
        <LoadError
          message={t("errors.couldNotLoadEntries")}
          onRetry={fetchData}
          className="flex-1"
        />
      ) : (
        <>
          {/* Scrollable grid */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-create surface has no ARIA role; it only mirrors the mouse position while dragging */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div
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

              {/* Main column */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: day column is the drag-to-create surface; a role here would misdescribe it */}
              <div
                className={`relative flex-1 border-l border-(--color-border) ${today ? "bg-(--color-accent)/3" : ""}`}
                onMouseDown={handleMouseDown}
              >
                {/* Hour lines */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-(--color-border)/40"
                    style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px` }}
                  />
                ))}

                {/* 15-min lines */}
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
                {activityBlocks.map((block) => {
                  // Only show a confidence % when every member has one — use the
                  // lowest so a merged block never overstates certainty
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

                {/* Entries — wider, more detail (with midnight-split support) */}
                {entries
                  .flatMap((entry) => splitAtMidnight(entry))
                  .filter((seg) => isSameDay(seg.dayDate, date))
                  .map((seg) => {
                    const startH = timeToHours(seg.displayStart);
                    const endH = timeToHours(seg.displayEnd) || startH + 0.25;
                    const top = (startH - START_HOUR) * HOUR_HEIGHT;
                    const height = Math.max((endH - startH) * HOUR_HEIGHT, 8);
                    const bgColor = seg.entry.project_color ?? "#6b7280";
                    const dark = isDarkColor(bgColor);

                    return (
                      <button
                        type="button"
                        key={`${seg.entry.id}-${seg.displayStart}`}
                        onClick={() => onEditEntry(seg.entry)}
                        className="absolute inset-x-2 z-10 cursor-pointer overflow-hidden rounded-lg px-3 py-1.5 text-left transition-opacity hover:opacity-90"
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          backgroundColor: `${bgColor}cc`,
                          color: dark ? "#ffffff" : "#1a1a1a",
                          minHeight: "24px",
                        }}
                        title={seg.entry.description ?? undefined}
                      >
                        <div className="text-sm font-semibold">
                          {seg.entry.project_name ?? t("calendar.noProject")}
                        </div>
                        <div className="mt-0.5 text-xs opacity-80">
                          {formatTime(seg.displayStart)}
                          {`–${formatTime(seg.displayEnd)}`} ·{" "}
                          {formatDuration(seg.entry.duration ?? 0)}
                        </div>
                        {seg.entry.description && (
                          <div className="mt-1 text-xs opacity-60">
                            {seg.entry.description}
                          </div>
                        )}
                      </button>
                    );
                  })}

                {/* Calendar event suggestions (dashed) — not yet logged as time */}
                {suggestions
                  .filter((s) => isSameDay(new Date(s.event.start_time), date))
                  .map((s) => (
                    <CalendarSuggestionBlock
                      key={s.event.id}
                      item={s}
                      hourHeight={HOUR_HEIGHT}
                      startHour={START_HOUR}
                      onLogged={fetchData}
                    />
                  ))}

                {/* Current time */}
                {today && currentTimePos !== null && (
                  <div
                    className="absolute inset-x-0 z-20 flex items-center"
                    style={{ top: `${currentTimePos}px` }}
                  >
                    <div className="h-2.5 w-2.5 -translate-x-1 rounded-full bg-red-500" />
                    <div className="h-px flex-1 bg-red-500" />
                  </div>
                )}

                {/* Keyboard cursor — the block a keyboard user moves with the
                arrow keys and turns into an entry with Enter. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-2 z-30 rounded-lg border-2 border-dashed border-(--color-accent) bg-(--color-accent)/10"
                  style={{
                    top: `${slot.geometry.top}px`,
                    height: `${slot.geometry.height}px`,
                  }}
                />
                <button
                  type="button"
                  data-slot-cursor
                  onKeyDown={slot.handleKeyDown}
                  onClick={slot.create}
                  aria-label={t("calendar.slotCursorLabel", {
                    start: slot.times.startTime,
                    end: slot.times.endTime,
                  })}
                  className="absolute left-2 z-30 inline-flex min-h-[24px] items-center gap-1 rounded-md border border-(--color-accent) bg-(--color-accent) px-1.5 text-[11px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/60 focus-visible:ring-offset-1 focus-visible:ring-offset-(--color-bg)"
                  style={{ top: `${slot.geometry.top}px` }}
                >
                  <Plus size={11} />
                  {slot.times.startTime}
                </button>
                <span aria-live="polite" className="sr-only">
                  {`${slot.times.startTime}-${slot.times.endTime}`}
                </span>

                {/* Drag phantom */}
                {dragState && (
                  <div
                    className="absolute inset-x-2 z-30 rounded-lg border-2 border-dashed border-(--color-accent) bg-(--color-accent)/10"
                    style={{
                      top: `${Math.min(dragState.startY, dragState.currentY)}px`,
                      height: `${Math.abs(dragState.currentY - dragState.startY)}px`,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
