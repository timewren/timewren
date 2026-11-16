"use client";

import {
  Coffee,
  Pause,
  Play,
  RotateCcw,
  Settings,
  SkipForward,
  Timer,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { type PomodoroPhase, usePomodoroStore } from "@/stores/pomodoroStore";

function formatPomodoroTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function getPhaseColor(phase: PomodoroPhase): string {
  switch (phase) {
    case "work":
      return "text-red-600 dark:text-red-400";
    case "shortBreak":
      return "text-green-600 dark:text-green-400";
    case "longBreak":
      return "text-brand-600 dark:text-brand-400";
  }
}

function getPhaseBackgroundColor(phase: PomodoroPhase): string {
  switch (phase) {
    case "work":
      return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
    case "shortBreak":
      return "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800";
    case "longBreak":
      return "bg-brand-50 dark:bg-tt-gran-lys border-brand-200 dark:border-brand-600";
  }
}

interface PomodoroSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function PomodoroSettingsModal({
  isOpen,
  onClose,
}: PomodoroSettingsModalProps) {
  const fid = useId();
  const t = useTranslations("timer");
  const tc = useTranslations("common");
  const { settings, updateSettings } = usePomodoroStore();
  const [localSettings, setLocalSettings] = useState(settings);

  useEscapeKey(onClose, isOpen);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleSave = () => {
    updateSettings(localSettings);
    toast.success(t("pomodoro.settingsSaved"));
    onClose();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-xl mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t("pomodoro.settingsTitle")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Work Duration */}
          <div>
            <label
              htmlFor={`${fid}-f1`}
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("pomodoro.workMinutes")}
            </label>
            <input
              id={`${fid}-f1`}
              type="number"
              min="1"
              max="60"
              value={localSettings.workDuration}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  workDuration: parseInt(e.target.value, 10) || 25,
                })
              }
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white"
            />
          </div>

          {/* Short Break Duration */}
          <div>
            <label
              htmlFor={`${fid}-f2`}
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("pomodoro.shortBreakMinutes")}
            </label>
            <input
              id={`${fid}-f2`}
              type="number"
              min="1"
              max="30"
              value={localSettings.shortBreakDuration}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  shortBreakDuration: parseInt(e.target.value, 10) || 5,
                })
              }
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white"
            />
          </div>

          {/* Long Break Duration */}
          <div>
            <label
              htmlFor={`${fid}-f3`}
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("pomodoro.longBreakMinutes")}
            </label>
            <input
              id={`${fid}-f3`}
              type="number"
              min="1"
              max="60"
              value={localSettings.longBreakDuration}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  longBreakDuration: parseInt(e.target.value, 10) || 15,
                })
              }
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white"
            />
          </div>

          {/* Sessions before long break */}
          <div>
            <label
              htmlFor={`${fid}-f4`}
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("pomodoro.sessionsBeforeLongBreak")}
            </label>
            <input
              id={`${fid}-f4`}
              type="number"
              min="2"
              max="8"
              value={localSettings.sessionsBeforeLongBreak}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  sessionsBeforeLongBreak: parseInt(e.target.value, 10) || 4,
                })
              }
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white"
            />
          </div>

          {/* Auto-start options */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.autoStartBreaks}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    autoStartBreaks: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t("pomodoro.autoStartBreaks")}
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.autoStartWork}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    autoStartWork: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t("pomodoro.autoStartWork")}
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.soundEnabled}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    soundEnabled: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t("pomodoro.sound")}
              </span>
            </label>
          </div>
        </div>

        <div className="flex gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {tc("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-lg bg-tt-gran px-4 py-2 font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            {tc("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PomodoroTimerProps {
  onWorkComplete?: () => void;
}

export function PomodoroTimer({ onWorkComplete }: PomodoroTimerProps) {
  const t = useTranslations("timer");
  const {
    isEnabled,
    isActive,
    phase,
    timeRemaining,
    sessionsCompleted,
    settings,
    todayWorkSessions,
    toggleEnabled,
    startPomodoro,
    pausePomodoro,
    resumePomodoro,
    skipPhase,
    resetPomodoro,
    tick,
  } = usePomodoroStore();

  const [showSettings, setShowSettings] = useState(false);
  const _audioRef = useRef<HTMLAudioElement | null>(null);

  // Play notification sound
  const playNotificationSound = useCallback(() => {
    if (!settings.soundEnabled) return;

    // Use Web Audio API for a simple notification
    try {
      const audioContext = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = "sine";

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.5,
      );

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch {
      // Audio not supported
    }
  }, [settings.soundEnabled]);

  // Tick effect
  useEffect(() => {
    if (!isEnabled || !isActive) return;

    const interval = setInterval(() => {
      const result = tick();
      if (result.phaseComplete) {
        playNotificationSound();

        if (result.newPhase === "work") {
          toast.info(t("pomodoro.breakOver"), {
            icon: <Timer className="h-4 w-4" />,
          });
        } else if (result.newPhase === "shortBreak") {
          toast.success(t("pomodoro.goodWork"), {
            icon: <Coffee className="h-4 w-4" />,
          });
          onWorkComplete?.();
        } else if (result.newPhase === "longBreak") {
          toast.success(t("pomodoro.greatWork"), {
            icon: <Coffee className="h-4 w-4" />,
          });
          onWorkComplete?.();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isEnabled, isActive, tick, playNotificationSound, onWorkComplete, t]);

  if (!isEnabled) {
    return (
      <button
        type="button"
        onClick={toggleEnabled}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        title={t("pomodoro.enable")}
      >
        <Timer className="h-4 w-4" />
        {t("pomodoro.name")}
      </button>
    );
  }

  // Calculate progress percentage
  const totalDuration =
    phase === "work"
      ? settings.workDuration * 60
      : phase === "shortBreak"
        ? settings.shortBreakDuration * 60
        : settings.longBreakDuration * 60;
  const progress = ((totalDuration - timeRemaining) / totalDuration) * 100;

  return (
    <>
      <div
        className={`rounded-lg border p-3 ${getPhaseBackgroundColor(phase)}`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {phase === "work" ? (
              <Timer className={`h-4 w-4 ${getPhaseColor(phase)}`} />
            ) : (
              <Coffee className={`h-4 w-4 ${getPhaseColor(phase)}`} />
            )}
            <span className={`text-sm font-medium ${getPhaseColor(phase)}`}>
              {t(`pomodoro.phase.${phase}`)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
              title={t("pomodoro.settings")}
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleEnabled}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
              title={t("pomodoro.disable")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Timer display */}
        <div className="text-center mb-3">
          <div
            className={`text-3xl tabular-nums font-bold ${getPhaseColor(phase)}`}
          >
            {formatPomodoroTime(timeRemaining)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t("pomodoro.session", {
              current: sessionsCompleted + 1,
              total: settings.sessionsBeforeLongBreak,
            })}
            {todayWorkSessions > 0 && (
              <span className="ml-2">
                {t("pomodoro.today", { count: todayWorkSessions })}
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
          <div
            className={`h-full transition-all duration-1000 ${
              phase === "work"
                ? "bg-red-500"
                : phase === "shortBreak"
                  ? "bg-green-500"
                  : "bg-brand-500"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={resetPomodoro}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            title={t("pomodoro.reset")}
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          {isActive ? (
            <button
              type="button"
              onClick={pausePomodoro}
              className={`p-3 rounded-full ${
                phase === "work"
                  ? "bg-red-600 hover:bg-red-700"
                  : phase === "shortBreak"
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-brand-600 hover:bg-brand-700"
              } text-white`}
              title={t("pomodoro.pause")}
            >
              <Pause className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={
                timeRemaining === totalDuration ? startPomodoro : resumePomodoro
              }
              className={`p-3 rounded-full ${
                phase === "work"
                  ? "bg-red-600 hover:bg-red-700"
                  : phase === "shortBreak"
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-brand-600 hover:bg-brand-700"
              } text-white`}
              title={t("pomodoro.start")}
            >
              <Play className="h-5 w-5" />
            </button>
          )}

          <button
            type="button"
            onClick={skipPhase}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            title={t("pomodoro.skip")}
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>
      </div>

      <PomodoroSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
}
