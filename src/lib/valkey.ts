import Redis from "ioredis";
import { captureServerMessage } from "@/lib/utils/sentry";

// Command client used for rate-limiting and (later) caching. Realtime
// pub/sub adds dedicated publisher/subscriber connections in a separate plan.
//
// `undefined` = not yet initialized; `null` = initialized but no Valkey
// (VALKEY_URL unset or construction failed). We memoize so a missing/broken
// Valkey degrades to a single decision, never a per-call throw.
let client: Redis | null | undefined;

// Alert throttle: ioredis fires "error" repeatedly while disconnected, so we
// capture to Sentry once per down-episode and once on recovery — otherwise a
// brief Valkey outage would flood Sentry. The app keeps working either way
// (rate-limiting falls back to in-memory); these are operational alerts so we
// notice that the multi-replica shared limit has silently degraded.
let valkeyDown = false;

/** Log a Valkey connection error and alert Sentry once per down-episode. */
export function reportValkeyError(message: string): void {
  console.error("[valkey] connection error:", message);
  if (!valkeyDown) {
    valkeyDown = true;
    captureServerMessage(`Valkey connection lost: ${message}`, {
      level: "warning",
    });
  }
}

/** Note a healthy Valkey connection; alert Sentry once if we were down. */
export function reportValkeyReady(): void {
  if (valkeyDown) {
    valkeyDown = false;
    captureServerMessage("Valkey connection restored", { level: "info" });
  }
}

/** Test-only: reset the alert-throttle state. */
export function __resetValkeyAlertForTests(): void {
  valkeyDown = false;
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
