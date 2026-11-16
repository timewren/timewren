// ElectricSQL live timer sync for the MV3 service worker (issue #260, Fase 2).
//
// The extension polls the timer every 30s via a tRPC alarm. Electric layers a
// near-instant path on top: it streams changes to the user's own timer_states
// row (from the web app, another device, or the desktop app) and, on a change,
// runs the SAME sync the alarm does — the authoritative state is still fetched
// via tRPC; Electric is just a fast invalidation signal.
//
// MV3 lifecycle: a live shape is a long-poll that keeps the worker alive while
// streaming; if the worker is nonetheless killed, we resume from the last
// {offset, handle} persisted in chrome.storage so Electric replays only what we
// missed (its core MV3-friendly property). On `must-refetch` (Electric
// compacted its log) we drop the cursor so the next start does a fresh sync.
//
// Fully additive: the sync alarm remains the reliable baseline. If Electric is
// disabled (the proxy answers 503, as on prod without ELECTRIC_URL) the stream
// is not started again for an hour. Other failures stop it after a few
// retries; the next sync alarm starts it again. Stopping aborts the long-poll.

import {
  BackoffDefaults,
  isChangeMessage,
  isControlMessage,
  type Offset,
  ShapeStream,
} from "@electric-sql/client";
import { resolveWebAppUrl } from "../config";
import { serverFetch } from "../server-connection";

const OFFSET_KEY = "electricTimerOffset";
const HANDLE_KEY = "electricTimerHandle";
/** Electric er slået fra på serveren (503): prøv ikke igen før dette tidspunkt. */
export const DISABLED_UNTIL_KEY = "electricDisabledUntil";
const DISABLED_FOR_MS = 60 * 60 * 1000;
/** Få forsøg pr. start; næste sync-alarm starter strømmen igen. */
const MAX_RETRIES = 3;

let stream: ShapeStream<Record<string, unknown>> | null = null;
let unsubscribe: (() => void) | null = null;
let controller: AbortController | null = null;
let starting = false;

async function clearCursor(): Promise<void> {
  await chrome.storage.local.remove([OFFSET_KEY, HANDLE_KEY]);
}

/**
 * Start streaming the extension's own timer shape. Idempotent — a second call
 * while already running is a no-op. `onChange` runs after a batch that carried
 * an actual row change and reached up-to-date (so a burst collapses to one
 * sync). Resumes from the persisted cursor if present.
 */
export async function startElectricTimer(
  token: string,
  onChange: () => void,
): Promise<void> {
  if (stream || starting) return;
  starting = true;
  try {
    await openStream(token, onChange);
  } finally {
    starting = false;
  }
}

async function openStream(token: string, onChange: () => void) {
  const stored = await chrome.storage.local.get([
    OFFSET_KEY,
    HANDLE_KEY,
    DISABLED_UNTIL_KEY,
  ]);
  const disabledUntil = stored[DISABLED_UNTIL_KEY];
  if (typeof disabledUntil === "number" && disabledUntil > Date.now()) return;

  const webAppUrl = await resolveWebAppUrl();
  const savedOffset = stored[OFFSET_KEY];
  const savedHandle = stored[HANDLE_KEY];

  const abort = new AbortController();
  let answered = false;
  // Svarer serveren 503 på første forsøg, er Electric slået fra: stop med det
  // samme i stedet for at prøve igen, og vent en time før næste start.
  const fetchClient: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const response = await serverFetch(url, init ?? {}, token);
    if (!answered && response.status === 503) {
      await chrome.storage.local
        .set({ [DISABLED_UNTIL_KEY]: Date.now() + DISABLED_FOR_MS })
        .catch(() => {});
      if (controller === abort) stopElectricTimer();
    }
    answered = true;
    return response;
  };

  try {
    stream = new ShapeStream<Record<string, unknown>>({
      url: `${webAppUrl}/api/shapes/ext/timer`,
      headers: { "x-extension-token": token },
      // `table` is stripped by the proxy (it fixes it server-side); passed only
      // to satisfy the client's required shape params.
      params: { table: "timer_states" },
      // Resume across service-worker restarts.
      offset:
        typeof savedOffset === "string" ? (savedOffset as Offset) : undefined,
      handle: typeof savedHandle === "string" ? savedHandle : undefined,
      signal: abort.signal,
      fetchClient,
      backoffOptions: { ...BackoffDefaults, maxRetries: MAX_RETRIES },
    });
    controller = abort;
  } catch {
    stream = null;
    return;
  }

  const currentStream = stream;
  let sawChange = false;

  unsubscribe = currentStream.subscribe(
    async (messages) => {
      for (const message of messages) {
        if (isChangeMessage(message)) {
          sawChange = true;
        } else if (
          isControlMessage(message) &&
          message.headers.control === "must-refetch"
        ) {
          // Electric compacted its log — our cursor is stale. Drop it so the
          // next start re-syncs from scratch.
          await clearCursor();
        }
      }

      // Persist the resume cursor for the next worker wake.
      try {
        await chrome.storage.local.set({
          [OFFSET_KEY]: currentStream.lastOffset,
          [HANDLE_KEY]: currentStream.shapeHandle,
        });
      } catch {
        // Storage quota/unavailable — resume just falls back to a full sync.
      }

      if (sawChange && currentStream.isUpToDate) {
        sawChange = false;
        onChange();
      }
    },
    () => {
      // Stream error (Electric disabled/unreachable) — stay silent; the sync
      // alarm carries the sync and starts the stream again later.
      if (stream === currentStream) stopElectricTimer();
    },
  );
}

/**
 * Stop the stream (e.g. on logout) and abort the in-flight long-poll. Keeps
 * the persisted cursor for resume.
 */
export function stopElectricTimer(): void {
  try {
    unsubscribe?.();
  } catch {
    // ignore
  }
  controller?.abort();
  controller = null;
  unsubscribe = null;
  stream = null;
}

/** Stop and forget the resume cursor (full reset, e.g. on logout). */
export async function resetElectricTimer(): Promise<void> {
  stopElectricTimer();
  await clearCursor();
}
