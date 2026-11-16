"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { sharedT } from "@/i18n/shared-text";

export interface PeriodicSyncOptions {
  /**
   * Tag to identify the sync task
   */
  tag: string;

  /**
   * Minimum interval between syncs in milliseconds
   * Default: 24 hours (86400000ms)
   */
  minInterval?: number;

  /**
   * Auto-register on mount
   * Default: false
   */
  autoRegister?: boolean;
}

/**
 * Hook for Periodic Background Sync API
 *
 * Allows scheduling background tasks that run periodically, even when
 * the app is closed. Perfect for weekly reports, data refresh, etc.
 *
 * Browser support: Chrome 80+, Edge 80+ (requires installed PWA)
 * Not supported: Safari, Firefox
 */
export function usePeriodicSync(options: PeriodicSyncOptions) {
  const { tag, minInterval = 86400000, autoRegister = false } = options;

  const [isSupported, setIsSupported] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  // Check if Periodic Background Sync is supported
  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PeriodicSyncManager" in window;

    setIsSupported(supported);

    if (!supported) {
      console.log("[PeriodicSync] Not supported in this browser");
    }
  }, []);

  // Check if already registered
  useEffect(() => {
    if (!isSupported) return;

    async function checkRegistration() {
      try {
        const registration = await navigator.serviceWorker.ready;

        // @ts-expect-error - periodicSync is experimental
        const tags = await registration.periodicSync.getTags();
        setIsRegistered(tags.includes(tag));

        console.log("[PeriodicSync] Registered tags:", tags);
      } catch (error) {
        console.error("[PeriodicSync] Failed to check registration:", error);
      }
    }

    checkRegistration();
  }, [isSupported, tag]);

  /**
   * Register periodic sync
   */
  const register = useCallback(async () => {
    if (!isSupported) {
      toast.error(sharedT("sharedLabels", "hooks.periodic.unsupported"));
      return false;
    }

    setIsRequesting(true);

    try {
      const registration = await navigator.serviceWorker.ready;

      // @ts-expect-error - periodicSync is experimental
      await registration.periodicSync.register(tag, {
        minInterval: minInterval,
      });

      setIsRegistered(true);
      setIsRequesting(false);

      console.log(
        `[PeriodicSync] Registered '${tag}' with interval ${minInterval}ms`,
      );

      toast.success(sharedT("sharedLabels", "hooks.periodic.enabled"), {
        description: sharedT("sharedLabels", "hooks.periodic.enabledDesc"),
      });

      return true;
    } catch (error) {
      console.error("[PeriodicSync] Registration failed:", error);
      setIsRequesting(false);

      toast.error(sharedT("sharedLabels", "hooks.periodic.enableFailed"), {
        description:
          error instanceof Error
            ? error.message
            : sharedT("sharedLabels", "unknownError"),
      });

      return false;
    }
  }, [isSupported, tag, minInterval]);

  /**
   * Unregister periodic sync
   */
  const unregister = useCallback(async () => {
    if (!isSupported) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;

      // @ts-expect-error - periodicSync is experimental
      await registration.periodicSync.unregister(tag);

      setIsRegistered(false);

      console.log(`[PeriodicSync] Unregistered '${tag}'`);

      toast.success(sharedT("sharedLabels", "hooks.periodic.disabled"));

      return true;
    } catch (error) {
      console.error("[PeriodicSync] Unregistration failed:", error);

      toast.error(sharedT("sharedLabels", "hooks.periodic.disableFailed"));

      return false;
    }
  }, [isSupported, tag]);

  /**
   * Toggle registration
   */
  const toggle = useCallback(async () => {
    if (isRegistered) {
      return unregister();
    } else {
      return register();
    }
  }, [isRegistered, register, unregister]);

  // Auto-register on mount if enabled
  useEffect(() => {
    if (autoRegister && isSupported && !isRegistered && !isRequesting) {
      register();
    }
  }, [autoRegister, isSupported, isRegistered, isRequesting, register]);

  return {
    isSupported,
    isRegistered,
    isRequesting,
    register,
    unregister,
    toggle,
  };
}
