import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTimerStore } from "@/stores/timerStore";

/**
 * Global in-app keyboard shortcuts.
 * These only work when the app window is focused (not system-wide).
 *
 * Shortcuts:
 * - Ctrl+N: Emit "open-time-entry-form" custom event
 * - Ctrl+Shift+T / Ctrl+Shift+S: start / stop the timer
 * - Ctrl+,: Navigate to /settings
 * - Ctrl+1-6: Navigate to main pages
 * - Escape: Close active dialog (handled by Dialog component)
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isCtrl = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;

      // Don't capture shortcuts when typing in inputs/textareas
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      if (!isCtrl) return;

      // The command palette advertises Ctrl+Shift+T / Ctrl+Shift+S, so they
      // have to do what it says. Each direction is guarded on the timer state,
      // exactly like the palette entry: start() with no arguments while a timer
      // is already running would silently bill a second entry.
      if (e.shiftKey) {
        if (e.key === "t" || e.key === "T") {
          if (useTimerStore.getState().isRunning) return;
          e.preventDefault();
          useTimerStore
            .getState()
            .start()
            .catch(() => {});
          return;
        }
        if (e.key === "s" || e.key === "S") {
          if (!useTimerStore.getState().isRunning) return;
          e.preventDefault();
          useTimerStore
            .getState()
            .stop()
            .catch(() => {});
          return;
        }
      }

      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("open-time-entry-form"));
          break;
        case ",":
          e.preventDefault();
          navigate({ to: "/settings" });
          break;
        case "1":
          e.preventDefault();
          navigate({ to: "/" });
          break;
        case "2":
          e.preventDefault();
          navigate({ to: "/calendar" });
          break;
        case "3":
          e.preventDefault();
          navigate({ to: "/timeline" });
          break;
        case "4":
          e.preventDefault();
          navigate({ to: "/projects" });
          break;
        case "5":
          e.preventDefault();
          navigate({ to: "/klippekort" });
          break;
        case "6":
          e.preventDefault();
          navigate({ to: "/invoices" });
          break;
        // case "7": reserved for /reports (not yet implemented)
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);
}
