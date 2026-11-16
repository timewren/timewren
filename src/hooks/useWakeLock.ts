"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sharedT } from "@/i18n/shared-text";

export interface WakeLockOptions {
  /**
   * Automatically request wake lock when enabled
   * Default: false
   */
  autoRequest?: boolean;

  /**
   * Show toast notifications for wake lock status
   * Default: false
   */
  showNotifications?: boolean;
}

export interface WakeLockState {
  isSupported: boolean;
  isActive: boolean;
  isRequesting: boolean;
}

/**
 * Hook for Screen Wake Lock API
 *
 * Prevents the screen from dimming or locking while the timer is running.
 * Very useful for time tracking to keep the screen active.
 *
 * Browser support: Chrome 84+, Edge 84+, Safari 16.4+
 */
export function useWakeLock(options: WakeLockOptions = {}) {
  const { autoRequest = false, showNotifications = false } = options;

  const [state, setState] = useState<WakeLockState>({
    isSupported: false,
    isActive: false,
    isRequesting: false,
  });

  // Use refs for state/lock to keep request/release callbacks stable
  const stateRef = useRef(state);
  stateRef.current = state;
  const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null);

  // Check if Wake Lock API is supported
  useEffect(() => {
    const supported = typeof window !== "undefined" && "wakeLock" in navigator;

    setState((prev) => ({ ...prev, isSupported: supported }));

    if (!supported) {
      console.log("[WakeLock] Not supported in this browser");
    }
  }, []);

  /**
   * Request wake lock
   */
  const request = useCallback(async () => {
    if (!stateRef.current.isSupported) {
      if (showNotifications) {
        toast.error(sharedT("sharedLabels", "hooks.wakeLock.unsupported"));
      }
      return false;
    }

    if (stateRef.current.isActive) {
      console.log("[WakeLock] Already active");
      return true;
    }

    setState((prev) => ({ ...prev, isRequesting: true }));

    try {
      const lock = await navigator.wakeLock.request("screen");
      wakeLockSentinelRef.current = lock;

      setState((prev) => ({
        ...prev,
        isActive: true,
        isRequesting: false,
      }));

      if (showNotifications) {
        toast.success(sharedT("sharedLabels", "hooks.wakeLock.active"), {
          description: sharedT("sharedLabels", "hooks.wakeLock.activeDesc"),
        });
      }

      console.log("[WakeLock] Acquired");

      // Listen for wake lock release (e.g., system release on tab switch)
      lock.addEventListener("release", () => {
        console.log("[WakeLock] Released");
        setState((prev) => ({ ...prev, isActive: false }));
        wakeLockSentinelRef.current = null;

        if (showNotifications) {
          toast.info(sharedT("sharedLabels", "hooks.wakeLock.released"));
        }
      });

      return true;
    } catch (error) {
      console.error("[WakeLock] Request failed:", error);

      setState((prev) => ({
        ...prev,
        isActive: false,
        isRequesting: false,
      }));

      if (showNotifications) {
        toast.error(sharedT("sharedLabels", "hooks.wakeLock.failed"), {
          description:
            error instanceof Error
              ? error.message
              : sharedT("sharedLabels", "unknownError"),
        });
      }

      return false;
    }
  }, [showNotifications]);

  /**
   * Release wake lock
   */
  const release = useCallback(async () => {
    const sentinel = wakeLockSentinelRef.current;
    if (!sentinel) {
      console.log("[WakeLock] No active wake lock to release");
      return;
    }

    try {
      await sentinel.release();
      wakeLockSentinelRef.current = null;

      setState((prev) => ({ ...prev, isActive: false }));

      console.log("[WakeLock] Released successfully");
    } catch (error) {
      console.error("[WakeLock] Release failed:", error);
    }
  }, []);

  /**
   * Toggle wake lock on/off
   */
  const toggle = useCallback(async () => {
    if (stateRef.current.isActive) {
      await release();
    } else {
      await request();
    }
  }, [request, release]);

  // Auto-request on mount if enabled
  useEffect(() => {
    if (autoRequest && state.isSupported && !state.isActive) {
      request();
    }
  }, [autoRequest, state.isSupported, state.isActive, request]);

  // Handle visibility change (re-request on page visible)
  useEffect(() => {
    if (!state.isSupported || !state.isActive) {
      return;
    }

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        !wakeLockSentinelRef.current
      ) {
        console.log("[WakeLock] Page visible, re-requesting wake lock");
        request();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [state.isSupported, state.isActive, request]);

  // Release on unmount
  useEffect(() => {
    return () => {
      wakeLockSentinelRef.current?.release().catch(console.error);
    };
  }, []);

  return {
    ...state,
    request,
    release,
    toggle,
  };
}
