import { DEFAULT_LOCALE, FALLBACK_LOCALE, type Locale } from "./config";

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** `over` oven på `under`, nøgle for nøgle ned gennem hele træet. Rører ingen af argumenterne. */
export function deepMerge(under: Dict, over: Dict): Dict {
  const out: Dict = { ...under };
  for (const [k, v] of Object.entries(over)) {
    const base = out[k];
    out[k] = isDict(base) && isDict(v) ? deepMerge(base, v) : v;
  }
  return out;
}

/**
 * Sprogets reserve. Dansk er kildesproget og har ingen reserve. Alle andre sprog falder tilbage
 * til engelsk (aldrig dansk), så en manglende nøgle, et manglende navneområde eller et helt
 * manglende katalog giver engelsk tekst og aldrig en rå nøgle.
 */
export function fallbackFor(locale: Locale): Locale | null {
  if (locale === DEFAULT_LOCALE || locale === FALLBACK_LOCALE) return null;
  return FALLBACK_LOCALE;
}

/**
 * Lægger sprogets katalog oven på engelsk, nøgle for nøgle. Et manglende katalog giver ren engelsk.
 */
export function withFallback(
  locale: Locale,
  own: Dict | undefined,
  fallback: Dict | undefined,
): Dict {
  if (fallbackFor(locale) === null) return own ?? {};
  return deepMerge(fallback ?? {}, own ?? {});
}
