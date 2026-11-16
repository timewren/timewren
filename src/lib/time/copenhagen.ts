// Danske kalenderdage uafhængigt af processens tidszone.
//
// Prod-containeren kører i UTC (TZ er ikke sat under Dokploy/Swarm), mens
// udvikling kører i Europe/Copenhagen. Kode der finder "i dag", "i går",
// ugestart eller månedsstart med `setHours(0, 0, 0, 0)`, `getDate()` eller
// `toLocalDateStr(new Date())` giver derfor forskellige svar afhængigt af hvor
// den kører — og i prod er dansk dag 00:00–02:00 (sommertid) stadig "i går".
//
// Reglen: et tidspunkt (Date) oversættes til en dansk dato med
// `toCopenhagenDateStr`, og al dato-aritmetik sker på "yyyy-MM-dd"-strenge
// (rent kalender-regnestykke i UTC, så sommertid ikke kan forskyde noget).
// Skal datoen bruges som grænse i en forespørgsel på et tidsstempel, bruges
// `copenhagenDayStart`/`copenhagenDayEndExclusive`, der giver det præcise
// øjeblik dansk midnat indtræffer (22:00Z i sommertid, 23:00Z i vintertid).
//
// Lagringskonventionen for `time_entries.date` (timestamp uden tidszone) er
// UTC-midnat på den danske dato: `new Date("yyyy-MM-dd")`. Brug
// `entryDateFromStr` når en dansk dato skal skrives til den kolonne.

export const COPENHAGEN_TZ = "Europe/Copenhagen";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: COPENHAGEN_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export interface CopenhagenParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Vægur-tid i København for et tidspunkt. */
export function copenhagenParts(instant: Date): CopenhagenParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseDateStr(dateStr: string): [number, number, number] {
  const m = DATE_RE.exec(dateStr);
  if (!m) throw new Error(`Forventede yyyy-MM-dd, fik "${dateStr}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Er strengen en gyldig kalenderdato på formen "yyyy-MM-dd"? */
export function isDateStr(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    dt.getUTCFullYear() === Number(m[1]) &&
    dt.getUTCMonth() === Number(m[2]) - 1 &&
    dt.getUTCDate() === Number(m[3])
  );
}

/** Den danske kalenderdato ("yyyy-MM-dd") for et tidspunkt. */
export function toCopenhagenDateStr(instant: Date): string {
  const p = copenhagenParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Dagens danske dato ("yyyy-MM-dd"). */
export function copenhagenToday(now: Date = new Date()): string {
  return toCopenhagenDateStr(now);
}

/** Klokketimen (0-23) i København for et tidspunkt. */
export function copenhagenHour(instant: Date): number {
  return copenhagenParts(instant).hour;
}

/** Læg `days` dage til en dato-streng (kan være negativ). */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = parseDateStr(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Læg `months` måneder til; dagen klemmes til månedens sidste dag. */
export function addMonthsToDateStr(dateStr: string, months: number): string {
  const [y, m, d] = parseDateStr(dateStr);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
}

/** ISO-ugedag for en dato: 1 = mandag … 7 = søndag. */
export function isoWeekdayOfDateStr(dateStr: string): number {
  const [y, m, d] = parseDateStr(dateStr);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Mandagen i samme uge som datoen. */
export function weekStartDateStr(dateStr: string): string {
  return addDaysToDateStr(dateStr, 1 - isoWeekdayOfDateStr(dateStr));
}

/** Den 1. i samme måned som datoen. */
export function monthStartDateStr(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

/** Københavns UTC-offset i minutter på et givet tidspunkt (60 eller 120). */
function offsetMinutesAt(instant: Date): number {
  const p = copenhagenParts(instant);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const flooredInstant = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - flooredInstant) / 60000);
}

/**
 * Øjeblikket hvor den danske dag begynder (00:00 i København) — 22:00Z dagen
 * før i sommertid, 23:00Z i vintertid. Midnat ligger aldrig i et
 * sommertidshul (skiftet sker kl. 02/03), så resultatet er entydigt.
 */
export function copenhagenDayStart(dateStr: string): Date {
  const [y, m, d] = parseDateStr(dateStr);
  const utcMidnight = Date.UTC(y, m - 1, d);
  let candidate = utcMidnight - offsetMinutesAt(new Date(utcMidnight)) * 60000;
  // Offset kan være anderledes ved selve kandidat-øjeblikket (skiftedage).
  candidate = utcMidnight - offsetMinutesAt(new Date(candidate)) * 60000;
  return new Date(candidate);
}

/** Eksklusiv øvre grænse: starten af den følgende danske dag. */
export function copenhagenDayEndExclusive(dateStr: string): Date {
  return copenhagenDayStart(addDaysToDateStr(dateStr, 1));
}

/**
 * Lagringsværdien for en dansk dato i `time_entries.date` og andre
 * dato-som-timestamp-kolonner: UTC-midnat på datoen. Samme som
 * `new Date("yyyy-MM-dd")`, men validerer formatet.
 */
export function entryDateFromStr(dateStr: string): Date {
  const [y, m, d] = parseDateStr(dateStr);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Et Date-anker for en dansk dato: kl. 12:00 UTC på datoen. Lokale getters
 * (`getDate`, `getDay`, `setHours(0, 0, 0, 0)` …) giver dén dato i enhver
 * proces-TZ mellem UTC-11 og UTC+11 — også UTC (prod) og Europe/Copenhagen
 * (udvikling). Til eksisterende kode der regner i lokale datoer ud fra
 * "i dag": giv den `copenhagenTodayAnchor()` i stedet for `new Date()`.
 */
export function dateAnchorFromStr(dateStr: string): Date {
  const [y, m, d] = parseDateStr(dateStr);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** `dateAnchorFromStr` for dagens danske dato. */
export function copenhagenTodayAnchor(now: Date = new Date()): Date {
  return dateAnchorFromStr(copenhagenToday(now));
}

/**
 * Øjeblikket for et vægur-tidspunkt i København. `month` er 1-12. I
 * sommertidshullet (02:00–03:00 sidste søndag i marts) rykkes en time frem
 * (02:30 → 03:30); den dobbelte time i oktober giver den anden
 * (vintertids-)forekomst (02:30 → 01:30Z).
 */
export function copenhagenWallTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = asUtc - offsetMinutesAt(new Date(asUtc)) * 60000;
  candidate = asUtc - offsetMinutesAt(new Date(candidate)) * 60000;
  return new Date(candidate);
}

/**
 * Fortolk et Date, der er bygget med lokale konstruktører/settere
 * (`new Date(y, m, d)`, `setHours(h, m)` — fx CSV-parsere), som dansk vægur.
 * I UTC-prod ville klokkeslættet ellers blive gemt 1-2 timer forkert.
 */
export function localWallClockAsCopenhagen(d: Date): Date {
  return copenhagenWallTime(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );
}

/**
 * Lagringsværdien (UTC-midnat) for den kalenderdato et lokalt bygget Date
 * repræsenterer. Uden den ville `new Date(y, m, d)` blive gemt som 22:00Z
 * dagen før, hvis processen kørte i Europe/Copenhagen.
 */
export function localDateToEntryDate(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}
