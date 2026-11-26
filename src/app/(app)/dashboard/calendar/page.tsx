"use client";

import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TimeEntryEditModal } from "@/components/TimeEntryEditModal";
import { ConfirmDialog } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";
import { useTimerStore } from "@/stores/timerStore";
import { AutoTrackBanner } from "./components/auto-track-banner";
import { BulkRegistrationModal } from "./components/bulk-registration-modal";
import { CalendarGridColumn } from "./components/calendar-grid";
import { ClientPickerModal } from "./components/client-picker-modal";
import { CreateEntryPopup } from "./components/create-entry-popup";
import { WeekSummary } from "./components/week-summary";
import { useCalendarDrag } from "./hooks/use-calendar-drag";
import type { ClientMatch, TimeBlock } from "./types";
import {
  addDays,
  blockToMinutes,
  dayLabel,
  formatTime,
  getMonday,
  getWeekNumber,
  HOUR_HEIGHT,
  minutesToDate,
  START_HOUR,
  TOTAL_HOURS,
  toLocalDateStr,
} from "./utils/calendar-math";

type View = "day" | "week";
const EMPTY_BLOCKS: TimeBlock[] = [];

/** Generate a deterministic pastel HSL hue from a string (clientId). */
function clientHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ((hash % 360) + 360) % 360;
}

// ----------- Main page -----------
export default function CalendarPage() {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const locale = useLocale();
  const intlLocale = toIntlLocale(locale);
  const unitLabels = { hour: t("units.hour"), minute: t("units.minute") };
  const weekdays = [
    t("weekdaysShort.sun"),
    t("weekdaysShort.mon"),
    t("weekdaysShort.tue"),
    t("weekdaysShort.wed"),
    t("weekdaysShort.thu"),
    t("weekdaysShort.fri"),
    t("weekdaysShort.sat"),
  ];
  const [view, setView] = useState<View>("week");
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedBlock, setSelectedBlock] = useState<TimeBlock | null>(null);
  const [showClientPicker, setShowClientPicker] = useState<TimeBlock | null>(
    null,
  );
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [eventMatches, setEventMatches] = useState<
    Record<string, ClientMatch | null>
  >({});
  const [createPopup, setCreatePopup] = useState<{
    dateStr: string;
    date: Date;
    startMinutes: number;
    endMinutes: number;
  } | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState<{
    movedBlockRawId: string;
    targetBlockRawId: string;
    movedTitle: string;
    targetTitle: string;
    sharedTaskId: string | null;
  } | null>(null);
  const suppressToastRef = useRef(false);
  // Auto-scroll to current time on initial load
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

  // Optimistic overrides for entry positions (cleared on refetch)
  const [entryOverrides, setEntryOverrides] = useState<
    Record<string, { startTime: Date; endTime: Date }>
  >({});

  const utils = trpc.useUtils();
  const startTimer = useTimerStore((s) => s.startTimer);

  const optimisticallyUpdateEntry = useCallback(
    (blockId: string, startTime: Date, endTime: Date) => {
      setEntryOverrides((prev) => ({
        ...prev,
        [blockId]: { startTime, endTime },
      }));
    },
    [],
  );

  const updateEntry = trpc.time.update.useMutation({
    onSuccess: () => {
      if (!suppressToastRef.current) {
        toast.success(t("page.entryUpdated"));
      }
      // Clear optimistic overrides and refetch from server
      setEntryOverrides({});
      utils.time.list.invalidate();
    },
    onError: (error) => {
      suppressToastRef.current = false;
      // Revert optimistic update on failure
      setEntryOverrides({});
      toast.error(error.message || t("page.entryUpdateFailed"));
    },
  });

  // Inline edit/delete of existing time-entry blocks on the calendar.
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<TimeBlock | null>(null);

  const deleteEntry = trpc.time.delete.useMutation({
    onSuccess: () => {
      toast.success(t("page.entryDeleted"));
      setDeletingEntry(null);
      utils.time.list.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || t("page.entryDeleteFailed"));
    },
  });

  const handleEditEntry = useCallback((block: TimeBlock) => {
    if (block.type !== "entry") return;
    setEditingEntryId(block.rawId);
    setSelectedBlock(null);
  }, []);

  const handleDeleteEntry = useCallback((block: TimeBlock) => {
    if (block.type !== "entry") return;
    setDeletingEntry(block);
    setSelectedBlock(null);
  }, []);

  const drag = useCalendarDrag({
    onCreateEnd: (dateStr, date, startMinutes, endMinutes) => {
      setCreatePopup({ dateStr, date, startMinutes, endMinutes });
    },
    onMoveEnd: async (blockId, dateStr, date, startMinutes, endMinutes) => {
      const startTime = minutesToDate(date, startMinutes);
      const endTime = minutesToDate(date, endMinutes);
      const hours = (endMinutes - startMinutes) / 60;
      const entry = timeEntryData?.entries?.find(
        (e: { id: string }) => e.id === blockId,
      );
      if (!entry) return;
      // Fakturerede poster er låst (#702)
      if (entry.isBilled) {
        toast.error(t("page.billedLocked"));
        return;
      }
      // Optimistic update: patch local blocks immediately
      optimisticallyUpdateEntry(blockId, startTime, endTime);
      suppressToastRef.current = true;
      try {
        await updateEntry.mutateAsync({
          id: blockId,
          data: {
            description: entry.description || t("page.defaultDescription"),
            hours: Math.round(hours * 100) / 100,
            date: toLocalDateStr(date),
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            projectId: entry.projectId || undefined,
            clientId: entry.clientId || undefined,
            isBillable: entry.isBillable ?? true,
          },
        });
      } catch {
        // onError har vist fejlen og rullet den optimistiske flytning tilbage
        return;
      } finally {
        suppressToastRef.current = false;
      }

      // Merge-on-drop: check if moved block overlaps with another entry
      const blocksInDate = blocksByDate[dateStr] ?? [];
      const movedBlock = blocks.find(
        (b) => b.rawId === blockId && b.type === "entry",
      );
      if (movedBlock) {
        const overlapping = blocksInDate.find(
          (b) =>
            b.rawId !== blockId &&
            b.type === "entry" &&
            startMinutes < blockToMinutes(b.startTime, b.endTime).endMin &&
            endMinutes > blockToMinutes(b.startTime, b.endTime).startMin,
        );
        if (overlapping) {
          setMergeConfirm({
            movedBlockRawId: movedBlock.rawId,
            targetBlockRawId: overlapping.rawId,
            movedTitle: movedBlock.title,
            targetTitle: overlapping.title,
            sharedTaskId: overlapping.taskId || movedBlock.taskId || null,
          });
        }
      }
    },
    onResizeEnd: (blockId, startMinutes, endMinutes) => {
      const entry = timeEntryData?.entries?.find(
        (e: { id: string }) => e.id === blockId,
      );
      if (!entry) return;
      // Fakturerede poster er låst (#702)
      if (entry.isBilled) {
        toast.error(t("page.billedLocked"));
        return;
      }
      const entryDate = new Date(entry.date || entry.startTime);
      const startTime = minutesToDate(entryDate, startMinutes);
      const endTime = minutesToDate(entryDate, endMinutes);
      const hours = (endMinutes - startMinutes) / 60;
      // Optimistic update: patch local blocks immediately
      optimisticallyUpdateEntry(blockId, startTime, endTime);
      updateEntry.mutate({
        id: blockId,
        data: {
          description: entry.description || t("page.defaultDescription"),
          hours: Math.round(hours * 100) / 100,
          date: toLocalDateStr(entryDate),
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          projectId: entry.projectId || undefined,
          clientId: entry.clientId || undefined,
          isBillable: entry.isBillable ?? true,
        },
      });
    },
  });

  const { data: userProfile } = trpc.user.getProfile.useQuery();

  const { data: connectionStatus } = trpc.calendar.getConnectionStatus.useQuery(
    undefined,
    { retry: false },
  );
  const { data: configured } = trpc.calendar.isConfigured.useQuery();
  const { data: calendarProviders } = trpc.calendar.providers.useQuery();

  const isCalendarConnected = !!connectionStatus?.connected;

  const dateRange = useMemo(() => {
    if (view === "day") {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const monday = getMonday(selectedDate);
    const sunday = addDays(monday, 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }, [selectedDate, view]);

  const { data: calendarEvents, isLoading: loadingEvents } =
    trpc.calendar.getEvents.useQuery(
      {
        startDate: dateRange.start.toISOString(),
        endDate: dateRange.end.toISOString(),
      },
      { enabled: !!connectionStatus?.connected },
    );

  const { data: timeEntryData, isLoading: loadingEntries } =
    trpc.time.list.useQuery({
      startDate: toLocalDateStr(dateRange.start),
      endDate: toLocalDateStr(dateRange.end),
      // Kalenderen er personlig (tids-blokke + Google-sync) → kun egne poster,
      // ellers ser owner/admin hele teamets blokke. Jf. Tidsregistrering-default.
      onlyOwn: true,
      limit: 100,
    });

  const handleContinueAsSegment = useCallback(
    (block: TimeBlock) => {
      const entry = timeEntryData?.entries?.find((e) => e.id === block.rawId);
      const { resumeAsSegment } = useTimerStore.getState();
      resumeAsSegment({
        entryId: block.rawId,
        projectId: entry?.project?.id ?? undefined,
        clientId: entry?.client?.id ?? entry?.clientId ?? undefined,
        description: block.title.replace(/ →$/, "").replace(/^← /, "").trim(),
        taskId: block.taskId ?? undefined,
      });
      toast.success(t("page.resumed"));
      setSelectedBlock(null);
    },
    [timeEntryData, t],
  );

  const handleNewEntryForTask = useCallback(
    (block: TimeBlock) => {
      const entry = timeEntryData?.entries?.find((e) => e.id === block.rawId);
      const { startTimer: start } = useTimerStore.getState();
      start({
        description: block.title.replace(/ →$/, "").replace(/^← /, "").trim(),
        taskId: block.taskId ?? undefined,
        projectId: entry?.project?.id ?? null,
        clientId: entry?.client?.id ?? entry?.clientId ?? null,
      });
      toast.success(t("page.newEntryStarted"));
      setSelectedBlock(null);
    },
    [timeEntryData, t],
  );

  const isLoading = (isCalendarConnected && loadingEvents) || loadingEntries;

  const syncMutation = trpc.calendar.sync.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(
          t("page.syncResult", {
            synced: data.synced ?? 0,
            updated: data.updated ?? 0,
          }),
        );
        utils.calendar.getEvents.invalidate();
      } else {
        toast.error(data.error || t("page.syncFailed"));
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Client matching for "start timer" / quick register
  const { data: matchResult } = trpc.calendar.matchClient.useQuery(
    {
      eventTitle: selectedBlock?.title || "",
      eventDescription: selectedBlock?.description || undefined,
    },
    { enabled: !!selectedBlock && selectedBlock.type === "event" },
  );

  const createEntry = trpc.calendar.createTimeEntryFromEvent.useMutation({
    onSuccess: (data) => {
      toast.success(t("page.registeredHours", { hours: data.hours }));
      utils.calendar.getEvents.invalidate();
      utils.time.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const splitMidnight = useCallback(
    (
      entry: NonNullable<typeof timeEntryData>["entries"][number],
      entryStart: Date | string,
      entryEnd: Date | string,
      overrides: typeof entryOverrides,
    ): TimeBlock[] => {
      const override = overrides[entry.id];
      const startTime = override?.startTime ?? new Date(entryStart);
      const endTime = override?.endTime ?? new Date(entryEnd);
      const title = entry.description || t("page.defaultDescription");
      const clientColor =
        entry.client?.color ??
        entry.project?.client?.color ??
        (entry.clientId ? `${clientHue(entry.clientId)}` : undefined);
      const baseBlock = {
        rawId: entry.id,
        type: "entry" as const,
        projectName: entry.project?.name,
        clientName: entry.client?.name,
        clientColor,
        taskId: entry.taskId ?? null,
      };

      const startDate = toLocalDateStr(startTime);
      const endDate = toLocalDateStr(endTime);

      if (startDate === endDate) {
        return [
          { ...baseBlock, id: `te-${entry.id}`, title, startTime, endTime },
        ];
      }

      // Spans multiple days — calculate number of calendar days
      const startMidnight = new Date(startTime);
      startMidnight.setHours(0, 0, 0, 0);
      const endMidnight = new Date(endTime);
      endMidnight.setHours(0, 0, 0, 0);
      const numDays =
        Math.round(
          (endMidnight.getTime() - startMidnight.getTime()) /
            (1000 * 60 * 60 * 24),
        ) + 1;

      const blocks: TimeBlock[] = [];
      for (let i = 0; i < numDays; i++) {
        const isFirst = i === 0;
        const isLast = i === numDays - 1;

        const dayStart = new Date(startMidnight);
        dayStart.setDate(startMidnight.getDate() + i);

        const blockStart = isFirst ? startTime : new Date(dayStart);
        if (!isFirst) blockStart.setHours(0, 0, 0, 0);

        const blockEnd = isLast ? endTime : new Date(dayStart);
        if (!isLast) {
          blockEnd.setHours(23, 59, 59, 999);
        }

        blocks.push({
          ...baseBlock,
          id: `te-${entry.id}-day${i + 1}`,
          title: isFirst
            ? `${title} →`
            : isLast
              ? `← ${title}`
              : `← ${title} →`,
          startTime: blockStart,
          endTime: blockEnd,
          ...(isFirst ? { continues: true } : {}),
          ...(!isFirst ? { isContinuation: true } : {}),
          ...(!isLast ? { continues: true } : {}),
        });
      }

      return blocks;
    },
    [t],
  );

  const blocks = useMemo(() => {
    const result: TimeBlock[] = [];

    if (calendarEvents) {
      for (const ev of calendarEvents) {
        result.push({
          id: `cal-${ev.id}`,
          rawId: ev.id,
          title: ev.title,
          startTime: new Date(ev.startTime),
          endTime: new Date(ev.endTime),
          type: "event",
          linkedProjectId: ev.linkedProjectId,
          linkedTimeEntryId: ev.linkedTimeEntryId,
          isAllDay: ev.isAllDay,
          responseStatus: ev.responseStatus,
          description: ev.description,
          projectName: ev.linkedProject
            ? Array.isArray(ev.linkedProject)
              ? ev.linkedProject[0]?.name
              : ev.linkedProject.name
            : undefined,
        });
      }
    }

    if (timeEntryData?.entries) {
      for (const entry of timeEntryData.entries) {
        if (!entry.startTime || !entry.endTime) continue;
        result.push(
          ...splitMidnight(
            entry,
            entry.startTime,
            entry.endTime,
            entryOverrides,
          ),
        );
      }
    }

    return result;
  }, [calendarEvents, timeEntryData, entryOverrides, splitMidnight]);

  // Pre-fetch match results for all unregistered events
  const unregisteredEvents = useMemo(
    () =>
      blocks.filter(
        (b) => b.type === "event" && !b.linkedTimeEntryId && !b.isAllDay,
      ),
    [blocks],
  );

  // Ref to avoid stale closure in async fetch
  const eventMatchesRef = useRef(eventMatches);
  eventMatchesRef.current = eventMatches;

  // Auto-scroll grid to current time on initial load. Scrolles gridScrollRef
  // selv (ikke window): ellers deler ugedags-headeren (sticky top-0) vinduets
  // scroll-kontekst med DashboardShells sticky topbar, og de to låser sig til
  // samme position på skærmen uanset hvor sidens indhold lander.
  useEffect(() => {
    if (isLoading || initialScrollDone.current) return;
    initialScrollDone.current = true;
    const el = gridScrollRef.current;
    if (!el) return;
    const now = new Date();
    const currentHour = now.getHours();
    if (currentHour < START_HOUR || currentHour >= START_HOUR + TOTAL_HOURS)
      return;
    const offsetWithinGrid = Math.max(
      0,
      (currentHour - START_HOUR - 1) * HOUR_HEIGHT,
    );
    el.scrollTo({ top: offsetWithinGrid, behavior: "smooth" });
  }, [isLoading]);

  // Batch fetch client matches for unregistered events
  // biome-ignore lint/correctness/useExhaustiveDependencies: effekten styres af id-listen som streng; unregisteredEvents og utils får ny identitet hver render og ville hente match igen
  useEffect(() => {
    if (unregisteredEvents.length === 0) return;

    const fetchMatches = async () => {
      const newMatches: Record<string, ClientMatch | null> = {};
      for (const ev of unregisteredEvents) {
        // Skip if we already have a match for this event
        if (eventMatchesRef.current[ev.rawId] !== undefined) continue;
        try {
          const result = await utils.calendar.matchClient.fetch({
            eventTitle: ev.title,
            eventDescription: ev.description || undefined,
          });
          newMatches[ev.rawId] = result && result.length > 0 ? result[0] : null;
        } catch {
          newMatches[ev.rawId] = null;
        }
      }
      if (Object.keys(newMatches).length > 0) {
        setEventMatches((prev) => ({ ...prev, ...newMatches }));
      }
    };

    fetchMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unregisteredEvents.map((e) => e.rawId).join(",")]);

  // Capture rate calculation
  const captureRate = useMemo(() => {
    const now = new Date();
    const pastEvents = blocks.filter(
      (b) => b.type === "event" && b.endTime < now && !b.isAllDay,
    );
    if (pastEvents.length === 0) return null;
    const registered = pastEvents.filter((b) => !!b.linkedTimeEntryId).length;
    return Math.round((registered / pastEvents.length) * 100);
  }, [blocks]);

  // Unregistered past events for bulk registration
  const unregisteredPastEvents = useMemo(() => {
    const now = new Date();
    return blocks.filter(
      (b) =>
        b.type === "event" &&
        b.endTime < now &&
        !b.isAllDay &&
        !b.linkedTimeEntryId,
    );
  }, [blocks]);

  const hoursByDate = useMemo(() => {
    const map: Record<string, number> = {};
    if (!timeEntryData?.entries) return map;
    for (const entry of timeEntryData.entries) {
      const key = toLocalDateStr(new Date(entry.date));
      map[key] =
        (map[key] || 0) + Number.parseFloat(entry.roundedHours ?? entry.hours);
    }
    return map;
  }, [timeEntryData]);

  const blocksByDate = useMemo(() => {
    const map: Record<string, TimeBlock[]> = {};
    for (const block of blocks) {
      const key = toLocalDateStr(block.startTime);
      if (!map[key]) map[key] = [];
      map[key].push(block);
    }
    return map;
  }, [blocks]);

  const days = useMemo(() => {
    if (view === "day") return [selectedDate];
    const monday = getMonday(selectedDate);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [selectedDate, view]);

  const todayStr = toLocalDateStr(new Date());

  const navigate = (direction: number) => {
    setSelectedDate((prev) =>
      addDays(prev, view === "day" ? direction : direction * 7),
    );
  };

  const handleGridDoubleClick = useCallback(
    (dateStr: string, date: Date, startMinutes: number) => {
      setCreatePopup({
        dateStr,
        date,
        startMinutes,
        endMinutes: Math.min(startMinutes + 30, 22 * 60),
      });
    },
    [],
  );

  const handleBlockClick = useCallback((block: TimeBlock) => {
    setSelectedBlock((prev) => (prev?.id === block.id ? null : block));
  }, []);

  const handleStartTimer = useCallback(
    (block: TimeBlock) => {
      // Use pre-fetched eventMatches (always available) over async matchResult
      const match = eventMatches[block.rawId] || matchResult?.[0];
      startTimer({
        clientId: match?.clientId || null,
        projectId: match?.projectId || null,
        description: block.title,
      });
      toast.success(t("page.timerStarted", { title: block.title }));
      setSelectedBlock(null);
    },
    [eventMatches, matchResult, startTimer, t],
  );

  const handleCreateEntry = useCallback((block: TimeBlock) => {
    const { startMin, endMin } = blockToMinutes(block.startTime, block.endTime);
    setCreatePopup({
      dateStr: toLocalDateStr(block.startTime),
      date: new Date(block.startTime),
      startMinutes: startMin,
      endMinutes: endMin,
    });
    setSelectedBlock(null);
  }, []);

  const handleQuickRegister = useCallback(
    (block: TimeBlock, match: ClientMatch) => {
      if (match.projectId) {
        createEntry.mutate({
          eventId: block.rawId,
          projectId: match.projectId,
          clientId: match.clientId,
        });
      } else {
        // No project resolved - open client picker
        setShowClientPicker(block);
      }
    },
    [createEntry],
  );

  const allDayEvents = blocks.filter((b) => b.isAllDay);

  return (
    <div className="space-y-4">
      {/* Auto-track suggestions */}
      {isCalendarConnected && <AutoTrackBanner />}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t("page.title")}
          </h1>
          {isCalendarConnected ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("page.connectedAs", {
                email: connectionStatus.accountEmail ?? "",
              })}
              {connectionStatus.lastSynced && (
                <>
                  {" · "}
                  {t("page.lastSynced", {
                    time: new Date(connectionStatus.lastSynced).toLocaleString(
                      intlLocale,
                      { hour: "2-digit", minute: "2-digit" },
                    ),
                  })}
                </>
              )}
              {captureRate != null && (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                    captureRate >= 90
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : captureRate >= 70
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  }`}
                >
                  {t("page.captureRate", { rate: captureRate })}
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("page.dragHint")}
              {" · "}
              <Link
                href="/dashboard/settings/integrations"
                className="text-brand-500 hover:text-brand-600 dark:text-brand-400"
              >
                {calendarProviders?.outlook
                  ? t("page.connectCalendar")
                  : configured?.configured
                    ? t("page.connectBoth")
                    : t("page.connectICloud")}
              </Link>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isCalendarConnected && (
            <>
              <Link
                href="/dashboard/settings/integrations"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {t("page.settings")}
              </Link>
              {unregisteredPastEvents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowBulkModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-900/50"
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  {t("page.registerAll", {
                    count: unregisteredPastEvents.length,
                  })}
                </button>
              )}
              <button
                type="button"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {syncMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {t("page.sync")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Navigation bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-lg border border-gray-200 p-1.5 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              d.setHours(0, 0, 0, 0);
              setSelectedDate(d);
            }}
            className="rounded-lg border border-gray-200 px-3 py-1 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t("page.today")}
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            className="rounded-lg border border-gray-200 p-1.5 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-2 text-sm font-semibold text-gray-900 dark:text-white">
            {view === "day"
              ? selectedDate.toLocaleDateString(intlLocale, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : t("page.weekRange", {
                  week: getWeekNumber(selectedDate),
                  start: days[0].toLocaleDateString(intlLocale, {
                    day: "numeric",
                    month: "short",
                  }),
                  end: days[6].toLocaleDateString(intlLocale, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }),
                })}
          </span>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => setView("day")}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              view === "day"
                ? "bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-white"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            {t("page.viewDay")}
          </button>
          <button
            type="button"
            onClick={() => setView("week")}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              view === "week"
                ? "bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-white"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            {t("page.viewWeek")}
          </button>
        </div>
      </div>

      {/* Week summary */}
      {view === "week" && timeEntryData?.entries && (
        <WeekSummary
          entries={timeEntryData.entries}
          userDefaultRate={userProfile?.defaultHourlyRate ?? null}
        />
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        {isCalendarConnected && (
          <>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm border border-brand-200 bg-brand-50 dark:border-brand-600 dark:bg-tt-gran-lys" />
              {t("page.legendEvent")}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950" />
              {t("page.legendRegistered")}
            </div>
          </>
        )}
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800" />
          {t("page.legendEntry")}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-brand-500 dark:text-brand-400" />
        </div>
      ) : (
        <>
          {allDayEvents.length > 0 && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              {allDayEvents.map((ev) => (
                <span
                  key={ev.id}
                  className="inline-flex items-center whitespace-nowrap rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs text-brand-800 dark:border-brand-600 dark:bg-tt-gran-lys dark:text-brand-200"
                >
                  {ev.title}
                </span>
              ))}
            </div>
          )}

          <div
            ref={gridScrollRef}
            // min-h/max-h gør kortet til sin egen lodrette scroll-container:
            // ugedags-headerens sticky top-0 holder sig dermed til kortet i
            // stedet for at dele vinduets scroll-kontekst med DashboardShells
            // sticky topbar (se auto-scroll-effekten ovenfor).
            className="min-h-[300px] max-h-[calc(100vh-280px)] overflow-x-auto overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="flex min-w-[600px]">
              <div
                className="w-14 shrink-0 border-r border-gray-100 dark:border-gray-800"
                style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}
              >
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
                    key={`hl-${i}`}
                    className="relative text-right"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    <span className="absolute -top-2 right-2 text-xs text-gray-400 dark:text-gray-500">
                      {String(START_HOUR + i).padStart(2, "0")}:00
                    </span>
                  </div>
                ))}
              </div>

              {days.map((day) => {
                const key = toLocalDateStr(day);
                const isToday = key === todayStr;
                return (
                  <div
                    key={key}
                    className={`flex-1 min-w-0 ${view === "week" ? "border-r border-gray-100 last:border-r-0 dark:border-gray-800" : ""}`}
                  >
                    {view === "week" && (
                      <div
                        data-testid="calendar-week-day-header"
                        // Sticky til kortets egen scroll-container (se
                        // gridScrollRef ovenfor), ikke til vinduet — derfor
                        // top-0 uden konflikt med DashboardShells topbar.
                        className={`sticky top-0 z-20 border-b px-2 py-1.5 text-center text-xs font-medium ${
                          isToday
                            ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-tt-gran-lys dark:text-brand-300"
                            : "border-gray-100 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-850 dark:text-gray-400"
                        }`}
                      >
                        {dayLabel(day, weekdays)}
                        {(hoursByDate[key] ?? 0) > 0 && (
                          <span className="ml-1 opacity-60">
                            · {hoursByDate[key].toFixed(1).replace(".0", "")}
                            {unitLabels.hour}
                          </span>
                        )}
                      </div>
                    )}
                    <CalendarGridColumn
                      blocks={blocksByDate[key] ?? EMPTY_BLOCKS}
                      date={day}
                      dateStr={key}
                      isToday={isToday}
                      dragState={drag.dragState}
                      selectedBlock={selectedBlock}
                      selectedBlockId={selectedBlock?.id || null}
                      eventMatches={eventMatches}
                      onBlockClick={handleBlockClick}
                      onStartTimer={handleStartTimer}
                      onCreateEntry={handleCreateEntry}
                      onEditEntry={handleEditEntry}
                      onDeleteEntry={handleDeleteEntry}
                      onContinueAsSegment={handleContinueAsSegment}
                      onNewEntryForTask={handleNewEntryForTask}
                      onQuickRegister={handleQuickRegister}
                      registerGridRef={drag.registerGridRef}
                      onGridMouseDown={drag.handleGridMouseDown}
                      onBlockMouseDown={drag.handleBlockMouseDown}
                      onResizeMouseDown={drag.handleResizeMouseDown}
                      onGridTouchStart={drag.handleGridTouchStart}
                      onTouchEnd={drag.handleTouchEnd}
                      onGridDoubleClick={handleGridDoubleClick}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Client picker modal */}
      {showClientPicker && (
        <ClientPickerModal
          block={showClientPicker}
          onClose={() => setShowClientPicker(null)}
        />
      )}

      {/* Bulk registration modal */}
      {showBulkModal && (
        <BulkRegistrationModal
          unregisteredPastEvents={unregisteredPastEvents}
          eventMatches={eventMatches}
          onClose={() => setShowBulkModal(false)}
        />
      )}

      {/* Create entry popup from drag */}
      {createPopup && (
        // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
        <div
          className="fixed inset-0 z-40"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreatePopup(null);
          }}
        >
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <CreateEntryPopup
              date={createPopup.date}
              startMinutes={createPopup.startMinutes}
              endMinutes={createPopup.endMinutes}
              onClose={() => setCreatePopup(null)}
            />
          </div>
        </div>
      )}

      {/* Edit existing time entry */}
      {editingEntryId && (
        <TimeEntryEditModal
          entryId={editingEntryId}
          isOpen={true}
          onClose={() => setEditingEntryId(null)}
          onSuccess={() => {
            setEditingEntryId(null);
            utils.time.list.invalidate();
          }}
        />
      )}

      {/* Confirm delete */}
      {deletingEntry && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setDeletingEntry(null)}
          onConfirm={() => deleteEntry.mutate({ id: deletingEntry.rawId })}
          title={t("page.deleteTitle")}
          description={t("page.deleteDescription", {
            title: deletingEntry.title,
            start: formatTime(deletingEntry.startTime),
            end: formatTime(deletingEntry.endTime),
          })}
          confirmLabel={tc("delete")}
          cancelLabel={t("page.cancel")}
          variant="danger"
          isLoading={deleteEntry.isPending}
        />
      )}

      {/* Confirm merge on drop */}
      <ConfirmDialog
        isOpen={!!mergeConfirm}
        onClose={() => setMergeConfirm(null)}
        onConfirm={async () => {
          if (!mergeConfirm) return;
          const { movedBlockRawId, targetBlockRawId, sharedTaskId } =
            mergeConfirm;
          if (sharedTaskId) {
            const entries = timeEntryData?.entries ?? [];
            const movedBlock = blocks.find(
              (b) => b.rawId === movedBlockRawId && b.type === "entry",
            );
            const overlapping = blocks.find(
              (b) => b.rawId === targetBlockRawId && b.type === "entry",
            );
            suppressToastRef.current = true;
            try {
              if (movedBlock && !movedBlock.taskId) {
                const e = entries.find((x) => x.id === movedBlockRawId);
                if (e) {
                  await updateEntry.mutateAsync({
                    id: movedBlockRawId,
                    data: {
                      description:
                        e.description || t("page.defaultDescription"),
                      hours: Number(e.hours),
                      date: toLocalDateStr(new Date(e.date)),
                      startTime: e.startTime
                        ? new Date(e.startTime).toISOString()
                        : undefined,
                      endTime: e.endTime
                        ? new Date(e.endTime).toISOString()
                        : undefined,
                      projectId: e.projectId || undefined,
                      clientId: e.clientId || undefined,
                      isBillable: e.isBillable ?? true,
                      taskId: sharedTaskId,
                    },
                  });
                }
              }
              if (overlapping && !overlapping.taskId) {
                const e = entries.find((x) => x.id === targetBlockRawId);
                if (e) {
                  await updateEntry.mutateAsync({
                    id: targetBlockRawId,
                    data: {
                      description:
                        e.description || t("page.defaultDescription"),
                      hours: Number(e.hours),
                      date: toLocalDateStr(new Date(e.date)),
                      startTime: e.startTime
                        ? new Date(e.startTime).toISOString()
                        : undefined,
                      endTime: e.endTime
                        ? new Date(e.endTime).toISOString()
                        : undefined,
                      projectId: e.projectId || undefined,
                      clientId: e.clientId || undefined,
                      isBillable: e.isBillable ?? true,
                      taskId: sharedTaskId,
                    },
                  });
                }
              }
              toast.success(t("page.linked"));
            } finally {
              suppressToastRef.current = false;
            }
          } else {
            toast.info(t("page.createTaskFirst"));
          }
          setMergeConfirm(null);
        }}
        title={t("page.mergeTitle")}
        description={t("page.mergeDescription", {
          moved: mergeConfirm?.movedTitle ?? "",
          target: mergeConfirm?.targetTitle ?? "",
        })}
        confirmLabel={t("page.mergeConfirm")}
        cancelLabel={t("page.cancel")}
      />
    </div>
  );
}
