import type { Locale } from "./config";
import { withFallback } from "./fallback";
import { STATIC_RAW, type StaticNamespace } from "./messages/static";

export type { StaticNamespace } from "./messages/static";

const cache = new Map<string, Record<string, unknown>>();

/**
 * Synkront katalog for et lille navneområde (mails, PDF, delte hjælpere, zod-beskeder), lagt oven
 * på engelsk: et sprog, der mangler navneområdet eller nøgler, læses på engelsk, aldrig på dansk.
 */
export function staticMessages(
  namespace: StaticNamespace,
  locale: Locale,
): Record<string, unknown> {
  const key = `${locale}|${namespace}`;
  let hit = cache.get(key);
  if (!hit) {
    const raw = STATIC_RAW[namespace];
    hit = withFallback(locale, raw[locale], raw.en);
    cache.set(key, hit);
  }
  return hit;
}
