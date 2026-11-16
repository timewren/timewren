"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface IdleDetectionOptions {
  /**
   * Threshold in milliseconds after which the user is considered idle
   * Default: 5 minutes (300000ms)
   */
  threshold?: number;

  /**
   * Callback when user becomes idle
   */
  onIdle?: () => void;

  /**
   * Callback when user becomes active again
   */
  onActive?: () => void;

  /**
   * Enable idle detection
   * Default: false
   */
  enabled?: boolean;
}

export interface IdleDetectionState {
  isIdle: boolean;
  isSupported: boolean;
  lastActivityTime: number | null;
  idleTime: number; // milliseconds idle
}

/**
 * Hook for detecting user idleness
 *
 * Uses a combination of event listeners and the Idle Detection API (when available)
 * to determine if the user is idle.
 *
 * Fallback: Event-based detection for browsers without Idle Detection API
 */
// IdleDetector er eksperimentel og mangler i lib.dom
interface IdleDetectorLike {
  userState: string;
  screenState: string;
  addEventListener: (type: "change", listener: () => void) => void;
  start: (options: { threshold: number; signal: AbortSignal }) => Promise<void>;
}

export function useIdleDetection(options: IdleDetectionOptions = {}) {
  const {
    threshold = 300000, // 5 minutes default
    onIdle,
    onActive,
    enabled = false,
  } = options;

  const [state, setState] = useState<IdleDetectionState>({
    isIdle: false,
    isSupported: false,
    lastActivityTime: Date.now(),
    idleTime: 0,
  });

  // Use refs for callbacks to keep setIdle/resetIdle stable
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  // Check if Idle Detection API is supported
  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "IdleDetector" in window &&
      "permissions" in navigator;

    setState((prev) => ({ ...prev, isSupported: supported }));
  }, []);

  // Reset idle state
  const resetIdle = useCallback(() => {
    setState((prev) => {
      if (prev.isIdle) {
        onActiveRef.current?.();
      }
      return {
        ...prev,
        isIdle: false,
        lastActivityTime: Date.now(),
        idleTime: 0,
      };
    });
  }, []);

  // Set idle state
  const setIdle = useCallback(() => {
    setState((prev) => {
      if (!prev.isIdle) {
        onIdleRef.current?.();
      }
      return {
        ...prev,
        isIdle: true,
        idleTime: Date.now() - (prev.lastActivityTime || Date.now()),
      };
    });
  }, []);

  // Idle Detection API (Chrome/Edge)
  useEffect(() => {
    if (!enabled || !state.isSupported) {
      return;
    }

    let abortController: AbortController | null = null;

    async function startIdleDetection() {
      try {
        // Request permission
        const permissionStatus = await navigator.permissions.query({
          name: "idle-detection" as PermissionName,
        });

        // Kun "granted" giver en brugbar IdleDetector. Ved "denied" OG
        // "prompt" (hvor start() kaster uden brugergestus) skal vi melde
        // isSupported:false, så event-fallbacken — den med visibility-guard —
        // overtager. Ellers er der INGEN idle-detektion i Chromium (#588 R2).
        if (permissionStatus.state !== "granted") {
          console.warn(
            "[IdleDetection] Permission not granted:",
            permissionStatus.state,
          );
          setState((prev) => ({ ...prev, isSupported: false }));
          return;
        }

        // @ts-expect-error - IdleDetector is experimental
        const detector: IdleDetectorLike = new IdleDetector();
        abortController = new AbortController();

        detector.addEventListener("change", () => {
          const userState = detector.userState;
          const screenState = detector.screenState;

          console.log("[IdleDetection]", { userState, screenState });

          // Skærmlås ("locked") er IKKE i sig selv inaktivitet: den fyrer
          // øjeblikkeligt ved Win+L / Mac-lås, uafhængigt af tærsklen. Kun
          // userState === "idle" (som HAR ventet tærsklen ud) tæller.
          if (userState === "idle") {
            setIdle();
          } else {
            resetIdle();
          }
        });

        await detector.start({
          threshold: threshold,
          signal: abortController.signal,
        });

        console.log("[IdleDetection] Started with threshold:", threshold);
      } catch (error) {
        console.error("[IdleDetection] Failed to start:", error);
        setState((prev) => ({ ...prev, isSupported: false }));
      }
    }

    startIdleDetection();

    return () => {
      if (abortController) {
        abortController.abort();
      }
    };
  }, [enabled, state.isSupported, threshold, setIdle, resetIdle]);

  // Fallback: Event-based idle detection
  useEffect(() => {
    if (!enabled || state.isSupported) {
      // Don't use fallback if native API is supported
      return;
    }

    const events = [
      "mousedown",
      "mousemove",
      "keypress",
      "scroll",
      "touchstart",
      "click",
    ];

    let idleTimer: NodeJS.Timeout;

    const handleActivity = () => {
      resetIdle();

      // Clear existing timer
      if (idleTimer) {
        clearTimeout(idleTimer);
      }

      // Set new timer
      idleTimer = setTimeout(() => {
        // Denne fallback ser kun aktivitet i DENNE fane. Er fanen skjult
        // (brugeren arbejder i et andet program/en anden fane), ved vi ikke
        // om brugeren er inaktiv — og en pause her sås som "timeren stopper
        // af sig selv" kort efter start. Vent til fanen er synlig igen;
        // systemdækkende inaktivitet håndteres af extensionen (chrome.idle).
        if (document.visibilityState === "hidden") {
          handleActivity();
          return;
        }
        setIdle();
      }, threshold);
    };

    // Add event listeners
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", handleActivity);

    // Start initial timer
    handleActivity();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      document.removeEventListener("visibilitychange", handleActivity);
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
    };
  }, [enabled, state.isSupported, threshold, setIdle, resetIdle]);

  // Update idle time counter
  useEffect(() => {
    if (!state.isIdle || !state.lastActivityTime) {
      return;
    }

    const interval = setInterval(() => {
      setState((prev) => ({
        ...prev,
        idleTime: Date.now() - (prev.lastActivityTime || Date.now()),
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [state.isIdle, state.lastActivityTime]);

  return {
    ...state,
    resetIdle,
    setIdle,
  };
}
