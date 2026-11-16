import { syncT } from "@/i18n/sync-text";
// Dækningsgrad (#679): hvor stor en del af den normale arbejdstid der er
// logget, delt i fakturerbar/ikke-fakturerbar og pr. kunde.
//
// Rene funktioner uden DB-adgang, så beregningen kan unit-testes. Datoer er
// "yyyy-MM-dd"-strenge på samme tidsbasis som `time_entries.date` (UTC-
// midnat for datoen, jf. src/lib/time/date-bounds.ts). Arbejdstiden pr. dato
// kommer fra loadWorkTimeContext (./load), hvor fridage og helligdage fra
// brugerens fridagskalender (#526) allerede er trukket fra.

export const ISO_WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];
export type WorkSchedule = Record<IsoWeekday, number>;

/** 37 t fordelt på man-fre. */
export const DEFAULT_DAILY_HOURS = 7.4;
export const DEFAULT_WORKING_DAYS: readonly IsoWeekday[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
];
export const MAX_HOURS_PER_DAY = 24;

export type CoveragePeriod = "day" | "week" | "month";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isIsoWeekday(v: string): v is IsoWeekday {
  return (ISO_WEEKDAYS as readonly string[]).includes(v);
}

/** Ugeskema med 7,4 t på hver arbejdsdag og 0 på resten. */
export function scheduleFromWorkingDays(
  days: readonly string[] | null | undefined,
): WorkSchedule {
  const working = new Set(
    (days ?? DEFAULT_WORKING_DAYS).filter((d) => isIsoWeekday(d)),
  );
  const out = {} as WorkSchedule;
  for (const d of ISO_WEEKDAYS) {
    out[d] = working.has(d) ? DEFAULT_DAILY_HOURS : 0;
  }
  return out;
}

/**
 * Brugerens ugeskema: gemt skema når det er gyldigt, ellers afledt af
 * arbejdsdagene (standard man-fre). Ugyldige/negative værdier bliver 0,
 * værdier over et døgn klippes til 24.
 */
export function resolveWorkSchedule(
  stored: unknown,
  workingDays: readonly string[] | null | undefined,
): WorkSchedule {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return scheduleFromWorkingDays(workingDays);
  }
  const raw = stored as Record<string, unknown>;
  const out = {} as WorkSchedule;
  for (const d of ISO_WEEKDAYS) {
    const n = Number(raw[d]);
    out[d] =
      Number.isFinite(n) && n > 0 ? round2(Math.min(n, MAX_HOURS_PER_DAY)) : 0;
  }
  return out;
}

/** Ugedage med arbejdstid > 0 — spejles til users.working_days. */
export function workingDaysOf(schedule: WorkSchedule): IsoWeekday[] {
  return ISO_WEEKDAYS.filter((d) => schedule[d] > 0);
}

export function weeklyScheduleTotal(schedule: WorkSchedule): number {
  return round2(ISO_WEEKDAYS.reduce((sum, d) => sum + schedule[d], 0));
}

function parse(dateStr: string): Date {
  if (!DATE_RE.test(dateStr)) {
    throw new Error(`Forventede yyyy-MM-dd, fik "${dateStr}"`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO-ugedag ("1" = mandag … "7" = søndag) for en dato. */
export function isoWeekdayOf(dateStr: string): IsoWeekday {
  const dow = parse(dateStr).getUTCDay(); // 0 = søndag
  return String(dow === 0 ? 7 : dow) as IsoWeekday;
}

export function shiftDate(dateStr: string, days: number): string {
  const d = parse(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/** Alle datoer i [start, end], begge inklusive. */
export function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = shiftDate(d, 1)) out.push(d);
  return out;
}

/** Dag, uge (man-søn) eller kalendermåned der indeholder datoen. */
export function periodRange(
  period: CoveragePeriod,
  anchor: string,
): { start: string; end: string } {
  if (period === "day") return { start: anchor, end: anchor };
  if (period === "week") {
    const start = shiftDate(anchor, -(Number(isoWeekdayOf(anchor)) - 1));
    return { start, end: shiftDate(start, 6) };
  }
  const d = parse(anchor);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start: format(start), end: format(end) };
}

/** Samme periode forskudt én hel periode frem (+1) eller tilbage (-1). */
export function shiftPeriod(
  period: CoveragePeriod,
  anchor: string,
  direction: 1 | -1,
): string {
  if (period === "day") return shiftDate(anchor, direction);
  if (period === "week") return shiftDate(anchor, 7 * direction);
  const d = parse(periodRange("month", anchor).start);
  d.setUTCMonth(d.getUTCMonth() + direction);
  return format(d);
}

/** Dagens dato ("yyyy-MM-dd") i en tidszone — standard Europe/Copenhagen. */
export function todayInTimeZone(
  timeZone = "Europe/Copenhagen",
  now: Date = new Date(),
): string {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = "Europe/Copenhagen";
  }
  // en-CA formaterer som yyyy-MM-dd
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Datoen for en `time_entries.date`-værdi på lagringens tidsbasis (UTC). */
export function entryDateStr(date: Date): string {
  return format(date);
}

/** Forventet arbejdstid pr. dato ud fra en opslagsfunktion. */
export function expectedByDate(
  dates: readonly string[],
  hoursFor: (date: string) => number,
): Map<string, number> {
  return new Map(dates.map((d) => [d, Math.max(0, hoursFor(d) || 0)]));
}

export function scheduleHoursFor(
  schedule: WorkSchedule,
): (date: string) => number {
  return (date) => schedule[isoWeekdayOf(date)];
}

export interface CoverageEntry {
  date: string;
  hours: number;
  /** NULL følger kolonnens default (fakturerbar). */
  isBillable: boolean | null;
  clientId: string | null;
  clientName: string | null;
}

export interface ClientCoverage {
  /** null = intern tid (ingen kunde) */
  clientId: string | null;
  clientName: string;
  billableHours: number;
  nonBillableHours: number;
  totalHours: number;
  /** Andel af al logget tid i perioden (0-100) */
  sharePct: number;
  /** Ikke-fakturerbare timer pr. fakturerbar time; null uden fakturerbar tid */
  nonBillablePerBillableHour: number | null;
}

export interface DayCoverage {
  date: string;
  expectedHours: number;
  loggedHours: number;
  billableHours: number;
  coveragePct: number | null;
}

export interface CoverageSummary {
  expectedHours: number;
  loggedHours: number;
  billableHours: number;
  nonBillableHours: number;
  /** Logget ÷ arbejdstid i procent; null når arbejdstiden er 0 */
  coveragePct: number | null;
  billableCoveragePct: number | null;
  nonBillableCoveragePct: number | null;
  /** Fakturerbar andel af den loggede tid (0-100); null uden logget tid */
  billableSharePct: number | null;
  nonBillablePerBillableHour: number | null;
  clients: ClientCoverage[];
  days: DayCoverage[];
}

export const INTERNAL_TIME_LABEL = "Intern tid";

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function ratio(nonBillable: number, billable: number): number | null {
  return billable > 0 ? round2(nonBillable / billable) : null;
}

/**
 * Saml dækningsgraden for en periode. `expected` skal indeholde ALLE
 * periodens datoer (også dem med 0 t), så dag-rækkerne bliver komplette.
 */
export function summarizeCoverage(
  entries: readonly CoverageEntry[],
  expected: ReadonlyMap<string, number>,
): CoverageSummary {
  const byClient = new Map<
    string,
    { clientId: string | null; name: string; billable: number; non: number }
  >();
  const byDay = new Map<string, { logged: number; billable: number }>();
  let billable = 0;
  let nonBillable = 0;

  for (const e of entries) {
    const hours = Number(e.hours);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    const isBillable = e.isBillable !== false;
    if (isBillable) billable += hours;
    else nonBillable += hours;

    const key = e.clientId ?? "__internal__";
    const row = byClient.get(key) ?? {
      clientId: e.clientId,
      name: e.clientId
        ? e.clientName || syncT("common.unknownClient")
        : INTERNAL_TIME_LABEL,
      billable: 0,
      non: 0,
    };
    if (isBillable) row.billable += hours;
    else row.non += hours;
    byClient.set(key, row);

    const day = byDay.get(e.date) ?? { logged: 0, billable: 0 };
    day.logged += hours;
    if (isBillable) day.billable += hours;
    byDay.set(e.date, day);
  }

  const logged = billable + nonBillable;
  let expectedTotal = 0;
  for (const h of expected.values()) expectedTotal += h;

  const clients: ClientCoverage[] = [...byClient.values()]
    .map((c) => ({
      clientId: c.clientId,
      clientName: c.name,
      billableHours: round2(c.billable),
      nonBillableHours: round2(c.non),
      totalHours: round2(c.billable + c.non),
      sharePct: pct(c.billable + c.non, logged) ?? 0,
      nonBillablePerBillableHour: ratio(c.non, c.billable),
    }))
    .sort(
      (a, b) =>
        b.totalHours - a.totalHours || a.clientName.localeCompare(b.clientName),
    );

  const days: DayCoverage[] = [...expected.keys()].sort().map((date) => {
    const exp = expected.get(date) ?? 0;
    const d = byDay.get(date) ?? { logged: 0, billable: 0 };
    return {
      date,
      expectedHours: round2(exp),
      loggedHours: round2(d.logged),
      billableHours: round2(d.billable),
      coveragePct: pct(d.logged, exp),
    };
  });

  return {
    expectedHours: round2(expectedTotal),
    loggedHours: round2(logged),
    billableHours: round2(billable),
    nonBillableHours: round2(nonBillable),
    coveragePct: pct(logged, expectedTotal),
    billableCoveragePct: pct(billable, expectedTotal),
    nonBillableCoveragePct: pct(nonBillable, expectedTotal),
    billableSharePct: pct(billable, logged),
    nonBillablePerBillableHour: ratio(nonBillable, billable),
    clients,
    days,
  };
}

/**
 * Dækningsgrad "indtil nu" for en igangværende periode: kun dage til og med
 * `today`, så ugens/månedens resterende arbejdstid ikke får tallet til at
 * se lavt ud midt i perioden.
 */
export function coverageToDate(
  days: readonly DayCoverage[],
  today: string,
): { expectedHours: number; loggedHours: number; coveragePct: number | null } {
  let expected = 0;
  let logged = 0;
  for (const d of days) {
    if (d.date > today) continue;
    expected += d.expectedHours;
    logged += d.loggedHours;
  }
  return {
    expectedHours: round2(expected),
    loggedHours: round2(logged),
    coveragePct: pct(logged, expected),
  };
}

/**
 * Skal der sendes påmindelse? Kun når der var arbejdstid på dagen og den
 * loggede tid er under tærsklen (procent). Uden tærskel: aldrig.
 */
export function isBelowCoverageThreshold(
  loggedHours: number,
  expectedHours: number,
  thresholdPct: number | null | undefined,
): boolean {
  if (thresholdPct == null || thresholdPct <= 0) return false;
  if (!(expectedHours > 0)) return false;
  return (loggedHours / expectedHours) * 100 < thresholdPct;
}
