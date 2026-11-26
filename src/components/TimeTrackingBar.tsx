"use client";

import {
  ChevronDown,
  Clock,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Save,
  X,
  Zap,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { ConfirmDialog } from "@/components/ui";
import { useModules } from "@/hooks/useModules";
import { useTimerShortcuts } from "@/hooks/useTimerShortcuts";
import { useTimerSync } from "@/hooks/useTimerSync";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import { showPrepaidDeductionToast } from "@/lib/prepaidToast";
import { buildContinuedEntryPatch } from "@/lib/timer/continue-entry";
import { stoppedTimerStart } from "@/lib/timer/entry-span";
import {
  createLongTimerReminder,
  longTimerKey,
} from "@/lib/timer/long-timer-reminder";
import { timerSaveKeys } from "@/lib/timer/save-key";
import { trpc } from "@/providers/trpc-provider";
import {
  enqueueOfflineStop,
  shouldQueueTimerWrites,
} from "@/stores/offlineQueueStore";
import { isGenuinePause, useTimerStore } from "@/stores/timerStore";
import {
  AddTimeModal,
  ClientProjectSelectModal,
  CreateTemplateModal,
  DescriptionAutocomplete,
  MobileActionsSheet,
  QuickActionsDropdown,
  RecentTasksModal,
  SaveTimeEntryModal,
} from "./timer";
import type { RecentEntrySelection } from "./timer/DescriptionAutocomplete";

// Timer milestone thresholds (in seconds)
const MILESTONES = [
  { seconds: 15 * 60, labelKey: "bar.milestone.m15" },
  { seconds: 30 * 60, labelKey: "bar.milestone.m30" },
  { seconds: 60 * 60, labelKey: "bar.milestone.h1" },
  { seconds: 2 * 60 * 60, labelKey: "bar.milestone.h2" },
  { seconds: 4 * 60 * 60, labelKey: "bar.milestone.h4" },
  { seconds: 8 * 60 * 60, labelKey: "bar.milestone.h8" },
];

/**
 * Skal stoppet gå gennem offline-køen (#703)? Så fanges sessionens tider nu,
 * FØR pause (pause nulstiller startTime) — ellers null og normalt claim.
 */
function offlineStopMeta(): {
  sessionStartTime: number | null;
  startTime: number | null;
} | null {
  if (!shouldQueueTimerWrites()) return null;
  const { sessionStartTime, startTime } = useTimerStore.getState();
  return { sessionStartTime, startTime };
}

export function TimeTrackingBar() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("timer");
  const tc = useTranslations("common");
  const locale = useLocale();
  /** "15 minutter", "1 time", "1 time 30 minutter" — til toast og titler. */
  const formatAddedMinutes = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(t("bar.addedHours", { count: hours }));
    if (rest > 0 || hours === 0) {
      parts.push(t("bar.addedMinutes", { count: rest }));
    }
    return parts.join(" ");
  };
  const {
    isRunning,
    elapsedTime,
    sessionStartTime,
    startTime: segmentStartTime,
    sessionId: timerSessionId,
    projectId,
    clientId,
    taskId,
    description,
    continuingEntryId,
    continuingEntryHours,
    resumeEntryId,
    startTimer,
    pauseTimer,
    resumeTimer,
    resetTimer,
    updateDescription,
    updateProject,
    addMinutes,
    tick,
    continueEntry,
  } = useTimerStore();

  const [showProjectSelect, setShowProjectSelect] = useState(false);
  const [showAddTimeModal, setShowAddTimeModal] = useState(false);
  const [showRecentTasks, setShowRecentTasks] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<{
    duration: number;
    startTime: Date;
    endTime: Date;
  } | null>(null);

  // Track milestones that have been shown
  const shownMilestonesRef = useRef<Set<number>>(new Set());
  const [recentMilestone, setRecentMilestone] = useState<string | null>(null);

  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const showClientProjectPicker =
    isModuleEnabled("clients") || isModuleEnabled("projects");

  // Server sync hook - syncs timer state every 30 seconds when running
  const timerSync = useTimerSync();

  // Tid tilføjet med quick-add er kun nået i lokal state indtil en sync er
  // bekræftet. Forlader brugeren siden imens, skubbes den sidste tilstand med
  // keepalive, så den overlever unmount/navigation.
  const quickAddUsed = useRef(false);
  const timerSyncRef = useRef(timerSync);
  timerSyncRef.current = timerSync;
  useEffect(
    () => () => {
      if (quickAddUsed.current) timerSyncRef.current.syncOnUnload();
    },
    [],
  );

  // Keyboard shortcuts - T to toggle timer, Shift+S to save
  useTimerShortcuts();

  // Fetch clients, projects, recent tasks, and today's total hours
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });
  const { data: allProjects } = trpc.projects.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("projects"),
  });
  const { data: recentTasks } = trpc.time.getRecent.useQuery({ limit: 10 });
  const { data: todayTotalHours } = trpc.time.todayTotal.useQuery(undefined, {
    refetchInterval: 60_000, // refresh every minute
  });

  const utils = trpc.useUtils();

  // Save time entry mutation
  const saveTimeEntryMutation = trpc.time.create.useMutation({
    onError: (error) => {
      toast.error(error.message || t("bar.saveFailed"));
    },
  });

  // Update existing time entry mutation
  const updateTimeEntryMutation = trpc.time.update.useMutation({
    onError: (error) => {
      toast.error(error.message || t("bar.updateFailed"));
    },
  });

  // Create segment on an existing time entry mutation
  const createSegmentMutation = trpc.time.createSegment.useMutation({
    onSuccess: () => {
      utils.time.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("bar.segmentFailed"));
    },
  });

  // Mark task as done mutation
  const markTaskDoneMutation = trpc.tasks.markDone.useMutation({
    onError: (error) => {
      toast.error(error.message || t("bar.taskDoneFailed"));
    },
  });

  // Timer notification mutations (for Discord/Slack)
  const sendTimerStartNotification =
    trpc.notifications.sendTimerStartNotification.useMutation();
  const sendTimerStopNotification =
    trpc.notifications.sendTimerStopNotification.useMutation();

  // Tick timer every second
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      tick();
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, tick]);

  // Check for milestones and show notifications
  useEffect(() => {
    if (!isRunning) return;

    for (const milestone of MILESTONES) {
      // Check if we just passed this milestone
      if (
        elapsedTime >= milestone.seconds &&
        elapsedTime < milestone.seconds + 2 && // Within 2 seconds of milestone
        !shownMilestonesRef.current.has(milestone.seconds)
      ) {
        shownMilestonesRef.current.add(milestone.seconds);
        const milestoneLabel = t(milestone.labelKey);
        setRecentMilestone(milestoneLabel);
        toast.success(t("bar.milestoneReached", { label: milestoneLabel }), {
          description: t("bar.milestoneHint"),
          duration: 3000,
        });

        // Clear milestone badge after 5 seconds
        setTimeout(() => setRecentMilestone(null), 5000);
        break;
      }
    }
  }, [elapsedTime, isRunning, t]);

  // Venlig påmindelse om en timer, der har kørt meget længe. Én gang pr.
  // timer (også efter genindlæsning), og den bliver stående, til brugeren
  // reagerer: en glemt timer opdages typisk, når man kommer tilbage til fanen.
  const stopFromReminderRef = useRef<() => void>(() => {});
  const longTimerReminderRef = useRef<ReturnType<
    typeof createLongTimerReminder
  > | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  if (!longTimerReminderRef.current) {
    const reminder = createLongTimerReminder({
      show: (key, hours) => {
        toast.warning(tRef.current("bar.longTimer.title", { hours }), {
          id: key,
          description: tRef.current("bar.longTimer.description"),
          duration: Number.POSITIVE_INFINITY,
          onDismiss: () => reminder.dismissed(key),
          action: {
            label: tRef.current("bar.longTimer.stop"),
            onClick: () => {
              if (reminder.canStop(key)) stopFromReminderRef.current();
            },
          },
        });
      },
      dismiss: (key) => toast.dismiss(key),
      storage: () => sessionStorage,
    });
    longTimerReminderRef.current = reminder;
  }
  const longTimerReminderKey = longTimerKey({
    sessionStartTime,
    sessionId: timerSessionId,
    startTime: segmentStartTime,
  });
  useEffect(() => {
    longTimerReminderRef.current?.update({
      isRunning,
      elapsedSeconds: elapsedTime,
      key: longTimerReminderKey,
    });
  }, [elapsedTime, isRunning, longTimerReminderKey]);
  // Toasteren lever videre, når bjælken forsvinder (andre sider, skjult
  // bjælke). Luk påmindelsen sammen med bjælken, så dens stop-knap aldrig
  // peger på en afmonteret komponent.
  const longTimerReminderKeyRef = useRef(longTimerReminderKey);
  longTimerReminderKeyRef.current = longTimerReminderKey;
  useEffect(
    () => () => {
      toast.dismiss(longTimerReminderKeyRef.current);
    },
    [],
  );

  // Reset milestones when timer is reset
  useEffect(() => {
    if (elapsedTime === 0) {
      shownMilestonesRef.current.clear();
      setRecentMilestone(null);
    }
  }, [elapsedTime]);

  // Format time display (HH:MM:SS)
  const formatTime = useCallback((seconds: number) => {
    // Safety: clamp to reasonable values (max 999 hours)
    const safeSeconds = Math.max(0, Math.min(seconds, 3596400));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Viste tid: ved "Fortsæt" står postens eksisterende timer separat fra
  // sessionen (sessionen synkes uden base) — vis den samlede tid.
  const displaySeconds =
    elapsedTime + Math.round((continuingEntryHours ?? 0) * 3600);

  // Update document title with timer when running
  useEffect(() => {
    if (isRunning) {
      document.title = `${formatTime(displaySeconds)} - ${brand.name}`;
    } else {
      document.title = t("bar.documentTitle", { brand: brand.name });
    }

    return () => {
      document.title = t("bar.documentTitle", { brand: brand.name });
    };
  }, [isRunning, displaySeconds, formatTime, t, brand.name]);

  // Lukkes fanen mens gem-dialogen står åben, ville stop-claimet blive
  // hængende i "stopping": extensionen viser timeren som stoppet med det
  // samme, og oprydnings-cron'en parker den som pauset fem minutter efter.
  // Annullér derfor claimet på vej ud — timeren kører videre (kunde A 28/8).
  // Når gemningen er i gang (claim → gem → confirm) må claimet IKKE
  // annulleres — posten kan allerede være oprettet, og en annullering ville
  // lade serverens timer køre videre med den gemte tid (dobbelt tid).
  const savePhaseRef = useRef(false);
  // Offline-stop (#703): intet claim er taget — stoppet lægges i køen ved
  // gem. Sessionens tider fanges FØR pause (pause nulstiller startTime).
  const offlineStopRef = useRef<{
    sessionStartTime: number | null;
    startTime: number | null;
  } | null>(null);
  useEffect(() => {
    if (!showSaveModal) return;
    const handlePageHide = () => {
      if (savePhaseRef.current || offlineStopRef.current) return;
      timerSync.cancelStopOnUnload();
    };
    // Kommer siden tilbage fra bfcache (tilbage-knappen) står dialogen der
    // stadig, men claimet er frigivet — et gem nu ville oprette posteringen
    // uden at kunne rydde serverens timer (dobbelt tid). Luk dialogen og lad
    // timeren køre videre; brugeren stopper den igen.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setShowSaveModal(false);
      setPendingSaveData(null);
      useTimerStore.getState().resumeTimer();
      timerSync.syncToServer();
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [showSaveModal, timerSync.cancelStopOnUnload, timerSync.syncToServer]);

  const handleStart = () => {
    // Resume ONLY a genuine paused session (sessionStartTime survives a user
    // pause). Leftover elapsed WITHOUT a session start is a remotely-stopped,
    // already-saved session parked by the sync — resuming it would ride the
    // old time into the next entry, so start fresh instead.
    if (elapsedTime > 0 && !isRunning && sessionStartTime) {
      resumeTimer();
      return;
    }
    startTimer({ clientId, projectId, description });

    // Send timer start notification (async, don't await)
    const projectName = allProjects?.find((p) => p.id === projectId)?.name;
    sendTimerStartNotification.mutate({
      projectName,
      description: description || undefined,
    });
  };

  const handleReset = async () => {
    setShowResetConfirm(true);
  };

  const handleResetConfirm = async () => {
    // Kun DENNE session ryddes på serveren — en timer startet et andet sted
    // imens røres ikke (timer-sessioner).
    const sessionToClear = useTimerStore.getState().sessionId;
    resetTimer();
    // Clear server state to ensure all devices see the reset
    await timerSync.clearServerState(sessionToClear);
    toast.info(t("bar.resetToast"));
    setShowResetConfirm(false);
  };

  // Pause from the web bar must propagate to the server, otherwise a paused
  // web timer keeps ticking in the extension (and its badge) and the two
  // diverge — you end up with two "running" timers that can't be stopped in
  // sync. Syncing isRunning:false lets the extension reflect the pause.
  const handlePause = () => {
    pauseTimer();
    void timerSync.syncToServer();
  };

  const handleStop = async () => {
    // Offline: intet claim nu — stoppet lægges i offline-køen ved gem og
    // claimes, når nettet er tilbage (#703).
    offlineStopRef.current = offlineStopMeta();
    if (!offlineStopRef.current) {
      // Claim timer atomically BEFORE pausing to prevent race conditions
      const claimed = await timerSync.claimTimerForStop();
      if (!claimed) {
        toast.error(t("bar.stoppedElsewhere"));
        // Refresh state from server
        timerSync.checkAndRecoverFromServer();
        return;
      }
      if (claimed === "unsynced") {
        // Starten nåede aldrig serveren (review P2-2): gem via offline-stoppet
        const st = useTimerStore.getState();
        offlineStopRef.current = {
          sessionStartTime: st.sessionStartTime,
          startTime: st.startTime,
        };
      }
    }

    // Get the actual session start time from timer store before pausing
    const timerState = useTimerStore.getState();
    const sessionStartTime = timerState.sessionStartTime;

    // Pause timer and capture state for save modal
    pauseTimer();
    const endTime = new Date();
    setPendingSaveData({
      duration: elapsedTime,
      // Sessionens første start, men aldrig senere end slut − sporet tid:
      // tid lagt til og en start sat til seneste genoptagelse må ikke give en
      // post med flere timer end tidsrummet (lib/timer/entry-span.ts)
      startTime: stoppedTimerStart(
        sessionStartTime ? new Date(sessionStartTime) : endTime,
        endTime,
        elapsedTime,
      ),
      endTime,
    });
    // Open save modal directly — project/client can be selected inside
    setShowSaveModal(true);
  };
  stopFromReminderRef.current = () => void handleStop();

  const handleSaveConfirm = async (options: {
    usePrepaid: boolean;
    prepaidPackageId?: string;
    prepaidHoursOverride?: number;
    isBillable: boolean;
    markTaskDone?: boolean;
  }) => {
    if (!pendingSaveData) return;
    if (offlineStopRef.current) {
      saveOffline(options);
      return;
    }
    savePhaseRef.current = true;

    const hours = Math.max(0.01, pendingSaveData.duration / 3600);
    // Capture IDs before resetTimer clears them
    const entryIdForSegment = resumeEntryId;
    let entryIdToUpdate = continuingEntryId;
    // Server-udstedt session: én session ⇒ én post — et gentaget "Gem"
    // (tabt svar) returnerer den eksisterende post.
    const timerSessionId = useTimerStore.getState().sessionId ?? undefined;
    let createdEntry:
      | Awaited<ReturnType<typeof saveTimeEntryMutation.mutateAsync>>
      | undefined;

    // Default the description to the project's name (or the client's, for
    // intern tid) when the user didn't type anything — far more useful than a
    // generic "Timer entry" placeholder. Requested by kunde A.
    const resolvedDescription =
      description ||
      allProjects?.find((p) => p.id === projectId)?.name ||
      clients?.find((c) => c.id === clientId)?.name ||
      t("bar.defaultDescription");

    try {
      // "Fortsæt" (kunde A 1/10): posten forlænges — timer = postens timer +
      // sessionen, sluttid = nu. Start og dato røres ikke. Kan posten ikke
      // forlænges (slettet/faktureret), gemmes sessionen som en ny post.
      let continuedOriginal: Awaited<
        ReturnType<typeof utils.time.getById.fetch>
      > | null = null;
      let continuedPatch: ReturnType<typeof buildContinuedEntryPatch> = null;
      if (!entryIdForSegment && entryIdToUpdate) {
        try {
          continuedOriginal = await utils.time.getById.fetch({
            id: entryIdToUpdate,
          });
          continuedPatch = buildContinuedEntryPatch({
            original: continuedOriginal,
            continuingEntryHours: continuingEntryHours ?? 0,
            sessionSeconds: pendingSaveData.duration,
            endTime: pendingSaveData.endTime,
          });
        } catch {
          continuedPatch = null;
        }
        if (!continuedPatch) {
          toast.info(t("bar.cannotExtend"));
          entryIdToUpdate = null;
        }
      }

      if (entryIdForSegment) {
        // Create a new segment on an existing entry
        await createSegmentMutation.mutateAsync({
          timeEntryId: entryIdForSegment,
          startTime: pendingSaveData.startTime.toISOString(),
          endTime: pendingSaveData.endTime.toISOString(),
          notes: description || undefined,
        });
        // The createSegment procedure already updates the parent entry's hours
      } else if (entryIdToUpdate && continuedOriginal && continuedPatch) {
        // Forlæng den eksisterende post. Kunden/opgaven bevares som de står
        // på posten (en post med projekt OG kunde må ikke miste kunden —
        // så ville time.update se et kundeskift og løsne klippekortet).
        // Klippekortet følger timetallet via time.update (kun deltaen).
        await updateTimeEntryMutation.mutateAsync({
          id: entryIdToUpdate,
          data: {
            projectId: projectId || undefined,
            clientId: projectId
              ? (continuedOriginal.clientId ?? undefined)
              : clientId || undefined,
            description: resolvedDescription,
            hours: continuedPatch.hours,
            date: continuedPatch.date,
            ...(continuedPatch.endTime
              ? { endTime: continuedPatch.endTime }
              : {}),
            taskId: taskId || continuedOriginal.taskId || undefined,
            isBillable: options.isBillable,
            fromTimer: true,
            timerSessionId,
          },
        });
      } else {
        // Create the time entry with time range tracking (atomic prepaid deduction)
        createdEntry = await saveTimeEntryMutation.mutateAsync({
          projectId: projectId || undefined,
          clientId: !projectId ? clientId || undefined : undefined,
          description: description || t("bar.timerEntry"),
          hours,
          date: toLocalDateStr(pendingSaveData.startTime),
          startTime: pendingSaveData.startTime.toISOString(),
          endTime: pendingSaveData.endTime.toISOString(),
          taskId: taskId || undefined,
          isBillable: options.isBillable,
          fromTimer: true,
          prepaidPackageId:
            options.usePrepaid && options.prepaidPackageId
              ? options.prepaidPackageId
              : undefined,
          prepaidHoursOverride:
            options.usePrepaid &&
            options.prepaidPackageId &&
            options.prepaidHoursOverride
              ? options.prepaidHoursOverride
              : undefined,
          // Samme nøgle ved gentaget "Gem" (tabt svar): serveren afviser
          // dubletten i stedet for at gemme og trække klippekortet to gange.
          clientEntryId: timerSaveKeys.keyFor(
            pendingSaveData.startTime.getTime(),
          ),
          timerSessionId,
        });
      }

      // Mark linked task as done if requested
      if (options.markTaskDone && taskId) {
        await markTaskDoneMutation.mutateAsync({ id: taskId });
      }
      // Opgavens registrerede tid er ændret (kort/liste, #212)
      if (taskId) {
        utils.tasks.list.invalidate();
        utils.tasks.listByStatus.invalidate();
        utils.tasks.listForTime.invalidate();
      }

      // Toast based on action
      if (entryIdForSegment) {
        toast.success(t("bar.newSessionAdded"));
      } else if (options.markTaskDone && taskId) {
        toast.success(t("bar.savedTaskDone"));
      } else if (showPrepaidDeductionToast(createdEntry?.prepaidDeduction)) {
        // Restsaldo vist i klippekort-toasten
      } else if (options.isBillable) {
        toast.success(t("bar.savedBillable"));
      } else {
        toast.success(t("bar.savedDraft"));
      }

      // Send timer stop notification (async, don't await)
      const projectName = allProjects?.find((p) => p.id === projectId)?.name;
      sendTimerStopNotification.mutate({
        projectName,
        description: description || undefined,
        duration: pendingSaveData.duration,
      });

      // Confirm stop on server - this clears the timer state permanently
      await timerSync.confirmStop();

      // Reset timer state - use resetTimer() as it always works
      // (stopTimer() has a guard that returns early if sessionStartTime is null)
      useTimerStore.getState().resetTimer();
      timerSaveKeys.reset();
      setPendingSaveData(null);
      setShowSaveModal(false);
    } catch (error) {
      console.error("Failed to save time entry:", error);
    } finally {
      savePhaseRef.current = false;
    }
  };

  /**
   * Gem et offline-stop: posten lægges i offline-køen med en idempotensnøgle
   * og gemmes, når nettet er tilbage — med samme claim → gem → confirm som
   * online. At føje tid til en eksisterende post kræver forbindelse.
   */
  const saveOffline = (options: {
    usePrepaid: boolean;
    prepaidPackageId?: string;
    prepaidHoursOverride?: number;
    isBillable: boolean;
    markTaskDone?: boolean;
  }) => {
    const meta = offlineStopRef.current;
    if (!pendingSaveData || !meta) return;
    if (resumeEntryId || continuingEntryId) {
      toast.error(t("bar.offlineExisting"));
      return;
    }
    const hours = Math.max(0.01, pendingSaveData.duration / 3600);
    enqueueOfflineStop({
      sessionStartTime: meta.sessionStartTime,
      startTime: meta.startTime,
      entry: {
        projectId: projectId || undefined,
        clientId: !projectId ? clientId || undefined : undefined,
        description: description || t("bar.timerEntry"),
        hours,
        date: toLocalDateStr(pendingSaveData.startTime),
        startTime: pendingSaveData.startTime.toISOString(),
        endTime: pendingSaveData.endTime.toISOString(),
        taskId: taskId || undefined,
        isBillable: options.isBillable,
        fromTimer: true,
        prepaidPackageId:
          options.usePrepaid && options.prepaidPackageId
            ? options.prepaidPackageId
            : undefined,
        prepaidHoursOverride:
          options.usePrepaid &&
          options.prepaidPackageId &&
          options.prepaidHoursOverride
            ? options.prepaidHoursOverride
            : undefined,
        timerSessionId: useTimerStore.getState().sessionId ?? undefined,
      },
    });
    offlineStopRef.current = null;
    useTimerStore.getState().resetTimer();
    setPendingSaveData(null);
    setShowSaveModal(false);
    toast.success(t("bar.savedOffline", { hours: hours.toFixed(2) }));
    if (options.markTaskDone && taskId) {
      toast.info(t("bar.taskDoneOnline"));
    }
  };

  const handleSaveModalClose = async () => {
    setShowSaveModal(false);
    setPendingSaveData(null);
    if (offlineStopRef.current) {
      // Intet claim at frigive — timeren kører bare videre lokalt.
      offlineStopRef.current = null;
      resumeTimer();
      timerSync.syncToServer();
      return;
    }
    // Cancel the stop intent so other clients can see timer is still running
    const outcome = await timerSync.cancelStop();
    if (outcome === "already_saved") {
      // Posten blev faktisk gemt (svaret gik tabt) — sessionen er slut og må
      // ikke køre videre (#783). Hooken har nulstillet timeren.
      toast.info(t("bar.alreadySaved"));
      return;
    }
    // Resume the timer since user cancelled
    resumeTimer();
    // Sync the resumed state to server
    timerSync.syncToServer();
  };

  /**
   * Pauset tid må ikke følge med over på en anden kunde (kunde A 7/9). Ved
   * ægte pause + kundeskift: bed brugeren gemme/nulstille først.
   */
  const blockClientSwitchWhilePaused = (newClientId: string | null) => {
    const s = useTimerStore.getState();
    if (isGenuinePause(s) && (newClientId ?? null) !== (s.clientId ?? null)) {
      toast.warning(t("bar.pausedBlock"));
      setShowProjectSelect(false);
      return true;
    }
    return false;
  };

  const handleProjectSelect = (
    newProjectId: string | null,
    newClientId: string | null,
  ) => {
    if (blockClientSwitchWhilePaused(newClientId)) return;
    updateProject(newProjectId || "", newClientId ?? "");
    setShowProjectSelect(false);
    if (!isRunning && elapsedTime === 0) {
      startTimer({
        clientId: newClientId,
        projectId: newProjectId,
        description,
      });
    }
  };

  const handleClientOnlySelect = (newClientId: string) => {
    if (blockClientSwitchWhilePaused(newClientId)) return;
    updateProject("", newClientId);
    setShowProjectSelect(false);
    if (!isRunning && elapsedTime === 0) {
      startTimer({ clientId: newClientId, description });
    }
  };

  // Tilføjet tid lever kun lokalt i baseTime indtil næste heartbeat — og
  // heartbeatet kører kun mens timeren kører. Pauset timer + "+15" + luk fane
  // ⇒ tiden var væk. Derfor skubbes den til serveren med det samme.
  //
  // Rammer kaldet syncToServers isSyncing-lås, køres det igen af hookens
  // pendingSync-mekanisme når den igangværende sync er færdig — så tre
  // hurtige klik ikke kun får det første med.
  const flushAddedTime = () => {
    // Flaget nulstilles bevidst ikke: vi kan ikke herfra se om hookens
    // udskudte gen-sync nåede frem, og en ekstra keepalive-skrivning ved
    // unmount er blot den aktuelle tilstand — samme nyttelast som et
    // heartbeat.
    quickAddUsed.current = true;
    void timerSync.syncToServer();
  };

  // Modalen lukkes ikke her — hurtigvalgene skal kunne klikkes flere gange og
  // lægges sammen. Den lukker på Tilføj/Annuller/X i AddTimeModal.
  const handleAddTime = (minutes: number) => {
    addMinutes(minutes);
    flushAddedTime();
    // Én toast med fast id, så tre klik opdaterer den samme boble i stedet
    // for at stable tre.
    toast.success(
      t("bar.addedToast", { amount: formatAddedMinutes(minutes) }),
      {
        id: "add-time",
      },
    );
  };

  const handleStartRecentTask = (task: {
    projectId: string | null;
    clientId: string | null;
    description: string;
  }) => {
    useTimerStore.getState().resumeFromEntry({
      projectId: task.projectId || undefined,
      clientId: task.clientId || undefined,
      description: task.description,
    });
    setShowRecentTasks(false);
    toast.success(t("bar.started"));

    // Send timer start notification (async, don't await)
    const projectName = allProjects?.find((p) => p.id === task.projectId)?.name;
    sendTimerStartNotification.mutate({
      projectName,
      description: task.description || undefined,
    });
  };

  const handleContinueRecentEntry = (entry: RecentEntrySelection) => {
    const hours = parseFloat(entry.hours);
    continueEntry({
      entryId: entry.entryId,
      projectId: entry.projectId || undefined,
      clientId: entry.clientId || undefined,
      description: entry.description,
      hours,
    });
    toast.success(
      t("bar.resumedFrom", {
        hours: hours.toLocaleString(toIntlLocale(locale), {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      }),
    );

    // Send timer start notification (async, don't await)
    const projectName = allProjects?.find(
      (p) => p.id === entry.projectId,
    )?.name;
    sendTimerStartNotification.mutate({
      projectName,
      description: entry.description || undefined,
    });
  };

  const handleQuickActionStart = (options: {
    projectId: string | null;
    clientId: string | null;
    description: string;
    templateId?: string;
  }) => {
    useTimerStore.getState().resumeFromEntry({
      projectId: options.projectId || undefined,
      clientId: options.clientId || undefined,
      description: options.description,
    });
    setShowQuickActions(false);
    toast.success(
      options.templateId ? t("bar.startedFromTemplate") : t("bar.started"),
    );

    // Send timer start notification (async, don't await)
    const projectName = allProjects?.find(
      (p) => p.id === options.projectId,
    )?.name;
    sendTimerStartNotification.mutate({
      projectName,
      description: options.description || undefined,
    });
  };

  // Listen for keyboard shortcut events from layout (T key)
  useEffect(() => {
    const onProjectSelectShortcut = () => {
      setShowProjectSelect(true);
    };

    const onStartShortcut = () => {
      // Same rule as handleStart: only a genuine paused session (with
      // sessionStartTime) may be resumed — parked leftovers start fresh.
      const genuinePause = !!useTimerStore.getState().sessionStartTime;
      if (elapsedTime > 0 && !isRunning && genuinePause) {
        resumeTimer();
        toast.success(t("bar.resumedShortcut"));
        return;
      }
      startTimer({ clientId, projectId, description });
      toast.success(t("bar.startedShortcut"));
    };

    const onStopShortcut = async (event?: Event) => {
      if (!clientId) {
        setShowProjectSelect(true);
        toast.error(t("bar.pickClientBeforeSave"));
        return;
      }

      // Claim timer atomically BEFORE pausing (offline: claimes ved synk)
      offlineStopRef.current = offlineStopMeta();
      if (!offlineStopRef.current) {
        const claimed = await timerSync.claimTimerForStop();
        if (!claimed) {
          toast.error(t("bar.stoppedElsewhere"));
          timerSync.checkAndRecoverFromServer();
          return;
        }
        if (claimed === "unsynced") {
          // Starten nåede aldrig serveren (review P2-2): gem via offline-stoppet
          const st = useTimerStore.getState();
          offlineStopRef.current = {
            sessionStartTime: st.sessionStartTime,
            startTime: st.startTime,
          };
        }
      }

      // Get the actual session start time from timer store before pausing.
      // Elapsed læses fra STORE'n, ikke fra closurens `elapsedTime` — idle-
      // dialogen kan lige have trimmet tiden (#588), og en stale closure ville
      // gemme det inaktive tidsrum med alligevel.
      const timerState = useTimerStore.getState();
      const sessionStartTime = timerState.sessionStartTime;
      const duration = timerState.elapsedTime;
      // "Stop timeren kl. …" fra idle-dialogen sender sluttidspunktet med.
      const endOverride = (
        event as CustomEvent<{ endTime?: number }> | undefined
      )?.detail?.endTime;

      // Pause timer and open save modal
      pauseTimer();
      const endTime = endOverride ? new Date(endOverride) : new Date();
      setPendingSaveData({
        duration,
        // Som handleStop: første start, højst slut − sporet tid
        startTime: stoppedTimerStart(
          sessionStartTime ? new Date(sessionStartTime) : endTime,
          endTime,
          duration,
        ),
        endTime,
      });
      setShowSaveModal(true);
    };

    window.addEventListener("timer-project-select", onProjectSelectShortcut);
    window.addEventListener("timer-start-shortcut", onStartShortcut);
    window.addEventListener("timer-stop-shortcut", onStopShortcut);

    return () => {
      window.removeEventListener(
        "timer-project-select",
        onProjectSelectShortcut,
      );
      window.removeEventListener("timer-start-shortcut", onStartShortcut);
      window.removeEventListener("timer-stop-shortcut", onStopShortcut);
    };
  }, [
    projectId,
    clientId,
    startTimer,
    pauseTimer,
    resumeTimer,
    elapsedTime,
    isRunning,
    timerSync,
    description,
    t,
  ]);

  // TimerEnhancements (idle auto-pause) asks us to push the current timer
  // state via THIS hook instance, so the write serializes with heartbeats
  // through the shared isSyncing guard instead of racing from a second
  // mutation instance.
  useEffect(() => {
    const onSyncRequest = () => {
      void timerSync.syncToServer();
    };
    window.addEventListener("timer-sync-request", onSyncRequest);
    return () =>
      window.removeEventListener("timer-sync-request", onSyncRequest);
  }, [timerSync]);

  // Find current project and client names
  const currentProject = allProjects?.find((p) => p.id === projectId);
  const currentClient = clients?.find((c) => c.id === clientId);

  return (
    <section
      className="relative w-full"
      aria-label={t("bar.ariaLabel")}
      data-testid="timer-bar"
      data-timer-state={
        isRunning ? "running" : elapsedTime > 0 ? "paused" : "idle"
      }
    >
      {/* Screen reader announcements */}
      <output aria-live="polite" aria-atomic="true" className="sr-only">
        {isRunning
          ? t("bar.srRunning", { time: formatTime(displaySeconds) })
          : elapsedTime > 0
            ? t("bar.srPaused", { time: formatTime(displaySeconds) })
            : t("bar.srIdle")}
      </output>

      {/* Compact Bar */}
      <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2">
        {/* Timer Display */}
        <div
          className="flex shrink-0 items-center gap-1 sm:gap-1.5"
          role="timer"
          aria-label={t("bar.elapsedAria", {
            time: formatTime(displaySeconds),
          })}
        >
          {/* Mobil: uret skjules, så kundevælgeren har plads (farven viser status) */}
          <div
            className={`relative hidden sm:block ${isRunning ? "animate-pulse" : ""}`}
          >
            <Clock
              className={`h-4 w-4 sm:h-5 sm:w-5 shrink-0 transition-colors duration-300 ${
                isRunning
                  ? "text-brand-600 dark:text-brand-400"
                  : elapsedTime > 0
                    ? "text-orange-500 dark:text-orange-400"
                    : "text-gray-400 dark:text-gray-600"
              }`}
              aria-hidden="true"
            />
            {isRunning && (
              <span
                className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 animate-ping"
                aria-hidden="true"
              />
            )}
          </div>
          <span
            className={`tabular-nums text-sm sm:text-base md:text-lg font-semibold transition-colors duration-300 ${
              isRunning
                ? "text-brand-600 dark:text-brand-400"
                : elapsedTime > 0
                  ? "text-orange-600 dark:text-orange-400"
                  : "text-gray-900 dark:text-white"
            }`}
            aria-hidden="true"
          >
            {formatTime(displaySeconds)}
          </span>
          {/* Milestone badge */}
          {recentMilestone && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300 animate-in fade-in slide-in-from-left-2 duration-300">
              🎉 {recentMilestone}
            </span>
          )}
          {/* Keyboard shortcut hint */}
          <kbd
            className="hidden lg:inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-xs font-mono text-gray-500 dark:text-gray-400"
            title={isRunning ? t("bar.keyHintSave") : t("bar.keyHintStart")}
          >
            T
          </kbd>
          {/* Today's total hours counter */}
          {todayTotalHours != null && todayTotalHours > 0 && (
            <span
              className="hidden lg:inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400"
              title={t("bar.todayTotalTitle")}
            >
              {t("bar.todayTotal", {
                hours: Math.floor(todayTotalHours),
                minutes: Math.round((todayTotalHours % 1) * 60),
              })}
            </span>
          )}
        </div>

        {/* Start/Pause/Resume Button */}
        {!isRunning ? (
          <button
            type="button"
            onClick={handleStart}
            aria-label={
              elapsedTime > 0 ? t("bar.continueTimer") : t("bar.startTimer")
            }
            data-testid="timer-start"
            data-tour="timer-start-btn"
            className="flex items-center justify-center gap-1 rounded-lg bg-tt-gran px-1.5 sm:px-2 md:px-3 py-1.5 text-xs sm:text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk shrink-0 min-h-[44px] min-w-[44px] sm:min-w-0"
          >
            <Play className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {elapsedTime > 0 ? t("bar.continue") : t("bar.start")}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePause}
            aria-label={t("bar.pauseTimer")}
            className="flex items-center justify-center gap-1 rounded-lg bg-orange-600 px-1.5 sm:px-2 md:px-3 py-1.5 text-xs sm:text-sm font-medium text-white transition-colors hover:bg-orange-700 shrink-0 min-h-[44px] min-w-[44px] sm:min-w-0"
          >
            <Pause className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("bar.pause")}</span>
          </button>
        )}

        {/* Save Button - shown when running OR when paused with time */}
        {(isRunning || elapsedTime > 0) && (
          <button
            type="button"
            onClick={handleStop}
            disabled={saveTimeEntryMutation.isPending}
            data-testid="timer-save"
            aria-label={
              saveTimeEntryMutation.isPending
                ? t("bar.savingEntry")
                : t("bar.saveEntry")
            }
            aria-busy={saveTimeEntryMutation.isPending}
            className="flex items-center justify-center gap-1 rounded-lg bg-green-600 px-1.5 sm:px-2 md:px-3 py-1.5 text-xs sm:text-sm font-medium text-white transition-colors hover:bg-green-700 shrink-0 disabled:opacity-50 min-h-[44px] min-w-[44px] sm:min-w-0"
          >
            <Save className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {saveTimeEntryMutation.isPending ? t("bar.saving") : tc("save")}
            </span>
          </button>
        )}

        {/* Reset Button - shown when there's elapsed time */}
        {elapsedTime > 0 && (
          <button
            type="button"
            onClick={handleReset}
            aria-label={t("bar.resetTimerAria")}
            className="flex items-center justify-center rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 px-1.5 sm:px-2 py-1.5 text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0 min-h-[44px] min-w-[44px] sm:min-w-0"
            title={t("bar.resetTimerTitle")}
          >
            <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
          </button>
        )}

        {/* Project Display */}
        {showClientProjectPicker && (
          <button
            type="button"
            onClick={() => setShowProjectSelect(!showProjectSelect)}
            aria-expanded={showProjectSelect}
            aria-haspopup="listbox"
            data-tour="timer-project-select"
            data-testid="timer-client-picker"
            aria-label={
              currentProject
                ? t("bar.selectedProject", { name: currentProject.name })
                : currentClient
                  ? t("bar.selectedClient", { name: currentClient.name })
                  : t("bar.selectProjectOrClient")
            }
            className="flex items-center gap-1 sm:gap-1.5 md:gap-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 sm:px-3 py-1.5 text-xs sm:text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 min-w-0 max-w-[140px] sm:max-w-[180px] md:max-w-xs min-h-[44px]"
          >
            {currentClient ? (
              <span className="text-gray-900 dark:text-white truncate">
                {currentProject ? (
                  <>
                    <span className="hidden lg:inline">
                      {currentClient.name} →{" "}
                    </span>
                    {currentProject.name}
                  </>
                ) : (
                  currentClient.name
                )}
              </span>
            ) : (
              <span className="text-gray-500 dark:text-gray-400 truncate">
                {t("bar.client")}
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-400 dark:text-gray-600 shrink-0" />
          </button>
        )}

        {/* Description Input with autocomplete - visible on md and up */}
        <div className="hidden md:block flex-1 min-w-0 relative">
          <DescriptionAutocomplete
            value={description}
            onChange={updateDescription}
            onSelectEntry={handleContinueRecentEntry}
            placeholder={t("bar.descriptionPlaceholder")}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 px-3 py-1.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
          />
        </div>

        {/* Quick Time Presets - visible on lg and up when timer has time */}
        {elapsedTime > 0 && (
          <div className="hidden lg:flex items-center gap-1">
            {[5, 15, 30].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => handleAddTime(mins)}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-300 dark:hover:bg-tt-gran-lys dark:hover:text-brand-400 dark:hover:border-brand-600 transition-colors"
                title={t("bar.addTitle", { amount: formatAddedMinutes(mins) })}
              >
                {t("addTime.plusMinutes", { mins })}
              </button>
            ))}
          </div>
        )}

        {/* Add Time Button - hidden on small screens */}
        <button
          type="button"
          onClick={() => setShowAddTimeModal(true)}
          className="hidden md:flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 shrink-0"
          title={t("bar.addMore")}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden lg:inline">{t("bar.more")}</span>
        </button>

        {/* Quick Actions Button - hidden on mobile, shown when no timer running */}
        {!isRunning && elapsedTime === 0 && (
          <button
            type="button"
            onClick={() => setShowQuickActions(true)}
            className="hidden sm:flex items-center gap-1 sm:gap-1.5 rounded-lg border border-brand-300 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-100 dark:hover:bg-tt-gran-lys shrink-0"
            title={t("bar.quickStartTitle")}
          >
            <Zap className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden lg:inline">{t("bar.quick")}</span>
          </button>
        )}

        {/* Mobile More Button - shown only on mobile (md and below) */}
        <button
          type="button"
          onClick={() => setShowMobileActions(true)}
          className="flex md:hidden items-center justify-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 shrink-0 min-h-[44px] min-w-[44px]"
          aria-label={t("bar.moreOptions")}
          title={t("bar.moreOptions")}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Modals */}
      {showClientProjectPicker && (
        <ClientProjectSelectModal
          isOpen={showProjectSelect}
          onClose={() => setShowProjectSelect(false)}
          onSelectProject={handleProjectSelect}
          onSelectClientOnly={handleClientOnlySelect}
          clients={clients}
          projects={allProjects}
          selectedProjectId={projectId}
          selectedClientId={clientId}
          recentClientIds={
            recentTasks
              ? [
                  ...new Set(
                    recentTasks
                      .map((task) => task.clientId)
                      .filter(Boolean) as string[],
                  ),
                ]
              : undefined
          }
        />
      )}

      <AddTimeModal
        isOpen={showAddTimeModal}
        onClose={() => setShowAddTimeModal(false)}
        onAddTime={handleAddTime}
      />

      <RecentTasksModal
        isOpen={showRecentTasks}
        onClose={() => setShowRecentTasks(false)}
        onSelectTask={handleStartRecentTask}
        tasks={recentTasks}
      />

      <MobileActionsSheet
        isOpen={showMobileActions}
        onClose={() => setShowMobileActions(false)}
        description={description}
        onDescriptionChange={updateDescription}
        onOpenAddTime={() => setShowAddTimeModal(true)}
        onOpenRecentTasks={() => setShowRecentTasks(true)}
        onOpenQuickActions={() => setShowQuickActions(true)}
        onSave={handleStop}
        elapsedTime={elapsedTime}
        isRunning={isRunning}
        canSave={!!clientId}
        projectName={currentProject?.name}
        clientName={currentClient?.name}
      />

      <SaveTimeEntryModal
        isOpen={showSaveModal}
        onClose={handleSaveModalClose}
        onSave={handleSaveConfirm}
        hours={pendingSaveData ? pendingSaveData.duration / 3600 : 0}
        description={description}
        projectId={projectId}
        clientId={clientId}
        projectName={currentProject?.name}
        clientName={currentClient?.name}
        taskId={taskId}
        isSaving={
          saveTimeEntryMutation.isPending || markTaskDoneMutation.isPending
        }
        onProjectChange={(newProjectId, newClientId) => {
          updateProject(newProjectId, newClientId);
        }}
        isSegmentMode={!!resumeEntryId}
      />

      <QuickActionsDropdown
        isOpen={showQuickActions}
        onClose={() => setShowQuickActions(false)}
        onStartTimer={handleQuickActionStart}
        onCreateTemplate={() => {
          setShowQuickActions(false);
          setShowCreateTemplate(true);
        }}
      />

      <CreateTemplateModal
        isOpen={showCreateTemplate}
        onClose={() => setShowCreateTemplate(false)}
        defaultProjectId={projectId}
        defaultClientId={clientId}
        defaultDescription={description}
      />

      <ConfirmDialog
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={handleResetConfirm}
        title={t("bar.resetTitle")}
        description={t("bar.resetDescription")}
        confirmLabel={t("bar.resetConfirm")}
        variant="warning"
      />
    </section>
  );
}
