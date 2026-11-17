import type { Locale } from "./config";
import { withFallback } from "./fallback";

/** Ét statisk navneområde i alle sprog (src/i18n/catalogs/<navneområde>.ts). */
export type Catalogs = Partial<Record<Locale, Record<string, unknown>>>;

const cache = new Map<string, Record<string, unknown>>();

/**
 * Synkront katalog for et lille navneområde, lagt oven på engelsk: et sprog, der mangler
 * navneområdet eller nøgler, læses på engelsk, aldrig på dansk. Hjælpere, der også kører i
 * browseren, giver selv deres navneområdes modul med, så klientbundtet ikke får hele det statiske
 * katalog (alle sprog af mails og notifikationer) med.
 */
export function catalogMessages(
  namespace: string,
  raw: Catalogs,
  locale: Locale,
): Record<string, unknown> {
  const key = `${locale}|${namespace}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = withFallback(locale, raw[locale], raw.en);
    cache.set(key, hit);
  }
  return hit;
}
