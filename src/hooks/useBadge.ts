"use client";

import { useCallback, useEffect, useState } from "react";

export interface BadgeOptions {
  /**
   * Initial badge count
   * Default: 0
   */
  initialCount?: number;
}

/**
 * Hook for Badging API
 *
 * Sets a badge on the app icon showing a count (e.g., unread notifications).
 * Only works when the app is installed as a PWA.
 *
 * Browser support: Chrome 81+, Edge 81+ (Desktop only)
 * Not supported: Safari, Firefox, Mobile browsers
 */
export function useBadge(options: BadgeOptions = {}) {
  const { initialCount = 0 } = options;

  const [count, setCount] = useState(initialCount);
  const [isSupported, setIsSupported] = useState(false);

  // Check if Badging API is supported
  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "setAppBadge" in navigator &&
      "clearAppBadge" in navigator;

    setIsSupported(supported);

    if (!supported) {
      console.log("[Badge] Badging API not supported in this browser");
    }
  }, []);

  /**
   * Set badge count
   */
  const setBadge = useCallback(
    async (newCount: number) => {
      if (!isSupported) {
        console.log("[Badge] Not supported, skipping");
        return false;
      }

      try {
        if (newCount > 0) {
          await navigator.setAppBadge(newCount);
          setCount(newCount);
          console.log("[Badge] Set to", newCount);
        } else {
          await navigator.clearAppBadge();
          setCount(0);
          console.log("[Badge] Cleared");
        }
        return true;
      } catch (error) {
        console.error("[Badge] Failed to set:", error);
        return false;
      }
    },
    [isSupported],
  );

  /**
   * Clear badge
   */
  const clearBadge = useCallback(async () => {
    if (!isSupported) {
      return false;
    }

    try {
      await navigator.clearAppBadge();
      setCount(0);
      console.log("[Badge] Cleared");
      return true;
    } catch (error) {
      console.error("[Badge] Failed to clear:", error);
      return false;
    }
  }, [isSupported]);

  /**
   * Increment badge count
   */
  const incrementBadge = useCallback(
    async (amount = 1) => {
      const newCount = count + amount;
      return setBadge(newCount);
    },
    [count, setBadge],
  );

  /**
   * Decrement badge count
   */
  const decrementBadge = useCallback(
    async (amount = 1) => {
      const newCount = Math.max(0, count - amount);
      return setBadge(newCount);
    },
    [count, setBadge],
  );

  // Set initial badge
  useEffect(() => {
    if (isSupported && initialCount > 0) {
      setBadge(initialCount);
    }
  }, [isSupported, initialCount, setBadge]);

  // Clear badge on unmount
  useEffect(() => {
    return () => {
      if (isSupported) {
        navigator.clearAppBadge().catch(console.error);
      }
    };
  }, [isSupported]);

  return {
    count,
    isSupported,
    setBadge,
    clearBadge,
    incrementBadge,
    decrementBadge,
  };
}
