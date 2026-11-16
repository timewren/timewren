import { createRouter, RouterProvider } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import React from "react";
import ReactDOM from "react-dom/client";
import { trackEvent } from "./lib/analytics";
import i18n from "./lib/i18n";
import {
  type KlippekortAdvarsel,
  klippekortAdvarselNiveau,
  klippekortAdvarselTekst,
} from "./lib/klippekortAdvarsel";
import { initSentry } from "./lib/sentry";
import { tauriInvoke } from "./lib/tauri";
import { routeTree } from "./routeTree.gen";
import { useSyncStore } from "./stores/syncStore";
import { useTimerStore } from "./stores/timerStore";
import { useToastStore } from "./stores/toastStore";
import "./styles/globals.css";

// Initialize Sentry before React render
initSentry();

// Track app launch (anonymous, respects user consent)
trackEvent("app_launched");

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Apply persisted theme immediately to avoid flash of wrong theme.
// Zustand rehydration is async, so we read localStorage directly here.
try {
  const stored = localStorage.getItem("timetrack-settings");
  const theme = stored ? JSON.parse(stored)?.state?.theme : null;
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else if (theme === "system") {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.classList.add("dark");
    }
  }
  // "light" or missing: no dark class needed (CSS defaults to light)
} catch {
  // Corrupted localStorage — CSS defaults to light, rehydration will fix it
}

// Restore running timer from backend on app startup
useTimerStore.getState().loadRunning();

// Load sync status and start auto-sync
const syncStore = useSyncStore.getState();
syncStore.loadStatus().then(() => {
  // Auto-sync every 5 minutes when logged in
  setInterval(
    () => {
      const state = useSyncStore.getState();
      if (state.isLoggedIn && !state.isSyncing) {
        state.syncNow();
      }
    },
    5 * 60 * 1000,
  );

  // Sync on window focus
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const state = useSyncStore.getState();
      if (state.isLoggedIn && !state.isSyncing) {
        state.syncNow();
      }
    }
  });
});

// Global deep link listener — handles auth callbacks even when the
// settings page is not mounted. The syncStore.connect() also registers
// its own listener, but this one ensures we never miss a callback.
listen<{
  token: string;
  orgId: string | null;
  email: string | null;
  name: string | null;
  tier: string | null;
}>("deep-link-callback", async (event) => {
  const { token, orgId, email, name, tier } = event.payload;
  const state = useSyncStore.getState();

  // Only handle if not already logged in (avoid double-processing
  // if the syncStore listener already handled it)
  if (state.isLoggedIn) return;

  try {
    await tauriInvoke("sync_handle_callback", {
      token,
      orgId: orgId ?? null,
      email: email ?? null,
      name: name ?? null,
      tier: tier ?? null,
    });
    // Reload status to reflect the new login
    await useSyncStore.getState().loadStatus();
    // Trigger a full sync
    useSyncStore.getState().syncFull();
  } catch (err) {
    console.error("Deep link callback handling failed:", err);
  }
});

// Listen for review reminder notification — navigate to timeline
listen("navigate-to-timeline", () => {
  router.navigate({ to: "/timeline" });
});

// Listen for klippekort warnings from auto-deduction.
//
// Rust sender *tal* (`used`, `total`), ikke en sætning: sproget og
// talformateringen hører hjemme her, fordi det er her både sprogvalget og
// `Intl` findes. Den gamle vej formede beskeden i Rust med `format!("{:.1}t")`,
// så en tysk bruger læste dansk med et decimapunkt — «29.5t / 30t».
listen<KlippekortAdvarsel>("klippekort-warning", (event) => {
  const { addToast } = useToastStore.getState();
  addToast(
    klippekortAdvarselTekst(event.payload),
    klippekortAdvarselNiveau(event.payload.type),
  );
});

// Listen for background AI auto-classification results
listen<{ count: number }>("activities-classified", (event) => {
  const { count } = event.payload;
  if (count > 0) {
    const { addToast } = useToastStore.getState();
    addToast(i18n.t("timeline.aiAutoClassified", { count }), "info");
  }
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error('Root-elementet "#root" mangler i index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
