import * as Sentry from "@sentry/react";
import { tauriInvoke } from "./tauri";

// Tracks whether Sentry was actually initialised (DSN present + not opted out),
// so feedback can tell the user when reporting is disabled instead of silently
// dropping their message.
let sentryActive = false;

/**
 * The user's choice, read straight from storage.
 *
 * Read directly rather than from the store because `initSentry()` runs in
 * main.tsx *before* React renders, and rehydration is async — the store would
 * still say "on" for a user who switched it off.
 */
function isErrorReportingEnabled(): boolean {
  const stored = localStorage.getItem("timetrack-settings");
  if (!stored) return true; // No choice made yet — same default as the store
  try {
    const settings = JSON.parse(stored);
    return settings?.state?.sentryEnabled !== false;
  } catch {
    // Corrupted settings — default to enabled
    return true;
  }
}

export function initSentry() {
  // Rust has its own Sentry client for database errors, and it can't see
  // localStorage. Tell it the choice both at startup and on every toggle, or
  // a user who switched reporting off still gets their write errors sent.
  const enabled = isErrorReportingEnabled();
  tauriInvoke("set_error_reporting", { enabled }).catch(() => {
    // Before the Rust side exists (dev without the backend) — not critical
  });

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || !enabled) return; // Graceful — works without Sentry

  Sentry.init({
    dsn,
    environment: "production",
    // No PII
    sendDefaultPii: false,
    // No performance tracking
    tracesSampleRate: 0,
    // No session replay
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Strip user data
    beforeSend(event) {
      delete event.user;
      return event;
    },
  });
  sentryActive = true;
}

/** Whether error/feedback reporting is currently active. */
export function isSentryActive(): boolean {
  return sentryActive;
}

/**
 * Sends a user feedback report ("report a bug or missing feature") to Sentry.
 * Returns false if reporting is disabled, so the UI can inform the user.
 * A Sentry alert rule can forward these to email automatically.
 */
export function sendFeedback(input: {
  category: string;
  message: string;
  email?: string;
}): boolean {
  if (!sentryActive) return false;
  const email = input.email?.trim();
  Sentry.captureFeedback({
    message: `[${input.category}] ${input.message}\n\n— ${navigator.userAgent}`,
    email: email || undefined,
  });
  return true;
}

/** Report a caught error to Sentry with optional context tags. */
export function captureError(
  error: unknown,
  context?: { feature?: string; action?: string },
) {
  const err = error instanceof Error ? error : new Error(String(error));
  Sentry.captureException(err, {
    tags: {
      feature: context?.feature ?? "unknown",
      action: context?.action,
    },
  });
}

/** Shut down Sentry (used when user disables error reporting at runtime) */
export async function closeSentry() {
  sentryActive = false;
  tauriInvoke("set_error_reporting", { enabled: false }).catch(() => {
    // See initSentry
  });
  await Sentry.close();
}
