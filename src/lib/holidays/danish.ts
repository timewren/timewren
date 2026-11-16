// Danske helligdage og fridage (#526) — ÉT sted for kalenderen.
//
// Rene funktioner på "yyyy-MM-dd"-strenge (ingen Date-objekter i lokal tid),
// så resultatet er det samme under TZ=UTC og TZ=Europe/Copenhagen. Påsken
// beregnes for hvert år; ingen år er hårdkodede.
//
// En fridagskalender = de officielle helligdage + en forudindstilling, der
// afgør de "valgfri" fridage (1. maj, grundlovsdag, juleaftensdag …), + egne
// fridage (firmafridage). Hver fridag er hel- eller halvdag.

import { addDaysToDateStr, isDateStr } from "@/lib/time/copenhagen";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Påskedag (påskesøndag) i den gregorianske kalender — Gauss/Meeus. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

export interface NamedDate {
  date: string;
  name: string;
}

/** Store bededag blev afskaffet som helligdag fra og med 2024. */
export const GREAT_PRAYER_DAY_LAST_YEAR = 2023;

/**
 * De officielle danske helligdage i året (inkl. søndagene påskedag og
 * pinsedag), sorteret efter dato.
 */
export function danishPublicHolidays(year: number): NamedDate[] {
  const easter = easterSunday(year);
  const rel = (days: number) => addDaysToDateStr(easter, days);
  const list: NamedDate[] = [
    { date: ymd(year, 1, 1), name: "Nytårsdag" },
    { date: rel(-3), name: "Skærtorsdag" },
    { date: rel(-2), name: "Langfredag" },
    { date: easter, name: "Påskedag" },
    { date: rel(1), name: "2. påskedag" },
    { date: rel(39), name: "Kristi himmelfartsdag" },
    { date: rel(49), name: "Pinsedag" },
    { date: rel(50), name: "2. pinsedag" },
    { date: ymd(year, 12, 25), name: "Juledag" },
    { date: ymd(year, 12, 26), name: "2. juledag" },
  ];
  if (year <= GREAT_PRAYER_DAY_LAST_YEAR) {
    list.push({ date: rel(26), name: "Store bededag" });
  }
  return list.sort((x, y) => x.date.localeCompare(y.date));
}

// ── Valgfri fridage og forudindstillinger ──────────────────────────────

export const OPTIONAL_DAY_KEYS = [
  "may1",
  "constitutionDay",
  "dayAfterAscension",
  "christmasEve",
  "newYearsEve",
] as const;
export type OptionalDayKey = (typeof OPTIONAL_DAY_KEYS)[number];

/** "work" = almindelig arbejdsdag, "half" = halv fridag, "full" = hel fridag */
export const OPTIONAL_DAY_SETTINGS = ["work", "half", "full"] as const;
export type OptionalDaySetting = (typeof OPTIONAL_DAY_SETTINGS)[number];

export const OPTIONAL_DAY_LABELS: Record<OptionalDayKey, string> = {
  may1: "1. maj",
  constitutionDay: "Grundlovsdag",
  dayAfterAscension: "Fredag efter Kristi himmelfart",
  christmasEve: "Juleaftensdag",
  newYearsEve: "Nytårsaftensdag",
};

export function optionalDayDate(key: OptionalDayKey, year: number): string {
  switch (key) {
    case "may1":
      return ymd(year, 5, 1);
    case "constitutionDay":
      return ymd(year, 6, 5);
    case "dayAfterAscension":
      return addDaysToDateStr(easterSunday(year), 40);
    case "christmasEve":
      return ymd(year, 12, 24);
    case "newYearsEve":
      return ymd(year, 12, 31);
  }
}

export const DAY_OFF_PRESETS = ["private", "ok24"] as const;
export type DayOffPreset = (typeof DAY_OFF_PRESETS)[number];

export const DAY_OFF_PRESET_LABELS: Record<DayOffPreset, string> = {
  private: "Almindelig privat virksomhed",
  ok24: "Kommunal administration og IT (OK24/OK26)",
};

export const DAY_OFF_PRESET_DESCRIPTIONS: Record<DayOffPreset, string> = {
  private:
    "De officielle helligdage. 1. maj, grundlovsdag, juleaftensdag og nytårsaftensdag er arbejdsdage, medmindre I vælger andet.",
  ok24: "KL/HK 30.11: halv fridag 1. maj og grundlovsdag, hele fridage påskelørdag, juleaftensdag og nytårsaftensdag. Tilpas ved lokale særregler.",
};

/** Hvad forudindstillingen sætter de valgfri dage til. */
export const PRESET_OPTIONAL_DAYS: Record<
  DayOffPreset,
  Record<OptionalDayKey, OptionalDaySetting>
> = {
  private: {
    may1: "work",
    constitutionDay: "work",
    dayAfterAscension: "work",
    christmasEve: "work",
    newYearsEve: "work",
  },
  ok24: {
    may1: "half",
    constitutionDay: "half",
    dayAfterAscension: "work",
    christmasEve: "full",
    newYearsEve: "full",
  },
};

// ── Konfiguration ──────────────────────────────────────────────────────

export interface CustomDayOff {
  date: string;
  name: string;
  isHalfDay: boolean;
}

export interface DayOffConfig {
  preset: DayOffPreset;
  /** Fuldt udfyldt: forudindstillingens værdier med evt. egne valg ovenpå */
  optionalDays: Record<OptionalDayKey, OptionalDaySetting>;
  customDays: CustomDayOff[];
}

export const MAX_CUSTOM_DAYS = 200;
export const MAX_DAY_OFF_NAME = 100;

export function isDayOffPreset(v: unknown): v is DayOffPreset {
  return (
    typeof v === "string" && (DAY_OFF_PRESETS as readonly string[]).includes(v)
  );
}

function isOptionalDaySetting(v: unknown): v is OptionalDaySetting {
  return (
    typeof v === "string" &&
    (OPTIONAL_DAY_SETTINGS as readonly string[]).includes(v)
  );
}

/**
 * Gyldig konfiguration ud fra gemte (jsonb-)værdier. Ukendt preset →
 * "private"; ugyldige valgfri-dage falder tilbage til preset'ets værdi;
 * ugyldige egne dage springes over.
 */
export function normalizeDayOffConfig(raw?: {
  preset?: unknown;
  optionalDays?: unknown;
  customDays?: unknown;
}): DayOffConfig {
  const preset = isDayOffPreset(raw?.preset) ? raw.preset : "private";
  const stored =
    raw?.optionalDays &&
    typeof raw.optionalDays === "object" &&
    !Array.isArray(raw.optionalDays)
      ? (raw.optionalDays as Record<string, unknown>)
      : {};
  const optionalDays = { ...PRESET_OPTIONAL_DAYS[preset] };
  for (const key of OPTIONAL_DAY_KEYS) {
    const v = stored[key];
    if (isOptionalDaySetting(v)) optionalDays[key] = v;
  }
  const customDays: CustomDayOff[] = [];
  if (Array.isArray(raw?.customDays)) {
    for (const item of raw.customDays.slice(0, MAX_CUSTOM_DAYS)) {
      if (!item || typeof item !== "object") continue;
      const { date, name, isHalfDay } = item as Record<string, unknown>;
      if (typeof date !== "string" || !isDateStr(date)) continue;
      customDays.push({
        date,
        name:
          typeof name === "string" && name.trim()
            ? name.trim().slice(0, MAX_DAY_OFF_NAME)
            : "Fridag",
        isHalfDay: isHalfDay === true,
      });
    }
  }
  customDays.sort((a, b) => a.date.localeCompare(b.date));
  return { preset, optionalDays, customDays };
}

export const DEFAULT_DAY_OFF_CONFIG: DayOffConfig = normalizeDayOffConfig();

// ── Opløsning til konkrete fridage ─────────────────────────────────────

export type DayOffSource = "public" | "optional" | "custom";

export interface DayOff {
  date: string;
  name: string;
  isHalfDay: boolean;
  source: DayOffSource;
}

/**
 * Hel fridag vinder over halv; ved lige vinder den første (helligdagen).
 * Gør en egen fridag en halv valgfri dag hel, bevares kilden, så dagen
 * stadig er løn-helligdag (#742).
 */
function mergeInto(map: Map<string, DayOff>, day: DayOff): void {
  const existing = map.get(day.date);
  if (!existing) {
    map.set(day.date, day);
  } else if (existing.isHalfDay && !day.isHalfDay) {
    map.set(day.date, {
      ...day,
      source: existing.source === "custom" ? day.source : existing.source,
    });
  }
}

/** Alle fridage i året efter konfigurationen, sorteret efter dato. */
export function daysOffForYear(config: DayOffConfig, year: number): DayOff[] {
  const map = new Map<string, DayOff>();
  for (const h of danishPublicHolidays(year)) {
    mergeInto(map, { ...h, isHalfDay: false, source: "public" });
  }
  // KL/HK 30.11, OK24 §19 / OK26 §20. Se docs/day-off-calendar.md.
  if (config.preset === "ok24") {
    mergeInto(map, {
      date: addDaysToDateStr(easterSunday(year), -1),
      name: "Påskelørdag",
      isHalfDay: false,
      source: "optional",
    });
  }
  for (const key of OPTIONAL_DAY_KEYS) {
    const setting = config.optionalDays[key];
    if (setting === "work") continue;
    mergeInto(map, {
      date: optionalDayDate(key, year),
      name: OPTIONAL_DAY_LABELS[key],
      isHalfDay: setting === "half",
      source: "optional",
    });
  }
  const prefix = `${year}-`;
  for (const c of config.customDays) {
    if (!c.date.startsWith(prefix)) continue;
    mergeInto(map, { ...c, source: "custom" });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type DayOffLookup = (date: string) => DayOff | null;

/**
 * Opslag pr. dato med cache pr. år. `extra` er ekstra fridage fra andre
 * kilder (fx organisationens ældre helligdagsliste), flettet med samme regel.
 */
export function createDayOffLookup(
  config: DayOffConfig,
  extra: readonly CustomDayOff[] = [],
): DayOffLookup {
  const byYear = new Map<number, Map<string, DayOff>>();
  return (date) => {
    if (!isDateStr(date)) return null;
    const year = Number(date.slice(0, 4));
    let map = byYear.get(year);
    if (!map) {
      map = new Map();
      for (const d of daysOffForYear(config, year)) map.set(d.date, d);
      const prefix = `${year}-`;
      for (const e of extra) {
        if (e.date.startsWith(prefix)) {
          mergeInto(map, { ...e, source: "custom" });
        }
      }
      byYear.set(year, map);
    }
    return map.get(date) ?? null;
  };
}

/** Fridage i [start, end] (begge inkl.), sorteret efter dato. */
export function daysOffInRange(
  lookup: DayOffLookup,
  start: string,
  end: string,
): DayOff[] {
  const out: DayOff[] = [];
  for (let d = start; d <= end; d = addDaysToDateStr(d, 1)) {
    const day = lookup(d);
    if (day) out.push(day);
  }
  return out;
}

/**
 * Er fridagen en "helligdag" i lønnens forstand (lønregler med
 * dagbetingelsen helligdag, #742)? Ja for de lovbestemte helligdage og for
 * de valgfri dage (1. maj, grundlovsdag, juleaftensdag …), som kalenderen
 * udtrykkeligt giver hel eller halv fri — det er de dage, overenskomsterne
 * typisk knytter helligdagsbetaling og -tillæg til. Egne firmafridage og
 * rækker fra den ældre helligdagsliste er almindelige fridage: de trækkes
 * fra normtiden, men udløser ikke helligdagslønarter.
 */
export function isPayrollHoliday(day: DayOff | null): boolean {
  return day?.source === "public" || day?.source === "optional";
}

/**
 * Andel af dagens normtid der skal arbejdes: 1 = almindelig dag, 0,5 =
 * halv fridag, 0 = hel fridag.
 */
export function workShareOn(lookup: DayOffLookup, date: string): number {
  const day = lookup(date);
  if (!day) return 1;
  return day.isHalfDay ? 0.5 : 0;
}
