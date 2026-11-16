"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { sharedT } from "@/i18n/shared-text";
import { useTimerStore } from "@/stores/timerStore";

// Check if user is typing in an input field
function isTypingInInput(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  const tagName = activeElement.tagName.toLowerCase();
  const isInput =
    tagName === "input" || tagName === "textarea" || tagName === "select";
  const isContentEditable =
    activeElement.getAttribute("contenteditable") === "true";
  const isRichTextEditor = activeElement.closest("[role='textbox']") !== null;

  return isInput || isContentEditable || isRichTextEditor;
}

export function useTimerShortcuts() {
  const { isRunning, baseTime, elapsedTime, pauseTimer, resetTimer } =
    useTimerStore();

  // Timer is paused if not running but has accumulated time
  const isPaused = !isRunning && (baseTime > 0 || elapsedTime > 0);

  // Format elapsed time for toast
  const formatTime = useCallback((seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (isTypingInInput()) return;

      // Don't trigger with modifier keys (except Shift for some shortcuts)
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toLowerCase();

      switch (key) {
        case "t":
          // T - Toggle timer (start if stopped, pause if running, resume if paused)
          event.preventDefault();
          if (!isRunning && !isPaused) {
            window.dispatchEvent(new Event("timer-start-shortcut"));
            toast.success(sharedT("sharedLabels", "hooks.timerKeys.started"), {
              description: sharedT(
                "sharedLabels",
                "hooks.timerKeys.pressToPause",
              ),
            });
          } else if (isRunning && !isPaused) {
            // Pause running timer
            pauseTimer();
            toast.info(sharedT("sharedLabels", "hooks.timerKeys.paused"), {
              description: sharedT(
                "sharedLabels",
                "hooks.timerKeys.pressToResume",
                {
                  time: formatTime(elapsedTime),
                },
              ),
            });
          } else if (isPaused) {
            // Resume paused timer
            window.dispatchEvent(new Event("timer-start-shortcut"));
            toast.success(sharedT("sharedLabels", "hooks.timerKeys.resumed"), {
              description: sharedT(
                "sharedLabels",
                "hooks.timerKeys.pressToPause",
              ),
            });
          }
          break;

        case "s":
          // Shift+S - Stop and save timer
          if (event.shiftKey && isRunning) {
            event.preventDefault();
            window.dispatchEvent(new Event("timer-stop-shortcut"));
          }
          break;

        case "escape":
          // ESC - Stop timer without saving (if running with no time)
          if (isRunning && elapsedTime < 60) {
            event.preventDefault();
            resetTimer();
            toast.info(sharedT("sharedLabels", "hooks.timerKeys.cancelled"));
          }
          break;
      }
    },
    [isRunning, isPaused, pauseTimer, elapsedTime, formatTime, resetTimer],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  return null;
}
