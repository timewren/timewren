import { useEffect, useState } from "react";
// Samme grund som i `pomodoroStore`: uden denne import kan `i18n.t` svare en
// rå nøgle, hvis hooken nås fra en test eller et tidligt kald.
import i18n from "@/lib/i18n";

/**
 * Hook that tracks whether the app has internet connectivity.
 * Uses the browser's navigator.onLine and online/offline events.
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Checks if an error is likely a network connectivity error.
 * Works with both Tauri invoke errors (strings) and fetch errors.
 *
 * Indikatorerne er ikke gæt: Rust sender `error.connectionError` som
 * "{udbyder} forbindelsesfejl: {reqwest-fejl}", og en reqwest-fejl for en
 * DNS- eller forbindelsesfejl indeholder "tcp connect error" eller "dns
 * error". Uden de to ville en bruger uden internet se hele den streng.
 */
export function isNetworkError(error: unknown): boolean {
  const msg = typeof error === "string" ? error : String(error);

  // Rust skelner selv mellem "der er ikke internet" og "svaret tog for lang
  // tid" (`error.ollamaTimeoutTrySmaller`), og den sidste siger noget
  // handlingbart — "prøv en mindre model". Den skal ikke erstattes af
  // "prøv igen senere". Kendetegnet er vores egen em-dash-sætning.
  if (/timeout\s*\u2014/.test(msg)) return false;

  const networkIndicators = [
    "network",
    "fetch",
    "connection",
    "connect error",
    "timeout",
    "dns",
    "ENOTFOUND",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "offline",
    "net::ERR_",
    "Failed to fetch",
    "Could not connect",
    "Ingen internetforbindelse",
    "forbindelsesfejl",
    "reqwest",
    // reqwest's egen præfiks. Det er det eneste altid-engelske ankermærke i
    // kæden, så det er værd at have selv om de andre dækker de fleste.
    "error sending request",
  ];
  const lower = msg.toLowerCase();
  return networkIndicators.some((indicator) =>
    lower.includes(indicator.toLowerCase()),
  );
}

/**
 * Sætningen brugeren skal se, når et kald fejler af netværgsårsager.
 *
 * Nøglerne lå i alle fem sprog, siden de oprindeligt blev skrevet, men
 * funktionen havde ingen kaldersteder — så det, brugeren faktisk mødte, var
 * Rust's rå fejlstreng. Nu kalder AI-testknappen, den manuelle klassificering
 * og synk'en her, så de får appens sprog.
 */
export function getOfflineMessage(context: string): string {
  switch (context) {
    case "ai":
      return i18n.t("errors.aiOffline");
    case "sync":
      return i18n.t("errors.syncOffline");
    case "billy":
      return i18n.t("errors.billyOffline");
    case "license":
      return i18n.t("errors.licenseOffline");
    default:
      return i18n.t("errors.offline");
  }
}
