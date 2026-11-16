import { getReadyValkey, getValkey } from "@/lib/valkey";

/**
 * Thin read-through cache on Valkey.
 *
 * `cached(key, ttlSeconds, fn)` returns a cached value if present, otherwise
 * runs `fn`, stores its result with a TTL, and returns it. Intended for a few
 * genuinely expensive/external reads (CVR lookups, Plausible analytics) — not
 * broad query caching.
 *
 * Degrades gracefully: if Valkey is unavailable or errors, it simply runs `fn`
 * every time (no caching), never throwing. `null`/`undefined` results are not
 * cached, so a miss and a cached-empty are never confused.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const client = getReadyValkey();
  const redisKey = `cache:${key}`;

  if (client) {
    try {
      const hit = await client.get(redisKey);
      if (hit !== null) {
        return JSON.parse(hit) as T;
      }
    } catch (err) {
      console.error("[cache] read error:", err);
      // fall through to fn
    }
  }

  const value = await fn();

  if (client && value !== null && value !== undefined) {
    try {
      await client.set(redisKey, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      console.error("[cache] write error:", err);
    }
  }

  return value;
}

/**
 * Fjern en nøgle fra `cached` — kaldes efter en skrivning, så næste læsning
 * henter frisk. Fejler aldrig; uden Valkey er der intet at rydde.
 */
export async function invalidateCached(key: string): Promise<void> {
  const client = getValkey();
  if (!client) return;
  try {
    await client.del(`cache:${key}`);
  } catch (err) {
    console.error("[cache] invalidate error:", err);
  }
}
