"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { showUpdatePrompt } from "@/lib/pwa/update-prompt";
import {
  BUILD_VERSION,
  isNewDeployment,
  VERSION_ENDPOINT,
} from "@/lib/pwa/version";

const SW_UPDATE_INTERVAL_MS = 60 * 60_000;
const VERSION_POLL_INTERVAL_MS = 5 * 60_000;

/** Service workeren fornyer offline-siden, når appens version skifter. */
function tellServiceWorker(version: string) {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready
    .then((reg) => reg.active?.postMessage({ type: "APP_VERSION", version }))
    .catch(() => {});
}

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch(VERSION_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * PWA Registration Component
 *
 * Registrerer service workeren, viser online/offline-status og opdager nye
 * deploys: både en ny `sw.js` og en ny app-version (`/api/version`), da et
 * almindeligt deploy ikke ændrer `sw.js`. Monteres i dashboard-skallen.
 */
export function PWARegistration() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("shell.pwa");
  const tRef = useRef(t);
  tRef.current = t;
  // Service worker + online/offline-toasts.
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let updateInterval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    navigator.serviceWorker
      .register(
        // TimeWren giver service workeren brandet med; TimeTrack beholder sin URL.
        brand.id === "timetrack" ? "/sw.js" : `/sw.js?brand=${brand.id}`,
        { scope: "/" },
      )
      .then((reg) => {
        if (cancelled) return;
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              showUpdatePrompt();
            }
          });
        });
        updateInterval = setInterval(() => {
          void reg.update().catch(() => {});
        }, SW_UPDATE_INTERVAL_MS);
      })
      .catch((error) => {
        console.error("[PWA] Service worker registration failed:", error);
      });

    // Offline vises af OfflineBanner, så længe nettet er væk; her kun en
    // kort besked, når det er tilbage.
    const handleOnline = () => {
      toast.success(tRef.current("backOnline"));
    };

    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      if (updateInterval) clearInterval(updateInterval);
    };
  }, [brand.id]);

  // Ny deployment: sammenlign serverens version med bundtets egen (bagt ind
  // ved build); uden bagt version bruges den første, fanen ser.
  useEffect(() => {
    let baseline: string | null = BUILD_VERSION;
    let prompted = false;
    if (baseline) tellServiceWorker(baseline);

    const check = async () => {
      if (prompted || navigator.onLine === false) return;
      // Baseline hentes med det samme; senere tjek kun når fanen ses.
      if (baseline && document.visibilityState !== "visible") return;
      const current = await fetchVersion();
      if (!current) return;
      if (!baseline) {
        baseline = current;
        tellServiceWorker(current);
        return;
      }
      if (isNewDeployment(baseline, current)) {
        prompted = true;
        showUpdatePrompt();
      }
    };

    void check();
    const interval = setInterval(() => void check(), VERSION_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, []);

  return null;
}
