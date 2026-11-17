/**
 * Afhængighedsfrit i18n-lag til udvidelsen (sprogene i LOCALE_META).
 *
 * Katalog: messages/<sprog>/<navneområde>.json. Nøglen er "<navneområde>.<sti>",
 * fx t("popup.timer.start"). Tekster kan indeholde {navn} og
 * {count, plural, one {# kunde} other {# kunder}}.
 */

import { modules } from "./catalog-modules";

/**
 * Sprogregistret: skal være identisk med src/i18n/config.ts i webappen (udvidelsen er en separat
 * pakke og kan ikke importere derfra); src/i18n/__tests__/locale-registry.test.ts fejler ved afvigelse.
 * `chrome` er mappenavnet i _locales (Chrome bruger understreg og egne koder).
 */
export const LOCALE_META = {
  da: { name: "Dansk", intl: "da-DK", chrome: "da", beta: false },
  en: { name: "English", intl: "en-GB", chrome: "en", beta: false },
  de: { name: "Deutsch", intl: "de-DE", chrome: "de", beta: false },
  es: { name: "Español", intl: "es-ES", chrome: "es", beta: false },
  sv: { name: "Svenska", intl: "sv-SE", chrome: "sv", beta: false },
  nb: { name: "Norsk bokmål", intl: "nb-NO", chrome: "nb", beta: false },
  fi: { name: "Suomi", intl: "fi-FI", chrome: "fi", beta: false },
  nl: { name: "Nederlands", intl: "nl-NL", chrome: "nl", beta: false },
  fr: { name: "Français", intl: "fr-FR", chrome: "fr", beta: false },
  it: { name: "Italiano", intl: "it-IT", chrome: "it", beta: false },
  pt: { name: "Português", intl: "pt-PT", chrome: "pt_PT", beta: false },
  "pt-BR": {
    name: "Português (Brasil)",
    intl: "pt-BR",
    chrome: "pt_BR",
    beta: false,
  },
  pl: { name: "Polski", intl: "pl-PL", chrome: "pl", beta: false },
  cs: { name: "Čeština", intl: "cs-CZ", chrome: "cs", beta: false },
  ja: { name: "日本語", intl: "ja-JP", chrome: "ja", beta: false },
  ko: { name: "한국어", intl: "ko-KR", chrome: "ko", beta: false },
  "zh-Hans": {
    name: "简体中文",
    intl: "zh-Hans-CN",
    chrome: "zh_CN",
    beta: false,
  },
  tr: { name: "Türkçe", intl: "tr-TR", chrome: "tr", beta: false },
} as const;

export type Locale = keyof typeof LOCALE_META;
export const LOCALES = Object.keys(LOCALE_META) as unknown as readonly [
  Locale,
  ...Locale[],
];
/** "auto" følger browserens sprog. */
export type LanguageSetting = Locale | "auto";
export const DEFAULT_LOCALE: Locale = "da";
/** Reserve for manglende nøgler og kataloger i alle andre sprog end dansk: engelsk, aldrig dansk. */
export const FALLBACK_LOCALE: Locale = "en";

type Messages = Record<string, string>;
export type Params = Record<string, string | number>;

function flatten(obj: unknown, prefix: string, out: Messages): void {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out[prefix] = String(obj);
  }
}

function buildCatalogs(): Record<Locale, Messages> {
  const catalogs = Object.fromEntries(
    LOCALES.map((l) => [l, {} as Messages]),
  ) as Record<Locale, Messages>;
  for (const [path, mod] of Object.entries(modules)) {
    const m = path.match(/^\.\/messages\/([A-Za-z-]+)\/([^/]+)\.json$/);
    if (!m || !isLocale(m[1])) continue;
    flatten(mod, m[2], catalogs[m[1]]);
  }
  return catalogs;
}

export const catalogs = buildCatalogs();

export function isLocale(value: unknown): value is Locale {
  // Object.keys i stedet for Object.hasOwn: extensionens lib er ES2020
  return typeof value === "string" && Object.keys(LOCALE_META).includes(value);
}

/**
 * Mapper en sprogkode som "de-AT", "es_MX", "pt_BR" eller "zh-CN" til et understøttet sprog.
 * Samme regler som matchLocale i webappen (src/i18n/config.ts): pt uden region er europæisk,
 * traditionelle kinesiske tegn (zh-TW, zh-Hant) mappes ikke til forenklet, no/nn giver nb.
 */
export function matchLocale(code: string | undefined | null): Locale | null {
  if (!code) return null;
  const parts = code.trim().replace(/_/g, "-").toLowerCase().split("-");
  const lang = parts[0];
  const rest = parts.slice(1);
  if (lang === "pt") return rest.includes("br") ? "pt-BR" : "pt";
  if (lang === "zh") {
    if (rest.some((p) => ["hant", "tw", "hk", "mo"].includes(p))) return null;
    return "zh-Hans";
  }
  if (lang === "no" || lang === "nb" || lang === "nn") return "nb";
  return isLocale(lang) ? lang : null;
}

/** Sprog fra browseren (chrome.i18n, navigator), ellers dansk. */
export function detectLocale(): Locale {
  const candidates: Array<string | undefined> = [];
  try {
    const api = (
      globalThis as { chrome?: { i18n?: { getUILanguage?: () => string } } }
    ).chrome;
    candidates.push(api?.i18n?.getUILanguage?.());
  } catch {
    // ikke tilgængelig
  }
  if (typeof navigator !== "undefined") {
    candidates.push(navigator.language, ...(navigator.languages ?? []));
  }
  for (const c of candidates) {
    const found = matchLocale(c);
    if (found) return found;
  }
  return DEFAULT_LOCALE;
}

export function resolveLanguage(setting: unknown): Locale {
  return isLocale(setting) ? setting : detectLocale();
}

/** Valgmulighedens tekst i en sprogvælger: endonym, og "(beta)" for alt andet end da og en. */
export function localeOptionLabel(locale: Locale): string {
  const { name, beta } = LOCALE_META[locale];
  return beta ? `${name} (beta)` : name;
}

/** BCP 47-kode til Intl. */
export function toIntlLocale(locale: Locale): string {
  return LOCALE_META[locale].intl;
}

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  for (const l of listeners) l();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Finder den afsluttende klamme svarende til klammen i `start`. */
function closeIndex(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function pluralCategory(locale: Locale, n: number): string {
  return new Intl.PluralRules(toIntlLocale(locale)).select(n);
}

function format(
  template: string,
  params: Params | undefined,
  locale: Locale,
): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    const end = closeIndex(template, i);
    if (end === -1) {
      out += template.slice(i);
      break;
    }
    const inner = template.slice(i + 1, end);
    const comma = inner.indexOf(",");
    if (comma === -1) {
      const name = inner.trim();
      out += name in (params ?? {}) ? String(params?.[name]) : `{${name}}`;
    } else {
      const name = inner.slice(0, comma).trim();
      const rest = inner.slice(comma + 1).trim();
      if (rest.startsWith("plural")) {
        const body = rest.slice("plural".length).replace(/^\s*,/, "");
        const raw = params?.[name];
        const n = typeof raw === "number" ? raw : Number(raw ?? 0);
        const branches: Record<string, string> = {};
        let j = 0;
        while (j < body.length) {
          const open = body.indexOf("{", j);
          if (open === -1) break;
          const selector = body.slice(j, open).trim();
          const close = closeIndex(body, open);
          if (close === -1) break;
          branches[selector] = body.slice(open + 1, close);
          j = close + 1;
        }
        const chosen =
          branches[`=${n}`] ??
          branches[pluralCategory(locale, n)] ??
          branches.other ??
          "";
        out += format(chosen.replace(/#/g, String(n)), params, locale);
      } else {
        out += `{${inner}}`;
      }
    }
    i = end + 1;
  }
  return out;
}

/** Oversætter uden at bruge det globale sprog (bruges af tests og hooken). */
export function translate(
  locale: Locale,
  key: string,
  params?: Params,
): string {
  // Reserve: engelsk for alle sprog undtagen dansk (kilden); aldrig dansk for de andre.
  const template =
    catalogs[locale][key] ??
    (locale === DEFAULT_LOCALE ? undefined : catalogs[FALLBACK_LOCALE][key]);
  if (template === undefined) return key;
  return params || template.includes("{")
    ? format(template, params, locale)
    : template;
}

/** Oversæt med det aktive sprog. Manglende nøgle giver nøglen selv. */
export function t(key: string, params?: Params): string {
  return translate(current, key, params);
}

const formatterCache = new Map<
  string,
  Intl.NumberFormat | Intl.DateTimeFormat
>();

/** Talformat på det aktive sprog (cachet pr. sprog og indstillinger). */
export function numberFormat(
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const tag = toIntlLocale(current);
  const key = `n|${tag}|${JSON.stringify(options ?? {})}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(tag, options);
    formatterCache.set(key, f);
  }
  return f as Intl.NumberFormat;
}

/** Dato-/tidsformat på det aktive sprog (cachet pr. sprog og indstillinger). */
export function dateFormat(
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const tag = toIntlLocale(current);
  const key = `d|${tag}|${JSON.stringify(options ?? {})}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, options);
    formatterCache.set(key, f);
  }
  return f as Intl.DateTimeFormat;
}
