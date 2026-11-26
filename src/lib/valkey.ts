import Redis from "ioredis";
import { captureServerMessage } from "@/lib/utils/sentry";

// Command client used for rate-limiting and (later) caching. Realtime
// pub/sub adds dedicated publisher/subscriber connections in a separate plan.
//
// `undefined` = not yet initialized; `null` = initialized but no Valkey
// (VALKEY_URL unset or construction failed). We memoize so a missing/broken
// Valkey degrades to a single decision, never a per-call throw.
let client: Redis | null | undefined;

// Alert throttle: ioredis fires "error" on every failed reconnect attempt
// (retryStrategy backs off up to 2 s), so a single outage produces many
// errors. A short blip, e.g. one failed DNS lookup in the Docker network
// (Sentry TIMETRACK-2B, getaddrinfo ENOTFOUND), heals on the next retry and is
// not worth an alert: callers already fall back (in-memory rate limit, no
// cache, polling). We therefore log the first error of an episode, and only
// alert Sentry when the connection is still down after
// VALKEY_ALERT_GRACE_MS. Recovery is reported only if we alerted.
export const VALKEY_ALERT_GRACE_MS = 60_000;

/** Start of the current down-episode (ms epoch), or null while healthy. */
let downSince: number | null = null;
/** Whether Sentry has been told about the current episode. */
let alerted = false;

/** Log a Valkey connection error; alert Sentry only if the outage persists. */
export function reportValkeyError(message: string, now = Date.now()): void {
  if (downSince === null) {
    downSince = now;
    console.error("[valkey] connection error, retrying:", message);
    return;
  }
  if (!alerted && now - downSince >= VALKEY_ALERT_GRACE_MS) {
    alerted = true;
    const seconds = Math.round((now - downSince) / 1000);
    console.error(`[valkey] still down after ${seconds} s:`, message);
    captureServerMessage(`Valkey connection lost: ${message}`, {
      level: "warning",
    });
  }
}

/** Note a healthy Valkey connection; alert Sentry once if we had alerted. */
export function reportValkeyReady(): void {
  const wasAlerted = alerted;
  downSince = null;
  alerted = false;
  if (wasAlerted) {
    captureServerMessage("Valkey connection restored", { level: "info" });
  }
}

/** Test-only: reset the alert-throttle state. */
export function __resetValkeyAlertForTests(): void {
  downSince = null;
  alerted = false;
}

export function getValkey(): Redis | null {
  if (client !== undefined) return client;

  const url = process.env.VALKEY_URL;
  if (!url) {
    client = null;
    return client;
  }

  try {
    const redis = new Redis(url, {
      // Best-effort: never queue commands while offline, fail fast so callers
      // can fall back instead of hanging a request.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      // ioredis 6 bruger RESP3 som standard; behold RESP2 som i v5.
      protocol: 2,
    });
    redis.on("error", (err: Error) => {
      // Never throw from the error handler — Valkey is best-effort.
      reportValkeyError(err.message);
    });
    redis.on("ready", () => {
      reportValkeyReady();
    });
    client = redis;
  } catch (err) {
    console.error("[valkey] init failed:", err);
    client = null;
  }
  return client;
}

/**
 * Klienten, men kun når forbindelsen er klar. getValkey() opretter klienten
 * dovent, og med enableOfflineQueue: false afvises kommandoer før "ready"
 * ("Stream isn't writeable"). Kaldere, der har en reserve (in-memory,
 * ingen cache, polling), bruger denne og springer Valkey stille over,
 * indtil forbindelsen er oppe, i stedet for at logge en fejl ved hver
 * opstart.
 */
export function getReadyValkey(): Redis | null {
  const client = getValkey();
  return client?.status === "ready" ? client : null;
}

/** Test-only: reset the memoized client so env changes take effect. */
export function __resetValkeyForTests(): void {
  if (client) {
    void client.quit().catch(() => {});
  }
  client = undefined;
}
