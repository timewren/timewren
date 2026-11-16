"use client";

import { AlertTriangle, Clock, Play, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { toIntlLocale } from "@/i18n/format-locale";
import { useTimerStore } from "@/stores/timerStore";

interface RecoveryData {
  projectId: string | null;
  clientId: string | null;
  taskId: string | null;
  description: string;
  elapsedTime: number;
  sessionStartTime: number;
  wasRunning: boolean;
}

// Key for tracking when the page was last active
const LAST_ACTIVE_KEY = "timer-last-active";
const RECOVERY_THRESHOLD_MS = 5000; // 5 seconds - if more than this since last active, show recovery

export function TimerRecoveryDialog() {
  const t = useTranslations("timer");
  const locale = useLocale();
  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) return t("recovery.hms", { h, m, s });
    if (m > 0) return t("recovery.ms", { m, s });
    return t("recovery.s", { s });
  };
  const formatTime = (timestamp: number): string =>
    new Date(timestamp).toLocaleTimeString(toIntlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
    });
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryData, setRecoveryData] = useState<RecoveryData | null>(null);

  const { isRunning, elapsedTime, resetTimer, resumeTimer, tick } =
    useTimerStore();

  // Check for recovery on mount
  useEffect(() => {
    const checkRecovery = () => {
      const lastActive = localStorage.getItem(LAST_ACTIVE_KEY);
      const now = Date.now();

      // Get persisted timer state
      const timerState = useTimerStore.getState();

      // If timer was running and we've been away for a while
      if (timerState.sessionStartTime && timerState.elapsedTime > 0) {
        const timeSinceLastActive = lastActive
          ? now - parseInt(lastActive, 10)
          : Infinity;

        // If we've been away for more than the threshold
        if (timeSinceLastActive > RECOVERY_THRESHOLD_MS) {
          // Calculate what the elapsed time should be if the timer kept running
          const expectedElapsed = timerState.isRunning
            ? timerState.baseTime +
              Math.floor((now - (timerState.startTime || now)) / 1000)
            : timerState.elapsedTime;

          setRecoveryData({
            projectId: timerState.projectId,
            clientId: timerState.clientId,
            taskId: timerState.taskId,
            description: timerState.description,
            elapsedTime: expectedElapsed,
            sessionStartTime: timerState.sessionStartTime,
            wasRunning: timerState.isRunning,
          });
          setShowRecovery(true);
        }
      }

      // Update last active timestamp
      localStorage.setItem(LAST_ACTIVE_KEY, now.toString());
    };

    // Small delay to let hydration complete
    const timeout = setTimeout(checkRecovery, 100);
    return () => clearTimeout(timeout);
  }, []);

  // Keep updating last active timestamp while on page
  useEffect(() => {
    const interval = setInterval(() => {
      localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Update elapsed time on tick if running
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      tick();
      localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, tick]);

  const handleResume = () => {
    // Timer is already in the correct state from persistence
    // Just make sure it's running
    if (!isRunning && elapsedTime > 0) {
      resumeTimer();
    }
    toast.success(t("recovery.resumed"));
    setShowRecovery(false);
  };

  const handleDiscard = () => {
    resetTimer();
    toast.info(t("recovery.reset"));
    setShowRecovery(false);
  };

  if (!showRecovery || !recoveryData) {
    return null;
  }

  return (
    <Modal
      isOpen={showRecovery}
      onClose={() => setShowRecovery(false)}
      title={t("recovery.title")}
      size="md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-300">
            <p className="font-medium">{t("recovery.hadActive")}</p>
            <p className="mt-1">{t("recovery.explanation")}</p>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-brand-500 dark:text-brand-400" />
            <div>
              <p className="tabular-nums text-2xl font-bold text-gray-900 dark:text-white">
                {formatDuration(recoveryData.elapsedTime)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("recovery.startedAt", {
                  time: formatTime(recoveryData.sessionStartTime),
                })}
              </p>
            </div>
          </div>

          {recoveryData.description && (
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("recovery.description")}
              </p>
              <p className="text-gray-900 dark:text-white">
                {recoveryData.description}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={handleDiscard}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            {t("recovery.discard")}
          </button>
          <button
            type="button"
            onClick={handleResume}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-tt-paa-gran bg-tt-gran rounded-lg hover:bg-tt-gran-moerk transition-colors"
          >
            <Play className="h-4 w-4" />
            {t("recovery.resume")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
