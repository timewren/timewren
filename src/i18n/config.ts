import { type BrandId, getBrandId } from "@/lib/brand-id";

// Sprogregistret: ÉT sted for alle sprog i TimeWren. Et nyt sprog tilføjes her, i
// scripts/i18n/catalogs.json (scripts kan ikke læse TypeScript) og i
// browser-extension/src/i18n/core.ts; src/i18n/__tests__/locale-registry.test.ts fejler,
// hvis de tre afviger. Kataloger: src/i18n/messages/<kode>/, browser-extension/src/i18n/messages/<kode>/
// og browser-extension/_locales/<chrome>/. Efter nye filer: `npm run i18n:build`.
//
// Koderne er BCP 47 (`pt-BR`, `zh-Hans`). `pt` er europæisk portugisisk (pt-PT).
interface LocaleMeta {
  /** Selvbetegnelse (endonym), vises altid på sproget selv. */
  name: string;
  /** BCP 47-kode til Intl.* og toLocaleDateString. */
  intl: string;
  /** Mappenavn i browser-extension/_locales (Chrome bruger understreg og egne koder). */
  chrome: string;
  /** Beta: kataloget kan være delvist eller maskinoversat; mangler falder tilbage til engelsk. */
  beta: boolean;
  /** Faktura-PDF'ens indlejrede font (Schibsted Grotesk, latin + latin-ext) kan sætte sproget. */
  pdf: boolean;
  /** Sproget er med i TimeTrack Cloud (brand timetrack) som i dag. */
  timetrack: boolean;
}

export const LOCALE_META = {
  da: {
    name: "Dansk",
    intl: "da-DK",
    chrome: "da",
    beta: false,
    pdf: true,
    timetrack: true,
  },
  en: {
    name: "English",
    intl: "en-GB",
    chrome: "en",
    beta: false,
    pdf: true,
    timetrack: true,
  },
  de: {
    name: "Deutsch",
    intl: "de-DE",
    chrome: "de",
    beta: false,
    pdf: true,
    timetrack: true,
  },
  es: {
    name: "Español",
    intl: "es-ES",
    chrome: "es",
    beta: false,
    pdf: true,
    timetrack: true,
  },
  sv: {
    name: "Svenska",
    intl: "sv-SE",
    chrome: "sv",
    beta: false,
    pdf: true,
    timetrack: false,
  },
  nb: {
    name: "Norsk bokmål",
    intl: "nb-NO",
    chrome: "nb",
    beta: false,
    pdf: true,
    timetrack: false,
  },
  fi: {
    name: "Suomi",
    intl: "fi-FI",
    chrome: "fi",
    beta: false,
    pdf: true,
    timetrack: false,
  },
  nl: {
    name: "Nederlands",
    intl: "nl-NL",
    chrome: "nl",
    beta: false,
    pdf: true,
    timetrack: false,
  },
  fr: {
    name: "Français",
    intl: "fr-FR",
    chrome: "fr",
    beta: false,
    pdf: true,
    timetrack: false,
  },
  it: {
    name: "Italiano",
    intl: "it-IT",
    chrome: "it",
    beta: false,
    pdf: true,
    timetrack: false,
  },
  pt: {
    name: "Português",
    intl: "pt-PT",
    chrome: "pt_PT",
    beta: false,
    pdf: true,
    timetrack: false,
  },
  "pt-BR": {
    name: "Português (Brasil)",
    intl: "pt-BR",
    chrome: "pt_BR",
    beta: false,
    pdf: true,
    timetrack: false,
  },
  pl: {
    name: "Polski",
    intl: "pl-PL",
    chrome: "pl",
    beta: false,
    pdf: true,
    timetrack: false,
  },
  cs: {
    name: "Čeština",
    intl: "cs-CZ",
    chrome: "cs",
    beta: false,
    pdf: true,
    timetrack: false,
  },
  ja: {
    name: "日本語",
    intl: "ja-JP",
    chrome: "ja",
    beta: false,
    pdf: false,
    timetrack: false,
  },
  ko: {
    name: "한국어",
    intl: "ko-KR",
    chrome: "ko",
    beta: false,
    pdf: false,
    timetrack: false,
  },
  "zh-Hans": {
    name: "简体中文",
    intl: "zh-Hans-CN",
    chrome: "zh_CN",
    beta: false,
    pdf: false,
    timetrack: false,
  },
  tr: {
    name: "Türkçe",
    intl: "tr-TR",
    chrome: "tr",
    beta: false,
    pdf: true,
    timetrack: false,
  },
} as const satisfies Record<string, LocaleMeta>;

export type Locale = keyof typeof LOCALE_META;
export const LOCALES = Object.keys(LOCALE_META) as unknown as readonly [
  Locale,
  ...Locale[],
];
export const DEFAULT_LOCALE: Locale = "da";
/** Sprogets reserve: manglende kataloger, navneområder og nøgler læses på engelsk, aldrig dansk. */
export const FALLBACK_LOCALE: Locale = "en";
/** Sprog med fuldstændigt katalog (håndhævet af i18n:check). Resten er beta og må være delvise. */
export const COMPLETE_LOCALES: readonly Locale[] = ["da", "en"];

// Selvbetegnelser vises altid på sproget selv, uanset valgt UI-sprog.
export const LOCALE_NAMES = Object.fromEntries(
  LOCALES.map((l) => [l, LOCALE_META[l].name]),
) as Record<Locale, string>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && Object.hasOwn(LOCALE_META, value);
}

export function isBetaLocale(locale: Locale): boolean {
  return LOCALE_META[locale].beta;
}

/**
 * Sprogene brandet viser. TimeTrack Cloud (timetrack.dk) viser fortsat kun da, en, de og es;
 * TimeWren (selvhost og alt andet) viser alle. `isLocale` er brandløs, så gemte værdier og tests
 * ikke afhænger af brandet; vælgere og indgange bruger denne.
 */
export function availableLocales(brand: BrandId = getBrandId()): Locale[] {
  return LOCALES.filter(
    (l) => brand === "timewren" || LOCALE_META[l].timetrack,
  );
}

export function isAvailableLocale(
  value: unknown,
  brand: BrandId = getBrandId(),
): value is Locale {
  return isLocale(value) && availableLocales(brand).includes(value);
}

/** Valgmulighedens tekst i en sprogvælger: endonym, og "(beta)" for alt andet end da og en. */
export function localeOptionLabel(locale: Locale): string {
  const { name, beta } = LOCALE_META[locale];
  return beta ? `${name} (beta)` : name;
}

/**
 * Mapper en sprogkode som "pt_BR", "zh-CN", "no" eller "sv-FI" til et sprog i registret.
 * Portugisisk uden region (pt) er europæisk; kinesisk skrevet med traditionelle tegn
 * (zh-TW, zh-HK, zh-Hant) mappes ikke til forenklet.
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

// Vælger det første understøttede sprog i en Accept-Language-header (højeste q først).
export function pickFromAcceptLanguage(
  header: string | null,
  brand: BrandId = getBrandId(),
): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(
        params
          .map((p) => p.trim())
          .find((p) => p.startsWith("q="))
          ?.slice(2) ?? 1,
      );
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((e) => e.tag && e.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const found = matchLocale(tag);
    if (found && isAvailableLocale(found, brand)) return found;
  }
  return null;
}
