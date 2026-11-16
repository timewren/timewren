"use client";

import { Clock, Pause, Play, Plus, Square, Timer, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useTimerStore } from "@/stores/timerStore";

function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function FloatingTimerButton() {
  const t = useTranslations("timer");
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const {
    isRunning,
    elapsedTime,
    projectId,
    clientId,
    description,
    startTimer,
    pauseTimer,
    resumeTimer,
    resetTimer,
  } = useTimerStore();

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Only show on mobile
  if (!isMobile) {
    return null;
  }

  const handleMainButtonClick = () => {
    if (isRunning || elapsedTime > 0) {
      setIsExpanded(!isExpanded);
    } else {
      // Start fresh timer
      startTimer({ clientId, projectId, description });
    }
  };

  const handlePauseResume = () => {
    if (isRunning) {
      pauseTimer();
    } else if (useTimerStore.getState().sessionStartTime) {
      // Only genuine paused sessions may resume — leftover elapsed without a
      // sessionStartTime is an already-saved session parked by the sync.
      resumeTimer();
    } else {
      startTimer({ clientId, projectId, description });
    }
  };

  const handleStop = () => {
    // Navigate to save the entry
    router.push("/dashboard/time");
    setIsExpanded(false);
  };

  const handleDiscard = () => {
    resetTimer();
    setIsExpanded(false);
  };

  const handleNewEntry = () => {
    router.push("/dashboard/time/new");
    setIsExpanded(false);
  };

  // Determine FAB state
  const hasActiveTimer = isRunning || elapsedTime > 0;

  return (
    <>
      {/* Backdrop when expanded */}
      {isExpanded && (
        <button
          type="button"
          aria-label={t("floating.close")}
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setIsExpanded(false)}
        />
      )}

      {/* FAB Container */}
      <div className="fixed bottom-20 lg:bottom-6 right-6 z-50 flex flex-col-reverse items-end gap-3">
        {/* Expanded actions */}
        {isExpanded && hasActiveTimer && (
          <div className="flex flex-col-reverse items-end gap-2 animate-in slide-in-from-bottom-4 duration-200">
            {/* Stop and save */}
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-2 rounded-full bg-green-600 px-4 py-2.5 text-white shadow-lg hover:bg-green-700 active:scale-95 transition-all"
            >
              <Square className="h-4 w-4 fill-current" />
              <span className="text-sm font-medium">{t("floating.save")}</span>
            </button>

            {/* Pause/Resume */}
            <button
              type="button"
              onClick={handlePauseResume}
              className="flex items-center gap-2 rounded-full bg-tt-gran px-4 py-2.5 text-tt-paa-gran shadow-lg hover:bg-tt-gran-moerk active:scale-95 transition-all"
            >
              {isRunning ? (
                <>
                  <Pause className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {t("floating.pause")}
                  </span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {t("floating.continue")}
                  </span>
                </>
              )}
            </button>

            {/* Discard */}
            <button
              type="button"
              onClick={handleDiscard}
              className="flex items-center gap-2 rounded-full bg-gray-600 px-4 py-2.5 text-white shadow-lg hover:bg-gray-700 active:scale-95 transition-all"
            >
              <X className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t("floating.discard")}
              </span>
            </button>
          </div>
        )}

        {/* Quick add entry when no timer */}
        {isExpanded && !hasActiveTimer && (
          <div className="flex flex-col-reverse items-end gap-2 animate-in slide-in-from-bottom-4 duration-200">
            <button
              type="button"
              onClick={handleNewEntry}
              className="flex items-center gap-2 rounded-full bg-tt-gran px-4 py-2.5 text-tt-paa-gran shadow-lg hover:bg-tt-gran-moerk active:scale-95 transition-all"
            >
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t("floating.manualEntry")}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                startTimer({ clientId, projectId, description });
                setIsExpanded(false);
              }}
              className="flex items-center gap-2 rounded-full bg-green-600 px-4 py-2.5 text-white shadow-lg hover:bg-green-700 active:scale-95 transition-all"
            >
              <Play className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t("floating.startTimer")}
              </span>
            </button>
          </div>
        )}

        {/* Main FAB button */}
        <button
          type="button"
          onClick={handleMainButtonClick}
          aria-label={
            hasActiveTimer
              ? isExpanded
                ? t("floating.closeMenu")
                : t("floating.openMenu")
              : t("floating.startTimer")
          }
          className={`relative flex items-center justify-center rounded-full shadow-lg transition-all active:scale-95 ${
            hasActiveTimer
              ? isRunning
                ? "bg-green-600 hover:bg-green-700"
                : "bg-amber-600 hover:bg-amber-700"
              : "bg-tt-gran hover:bg-tt-gran-moerk"
          } ${
            hasActiveTimer && !isExpanded
              ? "min-w-[120px] px-4 py-3" // Wider when showing time
              : "h-14 w-14"
          }`}
        >
          {hasActiveTimer ? (
            isExpanded ? (
              <X className="h-6 w-6 text-white" />
            ) : (
              <div className="flex items-center gap-2">
                <Timer
                  className={`h-5 w-5 text-white ${isRunning ? "animate-pulse" : ""}`}
                />
                <span className="tabular-nums text-sm font-bold text-white">
                  {formatTime(elapsedTime)}
                </span>
              </div>
            )
          ) : isExpanded ? (
            <X className="h-6 w-6 text-tt-paa-gran" />
          ) : (
            <Plus className="h-6 w-6 text-tt-paa-gran" />
          )}

          {/* Pulse animation when running */}
          {isRunning && !isExpanded && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
            </span>
          )}
        </button>
      </div>
    </>
  );
}
