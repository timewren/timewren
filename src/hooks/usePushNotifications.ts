"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { sharedT } from "@/i18n/shared-text";

/**
 * Hook for managing push notification subscriptions
 *
 * Provides functions to subscribe, unsubscribe, and check permission status
 */
export function usePushNotifications() {
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const checkSubscription = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (error) {
      console.error("[Push] Failed to check subscription:", error);
    }
  }, []);

  useEffect(() => {
    // Check if push notifications are supported
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator
    ) {
      setIsSupported(true);
      setPermission(Notification.permission);

      // Check if already subscribed
      checkSubscription();
    }
  }, [
    // Check if already subscribed
    checkSubscription,
  ]);

  async function subscribe() {
    if (!isSupported) {
      toast.error(sharedT("sharedLabels", "hooks.push.unsupported"));
      return false;
    }

    setIsLoading(true);

    try {
      // Request permission
      const permission = await Notification.requestPermission();
      setPermission(permission);

      if (permission !== "granted") {
        toast.error(sharedT("sharedLabels", "hooks.push.denied"));
        setIsLoading(false);
        return false;
      }

      // Get VAPID public key from server
      const keyResponse = await fetch("/api/push/public-key");
      if (!keyResponse.ok) {
        throw new Error("Failed to get VAPID key");
      }

      let data: { publicKey?: unknown };
      try {
        data = await keyResponse.json();
      } catch (_error) {
        throw new Error("Invalid JSON response from /api/push/public-key");
      }

      const { publicKey } = data;

      if (typeof publicKey !== "string" || publicKey.trim() === "") {
        throw new Error(
          "Invalid VAPID publicKey in /api/push/public-key response",
        );
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push notifications
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Send subscription to server
      const subscribeResponse = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });

      if (!subscribeResponse.ok) {
        throw new Error("Failed to save subscription");
      }

      setIsSubscribed(true);
      toast.success(sharedT("sharedLabels", "hooks.push.enabled"), {
        description: sharedT("sharedLabels", "hooks.push.enabledDesc"),
      });

      setIsLoading(false);
      return true;
    } catch (error) {
      console.error("[Push] Subscribe failed:", error);
      toast.error(sharedT("sharedLabels", "hooks.push.enableFailed"), {
        description:
          error instanceof Error
            ? error.message
            : sharedT("sharedLabels", "unknownError"),
      });
      setIsLoading(false);
      return false;
    }
  }

  async function unsubscribe() {
    if (!isSupported) {
      return false;
    }

    setIsLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        setIsSubscribed(false);
        setIsLoading(false);
        return true;
      }

      // Remove from server first
      const unsubscribeResponse = await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

      if (!unsubscribeResponse.ok) {
        const errorData = await unsubscribeResponse.json().catch(() => ({}));
        throw new Error(
          errorData.error || "Failed to remove subscription from server",
        );
      }

      // Unsubscribe from browser only after server success
      await subscription.unsubscribe();

      setIsSubscribed(false);
      toast.success(sharedT("sharedLabels", "hooks.push.disabled"));

      setIsLoading(false);
      return true;
    } catch (error) {
      console.error("[Push] Unsubscribe failed:", error);
      toast.error(sharedT("sharedLabels", "hooks.push.disableFailed"));
      setIsLoading(false);
      return false;
    }
  }

  return {
    permission,
    isSupported,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
  };
}

/**
 * Convert URL-safe base64 string to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray.buffer as ArrayBuffer;
}
