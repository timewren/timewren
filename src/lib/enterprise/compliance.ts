import { toIntlLocale } from "@/i18n/format-locale";
import { currentSyncLocale, syncT } from "@/i18n/sync-text";
/**
 * Danish work time compliance calculations (L68 / EU Working Time Directive).
 *
 * Covers:
 * - 48-hour weekly average rule (reference period)
 * - 11-hour daily rest requirement
 * - 24-hour weekly rest requirement
 *
 * Fravær (E11, #469, #728): godkendte hele fraværsdage gives som
 * `absenceDates` og er pr. definition hvile (ingen hvile-overtrædelse kan
 * opstå hen over en hel fraværsdag). I 48 t-gennemsnittet er fravær
 * NEUTRALT: arbejdstidslovens § 4, 2. pkt. (LBK nr. 982 af 12/08/2024) —
 * "Perioder med årlig betalt ferie og perioder med sygeorlov medtages ikke
 * i eller er neutrale i forhold til beregningen af gennemsnittet" (direktiv
 * 2003/88/EF art. 16, litra b). Neutrale dage tages ud af både tæller og
 * nævner (`neutralAbsenceDates`, default = `absenceDates`). Se
 * docs/COMPLIANCE-TIDSREGISTRERINGSLOV.md.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface WeeklyAverageResult {
  averageHoursPerWeek: number;
  status: "ok" | "warning" | "violation";
  weeksInPeriod: number;
  totalHours: number;
}

export interface DailyRestViolation {
  date: string;
  previousEndTime: Date;
  nextStartTime: Date;
  restHours: number;
}

export interface WeeklyRestViolation {
  weekStart: string;
  maxConsecutiveRestHours: number;
}

/** Dag hvor dagsummen overstiger 13 t (poster uden klokkeslæt — heuristik for 11 t hvile). */
export interface LongDayViolation {
  date: string;
  hours: number;
}

export interface ComplianceResult {
  exempt: boolean;
  weeklyAverage: WeeklyAverageResult;
  dailyRestViolations: DailyRestViolation[];
  weeklyRestViolations: WeeklyRestViolation[];
  /** Dagsum-heuristik: > 13 t på en dag uden en dokumenteret hvile-overtrædelse */
  longDays: LongDayViolation[];
  overallStatus: "ok" | "warning" | "violation";
}

/** Org-indstilling pr. regel: off (ignorér), warn (advar), block (afvis). */
export type ComplianceRuleMode = "off" | "warn" | "block";
export const COMPLIANCE_RULE_MODES = ["off", "warn", "block"] as const;

export type ComplianceRule = "48h" | "daily_rest" | "weekly_rest";

export interface ComplianceRuleSettings {
  rule48h: ComplianceRuleMode;
  dailyRest: ComplianceRuleMode;
  weeklyRest: ComplianceRuleMode;
}

export const DEFAULT_COMPLIANCE_RULE_SETTINGS: ComplianceRuleSettings = {
  rule48h: "warn",
  dailyRest: "warn",
  weeklyRest: "warn",
};

export const COMPLIANCE_RULE_LABELS: Record<ComplianceRule, string> = {
  "48h": "48 timers gennemsnit",
  daily_rest: "11 timers daglig hvile",
  weekly_rest: "24 timers ugentlig hvile",
};

/** Grænser (timer) — dagsum-heuristikken: 24 − 11 = 13 t. */
export const LIMIT_WEEKLY_AVERAGE = 48;
export const WARN_WEEKLY_AVERAGE = 45;
export const LIMIT_DAILY_REST = 11;
export const LIMIT_DAY_SUM = 13;
export const LIMIT_WEEKLY_REST = 24;

export interface ComplianceFinding {
  rule: ComplianceRule;
  severity: "warning" | "violation";
  /** Dato (eller ugens mandag for ugeregler), YYYY-MM-DD */
  date: string;
  /** Målt værdi (timer) */
  value: number;
  /** Grænsen der gælder (timer) */
  limit: number;
  /** Dansk besked til toast/banner/fejl */
  message: string;
}

export interface ComplianceEvaluation {
  /** false = mindst én regel i block-tilstand er overtrådt */
  allowed: boolean;
  /** Beskeder for blokerende overtrædelser */
  blocked: string[];
  /** Beskeder for advarsler (warn-tilstand eller "nærmer sig"-niveau) */
  warnings: string[];
  findings: ComplianceFinding[];
}

export interface TimeEntry {
  startTime?: Date | null;
  endTime?: Date | null;
  /** Duration in hours — used as fallback when start/end times are missing */
  hours?: number;
}

/** Post i vurderingsvinduet — `date` er dagen (lokal), timer som fallback uden klokkeslæt. */
export interface DatedTimeEntry extends TimeEntry {
  date: string;
}

export interface Employee {
  isSelfScheduler?: boolean;
}

/** Indstillinger til getComplianceStatus m.fl. */
export interface ComplianceContext {
  /** Godkendte hele fraværsdage (YYYY-MM-DD) — hvile i hvilereglerne */
  absenceDates?: Iterable<string>;
  /**
   * Fraværsdage der er neutrale i 48 t-gennemsnittet (§ 4: ferie, sygdom —
   * konservativt også barsel/orlov, omsorg m.m.; IKKE afspadsering).
   * Udeladt = alle `absenceDates`.
   */
  neutralAbsenceDates?: Iterable<string>;
  /** Dagsummer pr. dato (YYYY-MM-DD → timer) til > 13 t-heuristikken */
  dayTotals?: Readonly<Record<string, number>>;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Get ISO week key "YYYY-Www" for a date. Weeks start on Monday. */
function getISOWeekKey(date: Date): string {
  // Copy to avoid mutation
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  // Set to nearest Thursday (ISO week rule)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Get Monday 00:00 for the ISO week containing `date`. */
function getWeekStart(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  // Monday = 1, Sunday = 0 → offset
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDaysStr(date: string, days: number): string {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
}

function formatHours(value: number): string {
  return value.toLocaleString(toIntlLocale(currentSyncLocale()), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatDayDa(date: string): string {
  const d = parseLocalDate(date);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60);
}

/**
 * Arbejdstimer for en post: `hours` (netto, fx efter pausefradrag) når sat,
 * ellers start→slut-spændet. Hvile måles altid på klokkeslættene.
 */
function entryHours(entry: TimeEntry): number {
  if (entry.hours != null) return entry.hours;
  if (entry.startTime && entry.endTime) {
    return hoursBetween(entry.startTime, entry.endTime);
  }
  return 0;
}

// ─── Core functions ──────────────────────────────────────────────────

/** Hverdage pr. uge som en neutral fraværsdag udgør en andel af (man–fre). */
const NEUTRAL_DAYS_PER_WEEK = 5;

/**
 * Calculate the rolling weekly average over a reference period.
 * Groups entries by ISO week and divides total hours by number of weeks.
 *
 * Neutralt fravær (arbejdstidslovens § 4, 2. pkt., #728) indgår hverken i
 * tælleren eller nævneren: hver neutral hverdag (man–fre) uden registreret
 * arbejde trækker 1/5 uge fra nævneren, så en hel ferieuge tæller 0 uger og
 * 2 sygedage 2/5 uge. Timer registreret på en fraværsdag tæller altid, og
 * dagen er så ikke neutral. Referenceperioden forlænges ikke — gennemsnittet
 * beregnes over den arbejdede del af perioden ("medtages ikke i").
 *
 * @param entries - Time entries with at least `startTime` or `hours`
 * @param context - `absenceDates` udvider spændet; neutrale dage trækkes
 *   fra nævneren
 */
export function calculate48hWeeklyAverage(
  entries: TimeEntry[],
  context: ComplianceContext = {},
): WeeklyAverageResult {
  const absenceDates = Array.from(context.absenceDates ?? []);
  if (entries.length === 0 && absenceDates.length === 0) {
    return {
      averageHoursPerWeek: 0,
      status: "ok",
      weeksInPeriod: 0,
      totalHours: 0,
    };
  }

  // Group by ISO week
  const weekMap = new Map<string, number>();
  const dates: Date[] = [];
  // Dage med registreret arbejde pr. uge (til neutral-reglen)
  const workedDays = new Set<string>();
  const workedDaysByWeek = new Map<string, Set<string>>();

  for (const entry of entries) {
    const date = entry.startTime ?? entry.endTime;
    if (!date) continue;

    dates.push(date);
    const weekKey = getISOWeekKey(date);
    const hours = entryHours(entry);
    weekMap.set(weekKey, (weekMap.get(weekKey) ?? 0) + hours);
    if (hours > 0) {
      const day = toLocalDateStr(date);
      workedDays.add(day);
      const set = workedDaysByWeek.get(weekKey) ?? new Set<string>();
      set.add(day);
      workedDaysByWeek.set(weekKey, set);
    }
  }
  // Fraværsdage: 0 timer; de afgrænser spændet, men neutrale dage trækkes
  // fra nævneren nedenfor
  for (const absence of absenceDates) {
    const d = parseLocalDate(absence);
    if (Number.isNaN(d.getTime())) continue;
    dates.push(d);
    const weekKey = getISOWeekKey(d);
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, 0);
  }

  if (dates.length === 0) {
    return {
      averageHoursPerWeek: 0,
      status: "ok",
      weeksInPeriod: 0,
      totalHours: 0,
    };
  }

  let totalHours = 0;
  for (const hours of weekMap.values()) {
    totalHours += hours;
  }

  // Nævneren er antal ISO-uger fra første til sidste dag, begge inklusive
  // (mandag uge 1 → mandag uge 2 = 2 uger — ikke spændet i dage / 7).
  // Uger uden data tæller med, som direktivets referenceperiode.
  const earliest = new Date(Math.min(...dates.map((d) => d.getTime())));
  const latest = new Date(Math.max(...dates.map((d) => d.getTime())));
  const msInWeek = 7 * 24 * 60 * 60 * 1000;
  const spanWeeks = Math.max(
    1,
    Math.round(
      (getWeekStart(latest).getTime() - getWeekStart(earliest).getTime()) /
        msInWeek,
    ) + 1,
  );

  // Neutrale hverdage uden registreret arbejde, pr. uge
  const neutralByWeek = new Map<string, number>();
  for (const absence of new Set(context.neutralAbsenceDates ?? absenceDates)) {
    const d = parseLocalDate(absence);
    if (Number.isNaN(d.getTime())) continue;
    const weekday = d.getDay();
    if (weekday === 0 || weekday === 6) continue;
    if (workedDays.has(absence)) continue;
    if (d < getWeekStart(earliest) || d > latest) continue;
    const weekKey = getISOWeekKey(d);
    neutralByWeek.set(weekKey, (neutralByWeek.get(weekKey) ?? 0) + 1);
  }
  let neutralWeeks = 0;
  for (const [weekKey, count] of neutralByWeek) {
    const share =
      Math.min(count, NEUTRAL_DAYS_PER_WEEK) / NEUTRAL_DAYS_PER_WEEK;
    // En uge tæller mindst med de dage, der faktisk er arbejdet (weekend-
    // arbejde i en ferieuge) — aldrig division med nul når der er timer
    const floor = (workedDaysByWeek.get(weekKey)?.size ?? 0) / 7;
    neutralWeeks += Math.min(share, 1 - floor);
  }
  const weeksInPeriod = Math.max(0, spanWeeks - neutralWeeks);

  if (weeksInPeriod <= 0) {
    return {
      averageHoursPerWeek: 0,
      status: "ok",
      weeksInPeriod: 0,
      totalHours: Math.round(totalHours * 100) / 100,
    };
  }

  const averageHoursPerWeek =
    Math.round((totalHours / weeksInPeriod) * 100) / 100;

  let status: "ok" | "warning" | "violation";
  if (averageHoursPerWeek >= LIMIT_WEEKLY_AVERAGE) {
    status = "violation";
  } else if (averageHoursPerWeek >= WARN_WEEKLY_AVERAGE) {
    status = "warning";
  } else {
    status = "ok";
  }

  return {
    averageHoursPerWeek,
    status,
    weeksInPeriod: Math.round(weeksInPeriod * 100) / 100,
    totalHours: Math.round(totalHours * 100) / 100,
  };
}

/**
 * Find days where the rest period between consecutive work sessions
 * is less than 11 hours (Danish/EU requirement).
 *
 * Only processes entries that have both `startTime` AND `endTime`.
 */
export function findDailyRestViolations(
  entries: TimeEntry[],
): DailyRestViolation[] {
  // Filter to entries with both start and end
  const valid = entries.filter(
    (e): e is TimeEntry & { startTime: Date; endTime: Date } =>
      e.startTime != null && e.endTime != null,
  );

  if (valid.length < 2) return [];

  // Sort by startTime ascending
  valid.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const violations: DailyRestViolation[] = [];

  for (let i = 0; i < valid.length - 1; i++) {
    const current = valid[i];
    const next = valid[i + 1];

    const restHours = hoursBetween(current.endTime, next.startTime);

    if (restHours < LIMIT_DAILY_REST) {
      violations.push({
        date: toLocalDateStr(next.startTime),
        previousEndTime: current.endTime,
        nextStartTime: next.startTime,
        restHours: Math.round(restHours * 100) / 100,
      });
    }
  }

  return violations;
}

/**
 * Check that each 7-day period contains at least one 24-hour continuous
 * rest period (Danish/EU requirement).
 *
 * Groups entries by ISO week and for each week calculates the maximum gap
 * between consecutive work sessions (including gap before first session
 * from week start and after last session to week end).
 *
 * Uger med en hel fraværsdag (`context.absenceDates`) har pr. definition
 * mindst 24 t hvile og springes over.
 */
export function findWeeklyRestViolations(
  entries: TimeEntry[],
  context: ComplianceContext = {},
): WeeklyRestViolation[] {
  // Filter to entries with both start and end
  const valid = entries.filter(
    (e): e is TimeEntry & { startTime: Date; endTime: Date } =>
      e.startTime != null && e.endTime != null,
  );

  if (valid.length === 0) return [];

  const absenceWeeks = new Set<string>();
  for (const absence of context.absenceDates ?? []) {
    const d = parseLocalDate(absence);
    if (!Number.isNaN(d.getTime())) absenceWeeks.add(getISOWeekKey(d));
  }

  // Group by ISO week
  const weekEntries = new Map<
    string,
    Array<{ startTime: Date; endTime: Date }>
  >();

  for (const entry of valid) {
    const weekKey = getISOWeekKey(entry.startTime);
    const bucket = weekEntries.get(weekKey);
    if (bucket) bucket.push(entry);
    else weekEntries.set(weekKey, [entry]);
  }

  const violations: WeeklyRestViolation[] = [];

  for (const [weekKey, weekEnts] of weekEntries) {
    if (absenceWeeks.has(weekKey)) continue;
    // Sort by start time
    weekEnts.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    const weekStart = getWeekStart(weekEnts[0].startTime);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Calculate gaps
    let maxGapHours = 0;

    // Gap from week start to first entry
    const gapBefore = hoursBetween(weekStart, weekEnts[0].startTime);
    maxGapHours = Math.max(maxGapHours, gapBefore);

    // Gaps between consecutive entries
    for (let i = 0; i < weekEnts.length - 1; i++) {
      const gap = hoursBetween(weekEnts[i].endTime, weekEnts[i + 1].startTime);
      maxGapHours = Math.max(maxGapHours, gap);
    }

    // Gap from last entry to week end
    const gapAfter = hoursBetween(
      weekEnts[weekEnts.length - 1].endTime,
      weekEnd,
    );
    maxGapHours = Math.max(maxGapHours, gapAfter);

    if (maxGapHours < LIMIT_WEEKLY_REST) {
      violations.push({
        weekStart: toLocalDateStr(weekStart),
        maxConsecutiveRestHours: Math.round(maxGapHours * 100) / 100,
      });
    }
  }

  return violations;
}

/**
 * Dagsummer pr. lokal dato. Poster med klokkeslæt bidrager med start→slut-
 * varigheden, øvrige med `hours`.
 */
export function sumHoursByDay(
  entries: DatedTimeEntry[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const e of entries) {
    const h = entryHours(e);
    if (h <= 0) continue;
    totals[e.date] = Math.round(((totals[e.date] ?? 0) + h) * 100) / 100;
  }
  return totals;
}

/**
 * Dagsum-heuristik for 11 t hvile: > 13 t registreret på én kalenderdag
 * levner under 11 t hvile i det døgn. Bruges for poster uden klokkeslæt
 * (timeseddel-celler). Dage med en dokumenteret hvile-overtrædelse
 * (`skipDates`) udelades, så samme dag ikke tælles to gange.
 */
export function findLongDays(
  dayTotals: Readonly<Record<string, number>>,
  skipDates: Iterable<string> = [],
): LongDayViolation[] {
  const skip = new Set(skipDates);
  return Object.entries(dayTotals)
    .filter(([date, hours]) => !skip.has(date) && hours > LIMIT_DAY_SUM + 0.005)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hours]) => ({ date, hours: Math.round(hours * 100) / 100 }));
}

/**
 * Combined compliance check for an employee.
 *
 * If the employee is a self-scheduler (arbejdstidslovens § 1, stk. 6), returns exempt=true
 * with no violations. Otherwise runs all checks and returns the worst status.
 */
export function getComplianceStatus(
  employee: Employee,
  entries: TimeEntry[],
  context: ComplianceContext = {},
): ComplianceResult {
  if (employee.isSelfScheduler) {
    return {
      exempt: true,
      weeklyAverage: {
        averageHoursPerWeek: 0,
        status: "ok",
        weeksInPeriod: 0,
        totalHours: 0,
      },
      dailyRestViolations: [],
      weeklyRestViolations: [],
      longDays: [],
      overallStatus: "ok",
    };
  }

  const weeklyAverage = calculate48hWeeklyAverage(entries, context);
  const dailyRestViolations = findDailyRestViolations(entries);
  const weeklyRestViolations = findWeeklyRestViolations(entries, context);
  const longDays = findLongDays(
    context.dayTotals ?? {},
    dailyRestViolations.map((v) => v.date),
  );

  // Determine overall status: worst of all checks
  let overallStatus: "ok" | "warning" | "violation" = weeklyAverage.status;

  if (
    dailyRestViolations.length > 0 ||
    weeklyRestViolations.length > 0 ||
    longDays.length > 0
  ) {
    overallStatus = "violation";
  }

  return {
    exempt: false,
    weeklyAverage,
    dailyRestViolations,
    weeklyRestViolations,
    longDays,
    overallStatus,
  };
}

// ─── Runtime-evaluering ved registrering (E11, #469) ─────────────────

export interface EvaluateEntryInput {
  settings: ComplianceRuleSettings;
  isSelfScheduler?: boolean;
  /**
   * Den nye/ændrede registrering. Udeladt = vurdér ugen `weekStart` som den
   * står (bruges ved indsend af timeseddel).
   */
  candidate?: {
    date: string;
    hours: number;
    startTime?: Date | null;
    endTime?: Date | null;
  };
  /** Mandag i ugen der vurderes (default: kandidatens uge) */
  weekStart?: string;
  /** Eksisterende poster i referenceperioden — UDEN dem kandidaten erstatter */
  entries: DatedTimeEntry[];
  /** Godkendte fraværsdage i referenceperioden */
  absenceDates?: Iterable<string>;
  /** Neutrale fraværsdage til 48 t-gennemsnittet (default: `absenceDates`) */
  neutralAbsenceDates?: Iterable<string>;
}

function weekStartStr(date: string): string {
  return toLocalDateStr(getWeekStart(parseLocalDate(date)));
}

function pushFinding(
  out: ComplianceEvaluation,
  mode: ComplianceRuleMode,
  finding: ComplianceFinding,
): void {
  if (mode === "off") return;
  out.findings.push(finding);
  if (mode === "block" && finding.severity === "violation") {
    out.allowed = false;
    out.blocked.push(finding.message);
  } else {
    out.warnings.push(finding.message);
  }
}

/**
 * Vurdér ALLE tre regler for en ny/ændret registrering (eller en hel uge)
 * mod org'ens off/warn/block-indstilling. Ren funktion — DB-laget i
 * compliance-guard.ts samler input.
 *
 *  - 48 t: gennemsnit over referenceperioden inkl. kandidaten (≥ 48 =
 *    overtrædelse, ≥ 45 = advarsel); derudover advares altid når ugen alene
 *    passerer 48 t, så medarbejderen får signalet før gennemsnittet vipper.
 *  - 11 t hvile: med klokkeslæt måles hvilen mellem sessioner; uden
 *    klokkeslæt bruges dagsummen (> 13 t).
 *  - 24 t ugehvile: med klokkeslæt måles længste sammenhængende pause i
 *    ugen; uden klokkeslæt: registreringer på alle 7 dage uden fraværsdag.
 */
export function evaluateEntryCompliance(
  input: EvaluateEntryInput,
): ComplianceEvaluation {
  const out: ComplianceEvaluation = {
    allowed: true,
    blocked: [],
    warnings: [],
    findings: [],
  };
  const { settings, candidate } = input;
  if (input.isSelfScheduler) return out;
  if (
    settings.rule48h === "off" &&
    settings.dailyRest === "off" &&
    settings.weeklyRest === "off"
  ) {
    return out;
  }

  const weekStart =
    input.weekStart ?? (candidate ? weekStartStr(candidate.date) : null);
  if (!weekStart) return out;
  const weekDays = new Set(
    Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i)),
  );
  const absenceDates = new Set(input.absenceDates ?? []);

  const all: DatedTimeEntry[] = candidate
    ? [
        ...input.entries,
        {
          date: candidate.date,
          hours: candidate.hours,
          startTime: candidate.startTime ?? null,
          endTime: candidate.endTime ?? null,
        },
      ]
    : [...input.entries];

  // Til 48 t-gennemsnittet skal poster uden klokkeslæt ligge i en uge —
  // brug dagens dato som "startTime" for dem.
  const forAverage: TimeEntry[] = all.map((e) =>
    e.startTime
      ? e
      : {
          hours: entryHours(e),
          startTime: parseLocalDate(e.date),
          endTime: null,
        },
  );
  const dayTotals = sumHoursByDay(all);

  // ── 48 t ──
  if (settings.rule48h !== "off") {
    const avg = calculate48hWeeklyAverage(forAverage, {
      absenceDates,
      neutralAbsenceDates: input.neutralAbsenceDates,
    });
    const weekTotal = Array.from(weekDays).reduce(
      (sum, d) => sum + (dayTotals[d] ?? 0),
      0,
    );
    if (avg.status === "violation") {
      pushFinding(out, settings.rule48h, {
        rule: "48h",
        severity: "violation",
        date: weekStart,
        value: avg.averageHoursPerWeek,
        limit: LIMIT_WEEKLY_AVERAGE,
        message: syncT("enterprise.rule.avgViolation", {
          avg: formatHours(avg.averageHoursPerWeek),
          limit: LIMIT_WEEKLY_AVERAGE,
        }),
      });
    } else if (avg.status === "warning") {
      pushFinding(out, settings.rule48h, {
        rule: "48h",
        severity: "warning",
        date: weekStart,
        value: avg.averageHoursPerWeek,
        limit: LIMIT_WEEKLY_AVERAGE,
        message: syncT("enterprise.rule.avgWarning", {
          avg: formatHours(avg.averageHoursPerWeek),
          limit: LIMIT_WEEKLY_AVERAGE,
        }),
      });
    } else if (weekTotal > LIMIT_WEEKLY_AVERAGE + 0.005) {
      pushFinding(out, settings.rule48h, {
        rule: "48h",
        severity: "warning",
        date: weekStart,
        value: Math.round(weekTotal * 100) / 100,
        limit: LIMIT_WEEKLY_AVERAGE,
        message: syncT("enterprise.rule.weekInfo", {
          week: formatHours(weekTotal),
          limit: LIMIT_WEEKLY_AVERAGE,
        }),
      });
    }
  }

  // ── 11 t daglig hvile ──
  if (settings.dailyRest !== "off") {
    const relevantDates = candidate
      ? new Set([candidate.date, addDaysStr(candidate.date, 1)])
      : weekDays;
    const timedViolations = findDailyRestViolations(all).filter((v) =>
      relevantDates.has(v.date),
    );
    for (const v of timedViolations) {
      pushFinding(out, settings.dailyRest, {
        rule: "daily_rest",
        severity: "violation",
        date: v.date,
        value: v.restHours,
        limit: LIMIT_DAILY_REST,
        message: syncT("enterprise.rule.restBefore", {
          rest: formatHours(v.restHours),
          day: formatDayDa(v.date),
          limit: LIMIT_DAILY_REST,
        }),
      });
    }
    const checkDates = candidate ? [candidate.date] : Array.from(weekDays);
    const skip = new Set(timedViolations.map((v) => v.date));
    for (const date of checkDates) {
      if (skip.has(date)) continue;
      const total = dayTotals[date] ?? 0;
      if (total > LIMIT_DAY_SUM + 0.005) {
        pushFinding(out, settings.dailyRest, {
          rule: "daily_rest",
          severity: "violation",
          date,
          value: Math.round(total * 100) / 100,
          limit: LIMIT_DAY_SUM,
          message: syncT("enterprise.rule.daySum", {
            total: formatHours(total),
            day: formatDayDa(date),
            limit: LIMIT_DAILY_REST,
            max: LIMIT_DAY_SUM,
          }),
        });
      }
    }
  }

  // ── 24 t ugentlig hvile ──
  if (settings.weeklyRest !== "off") {
    const weekHasAbsence = Array.from(weekDays).some((d) =>
      absenceDates.has(d),
    );
    if (!weekHasAbsence) {
      const weekEntries = all.filter((e) => weekDays.has(e.date));
      const timed = weekEntries.filter((e) => e.startTime && e.endTime);
      const allTimed =
        weekEntries.length > 0 && timed.length === weekEntries.length;
      if (allTimed) {
        const violation = findWeeklyRestViolations(timed, {
          absenceDates,
        }).find((v) => v.weekStart === weekStart);
        if (violation) {
          pushFinding(out, settings.weeklyRest, {
            rule: "weekly_rest",
            severity: "violation",
            date: weekStart,
            value: violation.maxConsecutiveRestHours,
            limit: LIMIT_WEEKLY_REST,
            message: syncT("enterprise.rule.weeklyRest", {
              day: formatDayDa(weekStart),
              rest: formatHours(violation.maxConsecutiveRestHours),
              limit: LIMIT_WEEKLY_REST,
            }),
          });
        }
      } else {
        const workedDays = Array.from(weekDays).filter(
          (d) => (dayTotals[d] ?? 0) > 0.005,
        ).length;
        if (workedDays >= 7) {
          pushFinding(out, settings.weeklyRest, {
            rule: "weekly_rest",
            severity: "violation",
            date: weekStart,
            value: 0,
            limit: LIMIT_WEEKLY_REST,
            message: syncT("enterprise.rule.noFreeDay", {
              day: formatDayDa(weekStart),
            }),
          });
        }
      }
    }
  }

  return out;
}
