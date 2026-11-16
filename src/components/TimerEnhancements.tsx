"use client";

import { Moon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui";
import { useBadge } from "@/hooks/useBadge";
import { useIdleDetection } from "@/hooks/useIdleDetection";
import { useTimerTabOwner } from "@/hooks/useTimerTabOwner";
import { useWakeLock } from "@/hooks/useWakeLock";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  awaySeconds,
  decideOnReturn,
  elapsedAtIdle,
  shouldWatchdogAutoPause,
} from "@/lib/timer/idle";
import {
  type IdleStampChannel,
  mergeIdleStamp,
  openIdleStampChannel,
} from "@/lib/timer/idle-stamp-channel";
import { trpc } from "@/providers/trpc-provider";
import { useTimerStore } from "@/stores/timerStore";

/**
 * Timer Enhancements Component
 *
 * Integrates advanced PWA features with the timer:
 * - Idle Detection: registrerer HVORNÅR inaktiviteten begyndte og spørger
 *   brugeren ved tilbagekomst hvad der skal ske med det MÅLTE fravær.
 *   Timeren pauses IKKE af almindelig inaktivitet (#588) — kun af den hårde
 *   grænse for lang stilstand (autoPauseAfterMinutes, default 2 timer).
 * - Wake Lock: Keep screen active while timer is running
 * - Badging: Show elapsed time on app icon (minutes)
 */

interface IdleQuestion {
  /** Hvornår inaktiviteten begyndte (ms) — serverens stempel. */
  idleAtMs: number;
  /** Målt fravær i sekunder. */
  awaySeconds: number;
  /** Blev timeren pauset hårdt pga. lang stilstand? */
  autoPaused: boolean;
}

export function TimerEnhancements() {
  const t = useTranslations("timer");
  const locale = useLocale();
  const formatAwayLabel = (seconds: number): string => {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return t("enhancements.awayMin", { minutes });
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0
      ? t("enhancements.awayHour", { hours })
      : t("enhancements.awayHourMin", { hours, minutes: rest });
  };
  const formatClock = (ms: number): string =>
    new Date(ms).toLocaleTimeString(toIntlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
    });
  const { isRunning, elapsedTime } = useTimerStore();

  // User-configurable idle threshold (minutes) — lives on the server and is
  // shared with the browser extension. Falls back to 5 minutes.
  const { data: idleSettings } = trpc.timerSync.getIdleSettings.useQuery(
    undefined,
    { staleTime: 60_000 },
  );
  const thresholdMinutes = idleSettings?.idleThresholdMinutes ?? 5;
  const thresholdMs = thresholdMinutes * 60_000;
  const autoPauseAfterMinutes = idleSettings?.autoPauseAfterMinutes ?? null;
  const settingsRef = useRef({ thresholdMinutes, autoPauseAfterMinutes });
  settingsRef.current = { thresholdMinutes, autoPauseAfterMinutes };

  const reportIdleMutation = trpc.timerSync.reportIdle.useMutation();
  const reportIdleRef = useRef(reportIdleMutation.mutateAsync);
  reportIdleRef.current = reportIdleMutation.mutateAsync;

  // One-shot state push so an idle-pause propagates to the server (and the
  // extension) immediately — the periodic heartbeat stops when the timer
  // pauses. Routed through TimeTrackingBar's useTimerSync instance (via a
  // window event) so the write serializes with in-flight heartbeats instead
  // of racing them from a second, unguarded mutation instance.
  const pushTimerStateToServer = useCallback(() => {
    window.dispatchEvent(new Event("timer-sync-request"));
  }, []);

  // Spørgsmålet der venter på brugeren når hun er tilbage.
  const [question, setQuestion] = useState<IdleQuestion | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const questionRef = useRef(question);
  questionRef.current = question;
  // Serverens idle-stempel, som denne klient kender det. Bruges af vagthunden
  // der håndhæver den hårde grænse mens brugeren stadig er væk.
  const idleStartedAtRef = useRef<number | null>(null);

  // Stemplet deles med de andre faner, så ejer-fanens vagthund kender det,
  // selv om brugeren gik fra en anden fane (lib/timer/idle-stamp-channel.ts).
  const idleChannelRef = useRef<IdleStampChannel | null>(null);
  useEffect(() => {
    const channel = openIdleStampChannel((at) => {
      idleStartedAtRef.current = mergeIdleStamp(idleStartedAtRef.current, at);
    });
    idleChannelRef.current = channel;
    return () => {
      channel?.close();
      idleChannelRef.current = null;
    };
  }, []);

  // Kun ejer-fanen lader vagthunden pause timeren (lib/timer/tab-owner.ts).
  const { isOwner } = useTimerTabOwner();
  const isOwnerRef = useRef(isOwner);
  isOwnerRef.current = isOwner;

  // Wake Lock: Keep screen active while timer is running
  const wakeLock = useWakeLock({
    showNotifications: false, // Don't show toasts, too noisy
  });

  /** Pauser timeren med elapsed sat til værdien ved `idleAtMs`. */
  const applyAutoPause = useCallback(
    (idleAtMs: number) => {
      const store = useTimerStore.getState();
      if (!store.isRunning) return;
      const away = awaySeconds(idleAtMs, Date.now());
      const target = elapsedAtIdle(store.elapsedTime, away);
      console.log("[TimerEnhancements] Lang stilstand — auto-pause", {
        idleAtMs,
        away,
        target,
      });
      useTimerStore.setState({
        isRunning: false,
        startTime: null,
        baseTime: target,
        elapsedTime: target,
      });
      pushTimerStateToServer();
    },
    [pushTimerStateToServer],
  );

  const onIdle = useCallback(async () => {
    const store = useTimerStore.getState();
    if (!store.isRunning) return;

    // Timeren kører VIDERE — vi registrerer kun hvornår inaktiviteten begyndte.
    // Første detektor (web eller extension) vinder stemplet på serveren.
    console.log("[TimerEnhancements] Inaktivitet registreret (ingen pause)");
    try {
      const result = await reportIdleRef.current({
        isIdle: true,
        wasRunning: true,
      });
      idleStartedAtRef.current = result?.idleDetectedAt
        ? new Date(result.idleDetectedAt).getTime()
        : Date.now();
    } catch (error) {
      console.error("[TimerEnhancements] Kunne ikke melde inaktivitet", error);
      idleStartedAtRef.current = Date.now();
    }
    idleChannelRef.current?.post(idleStartedAtRef.current);
  }, []);

  /**
   * Brugeren er tilbage: KLIP serverens idle-stempel ud og spørg om det målte
   * fravær. Serveren afgør hvem der spørger — får vi null, har extensionen
   * allerede taget spørgsmålet, og så spørger vi ikke om det samme igen.
   */
  const claimAndAsk = useCallback(async () => {
    if (questionRef.current) return; // Der står allerede et spørgsmål.
    let claimedAtMs: number | null = null;
    try {
      const result = await reportIdleRef.current({ isIdle: false });
      claimedAtMs = result?.idleDetectedAt
        ? new Date(result.idleDetectedAt).getTime()
        : null;
    } catch (error) {
      console.error("[TimerEnhancements] Kunne ikke melde aktivitet", error);
      claimedAtMs = idleStartedAtRef.current;
    }
    idleStartedAtRef.current = null;
    idleChannelRef.current?.post(null);
    if (!claimedAtMs) return;

    const decision = decideOnReturn({
      idleDetectedAtMs: claimedAtMs,
      nowMs: Date.now(),
      thresholdMinutes: settingsRef.current.thresholdMinutes,
      autoPauseAfterMinutes: settingsRef.current.autoPauseAfterMinutes,
    });
    if (decision.action === "none") return;

    if (decision.action === "auto-pause") {
      applyAutoPause(claimedAtMs);
    }
    setQuestion({
      idleAtMs: claimedAtMs,
      awaySeconds: decision.awaySeconds,
      autoPaused: decision.action === "auto-pause",
    });
    setDialogOpen(true);
  }, [applyAutoPause]);

  const onActive = useCallback(() => {
    console.log("[TimerEnhancements] User active again");
    void claimAndAsk();
  }, [claimAndAsk]);

  // Idle Detection: registrerer inaktivitet mens timeren kører.
  const idleDetection = useIdleDetection({
    threshold: Math.max(60_000, thresholdMs),
    enabled: isRunning,
    onIdle,
    onActive,
  });

  // Extensionen ser systemdækkende inaktivitet som web-fanen ikke selv kan se
  // (skjult fane = ingen events). Så snart fanen bliver synlig igen, spørger
  // vi serveren om der står et uafhentet idle-stempel. Klip-og-spørg er
  // atomisk, så web og extension kan ikke begge spørge om det samme fravær.
  useEffect(() => {
    if (!isRunning) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void claimAndAsk();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [isRunning, claimAndAsk]);

  // Vagthund for den HÅRDE grænse: brugeren er stadig væk, så der kommer
  // ingen active-event. Kører kun mens web-fanen er åben; extensionen har sin
  // egen vagthund på timer-sync-alarmen for når fanen er lukket. Den kører i
  // alle åbne faner, men kun ejer-fanen pauser (ellers én pause pr. fane).
  useEffect(() => {
    if (!isRunning) return;
    const tick = () => {
      const idleAt = idleStartedAtRef.current;
      if (!idleAt) return;
      const pause = shouldWatchdogAutoPause({
        idleDetectedAtMs: idleAt,
        nowMs: Date.now(),
        thresholdMinutes: settingsRef.current.thresholdMinutes,
        autoPauseAfterMinutes: settingsRef.current.autoPauseAfterMinutes,
        // Uden kanal kender ejer-fanen måske ikke stemplet: så må alle.
        isOwner: isOwnerRef.current || idleChannelRef.current === null,
      });
      if (pause) applyAutoPause(idleAt);
    };
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, [isRunning, applyAutoPause]);

  const closeIdleDialog = useCallback(() => {
    setDialogOpen(false);
    setQuestion(null);
  }, []);

  /** "Behold tiden" — timeren rører vi ikke. */
  const handleKeepIdle = useCallback(() => {
    const q = questionRef.current;
    if (q?.autoPaused) {
      // Timeren blev pauset af den hårde grænse — genoptag fra den trimmede
      // elapsed uden at tælle stilstanden med.
      const store = useTimerStore.getState();
      useTimerStore.setState({
        isRunning: true,
        startTime: Date.now(),
        baseTime: store.elapsedTime,
        elapsedTime: store.elapsedTime,
      });
      pushTimerStateToServer();
    }
    closeIdleDialog();
  }, [closeIdleDialog, pushTimerStateToServer]);

  /** "Fjern de X min" — træk det MÅLTE fravær fra, aldrig en fast tærskel. */
  const handleDiscardIdle = useCallback(() => {
    const q = questionRef.current;
    if (!q) return closeIdleDialog();
    const store = useTimerStore.getState();
    const target = elapsedAtIdle(store.elapsedTime, q.awaySeconds);
    useTimerStore.setState({
      isRunning: true,
      startTime: Date.now(),
      baseTime: target,
      elapsedTime: target,
    });
    pushTimerStateToServer();
    closeIdleDialog();
  }, [closeIdleDialog, pushTimerStateToServer]);

  /** "Stop timeren kl. HH:MM" — gem frem til inaktivitetens start. */
  const handleStopAtIdle = useCallback(() => {
    const q = questionRef.current;
    if (!q) return closeIdleDialog();
    const store = useTimerStore.getState();
    const target = q.autoPaused
      ? store.elapsedTime
      : elapsedAtIdle(store.elapsedTime, q.awaySeconds);
    useTimerStore.setState({
      isRunning: true,
      startTime: Date.now() - target * 1000,
      baseTime: 0,
      elapsedTime: target,
    });
    closeIdleDialog();
    // TimeTrackingBar ejer stop+gem-flowet (claim, save-modal).
    window.dispatchEvent(
      new CustomEvent("timer-stop-shortcut", {
        detail: { endTime: q.idleAtMs },
      }),
    );
  }, [closeIdleDialog]);

  // Badge: Show timer minutes on app icon
  const badge = useBadge();

  // Use refs for hook objects to prevent infinite loops.
  // These hooks return new object references on state changes, which would
  // re-trigger useEffect dependencies and cause an infinite render loop.
  const wakeLockRef = useRef(wakeLock);
  wakeLockRef.current = wakeLock;

  const badgeRef = useRef(badge);
  badgeRef.current = badge;

  // Track last badge value to avoid redundant updates
  const lastBadgeMinutesRef = useRef<number | null>(null);

  // Request wake lock when timer starts
  useEffect(() => {
    if (isRunning) {
      console.log("[TimerEnhancements] Timer started, requesting wake lock");
      wakeLockRef.current.request();
    } else {
      console.log("[TimerEnhancements] Timer stopped, releasing wake lock");
      wakeLockRef.current.release();
    }
  }, [isRunning]);

  // Update badge with elapsed minutes (only when minutes actually change)
  useEffect(() => {
    if (!badgeRef.current.isSupported) {
      return;
    }

    if (isRunning && elapsedTime > 0) {
      const minutes = Math.floor(elapsedTime / 60);
      if (minutes > 0 && minutes !== lastBadgeMinutesRef.current) {
        lastBadgeMinutesRef.current = minutes;
        badgeRef.current.setBadge(minutes);
      }
    } else if (lastBadgeMinutesRef.current !== null) {
      lastBadgeMinutesRef.current = null;
      badgeRef.current.clearBadge();
    }
  }, [isRunning, elapsedTime]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wakeLockRef.current.release();
      badgeRef.current.clearBadge();
    };
  }, []);

  // Show idle detection status in dev mode
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && idleDetection.isIdle) {
      console.log("[TimerEnhancements] Idle detection:", {
        isIdle: idleDetection.isIdle,
        idleTime: idleDetection.idleTime,
        lastActivity: idleDetection.lastActivityTime,
      });
    }
  }, [
    idleDetection.isIdle,
    idleDetection.idleTime,
    idleDetection.lastActivityTime,
  ]);

  const awayLabel = question ? formatAwayLabel(question.awaySeconds) : "";
  const sinceLabel = question ? formatClock(question.idleAtMs) : "";

  return (
    <Modal
      isOpen={dialogOpen && question !== null}
      onClose={closeIdleDialog}
      title={t("enhancements.title")}
      size="md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-lg bg-purple-100 dark:bg-purple-900/30 p-2.5">
            <Moon className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {question?.autoPaused
              ? t("enhancements.autoPaused", {
                  since: sinceLabel,
                  away: awayLabel,
                })
              : t("enhancements.away", {
                  away: awayLabel,
                  since: sinceLabel,
                })}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {question?.autoPaused ? (
            <button
              type="button"
              onClick={handleKeepIdle}
              className="w-full rounded-lg bg-tt-gran px-4 py-2.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk transition-colors"
            >
              {t("enhancements.resumeNow")}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleKeepIdle}
                className="w-full rounded-lg bg-tt-gran px-4 py-2.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk transition-colors"
              >
                {t("enhancements.keepTime")}
              </button>
              <button
                type="button"
                onClick={handleDiscardIdle}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {t("enhancements.removeAway", { away: awayLabel })}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleStopAtIdle}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t("enhancements.stopAt", { since: sinceLabel })}
          </button>
          <button
            type="button"
            onClick={closeIdleDialog}
            className="w-full rounded-lg px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            {t("enhancements.decideLater")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
