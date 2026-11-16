// Normperiode og flexsaldo (#507). Rene funktioner — DB-laget ligger i
// ./norm-period-load. Datoer er danske kalenderdatoer ("yyyy-MM-dd").
//
// Dagsreglerne spejler flex-motoren (recalculateFlexDay i ./flex), så
// periodesaldoen og den daglige flex-ledger tæller ens:
//  - normen på en dag er dagsnormen fra ansættelseshistorikken (deltid er
//    allerede indregnet via ugetimerne) eller arbejdsplanens timer (#510);
//  - en hel fridag/helligdag (#526) giver 0, en halv giver det halve;
//  - godkendt fravær på en dag uden fridag giver 0 (ferie og andet fravær
//    holdes adskilt i opgørelsen);
//  - registreret tid er tidsposterne — på en plandag afvigelsen, ellers
//    mindst planens timer.
// Med en årsnorm (fx 1924 t for undervisere) fordeles bruttonormen i stedet
// ligeligt på normårets arbejdsdage, ganget med beskæftigelsesgraden.

import {
  addDaysToDateStr,
  addMonthsToDateStr,
  isoWeekdayOfDateStr,
  monthStartDateStr,
  weekStartDateStr,
} from "@/lib/time/copenhagen";
import { isoWeekNumber } from "./week";

export const NORM_PERIODS = ["week", "month", "quarter", "year"] as const;
export type NormPeriod = (typeof NORM_PERIODS)[number];

export const NORM_PERIOD_LABELS: Record<NormPeriod, string> = {
  week: "Uge",
  month: "Måned",
  quarter: "Kvartal",
  year: "År",
};

export const NORM_YEAR_STARTS = ["calendar", "school"] as const;
export type NormYearStart = (typeof NORM_YEAR_STARTS)[number];

export const NORM_YEAR_START_LABELS: Record<NormYearStart, string> = {
  calendar: "Kalenderår (1. januar)",
  school: "Skoleår (1. august)",
};

const YEAR_START_MONTH: Record<NormYearStart, number> = {
  calendar: 1,
  school: 8,
};

export interface FlexNormSettings {
  period: NormPeriod;
  yearStart: NormYearStart;
  /** Årsnorm for fuld tid i timer; null = dagsnorm/arbejdsplan */
  annualHours: number | null;
  /** Største plus der overføres til næste periode (null = intet loft) */
  carryoverMaxHours: number | null;
  /** Største minus der overføres (positivt tal; null = intet loft) */
  carryoverMaxDeficitHours: number | null;
  /** Første dag i saldoen; null = indeværende periodes start */
  startDate: string | null;
}

export const DEFAULT_FLEX_NORM_SETTINGS: FlexNormSettings = {
  period: "week",
  yearStart: "calendar",
  annualHours: null,
  carryoverMaxHours: null,
  carryoverMaxDeficitHours: null,
  startDate: null,
};

export const FLEX_NORM_PRESETS = ["standard", "teachers"] as const;
export type FlexNormPreset = (typeof FLEX_NORM_PRESETS)[number];

export const FLEX_NORM_PRESET_DEFS: Record<
  FlexNormPreset,
  {
    label: string;
    description: string;
    settings: Pick<FlexNormSettings, "period" | "yearStart" | "annualHours">;
  }
> = {
  standard: {
    label: "37 t/uge (standard)",
    description:
      "Normen er medarbejderens dagsnorm (37 t/uge ved fuld tid) eller arbejdsplan, og saldoen gøres op hver uge.",
    settings: { period: "week", yearStart: "calendar", annualHours: null },
  },
  teachers: {
    label: "Undervisere, årsnorm 1924 t",
    description:
      "Normperioden er skoleåret (1/8–31/7) med en årsnorm på 1924 t ved fuld tid. Ferie, helligdage og andet fravær trækkes fra.",
    settings: { period: "year", yearStart: "school", annualHours: 1924 },
  },
};

export function isNormPeriod(v: unknown): v is NormPeriod {
  return (NORM_PERIODS as readonly unknown[]).includes(v);
}

export function isNormYearStart(v: unknown): v is NormYearStart {
  return (NORM_YEAR_STARTS as readonly unknown[]).includes(v);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Perioder ────────────────────────────────────────────────────────────────

export interface DateBounds {
  start: string;
  end: string;
}

function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

/** Perioden (begge ender inkl.) der indeholder datoen. */
export function normPeriodBounds(
  period: NormPeriod,
  yearStart: NormYearStart,
  date: string,
): DateBounds {
  if (period === "week") {
    const start = weekStartDateStr(date);
    return { start, end: addDaysToDateStr(start, 6) };
  }
  const first = monthStartDateStr(date);
  let months = 1;
  let back = 0;
  if (period !== "month") {
    const offset = (monthOf(date) - YEAR_START_MONTH[yearStart] + 12) % 12;
    months = period === "quarter" ? 3 : 12;
    back = offset % months;
  }
  const start = addMonthsToDateStr(first, -back);
  return {
    start,
    end: addDaysToDateStr(addMonthsToDateStr(start, months), -1),
  };
}

/** Perioderne der overlapper [from, to], i rækkefølge. */
export function periodsInRange(
  period: NormPeriod,
  yearStart: NormYearStart,
  from: string,
  to: string,
): DateBounds[] {
  const out: DateBounds[] = [];
  let cursor = from;
  while (cursor <= to) {
    const b = normPeriodBounds(period, yearStart, cursor);
    out.push(b);
    cursor = addDaysToDateStr(b.end, 1);
  }
  return out;
}

/** Kort dansk etiket: "uge 40 2026", "oktober 2026", "4. kvt. 2026", "2026/27". */
export function formatPeriodLabel(
  period: NormPeriod,
  yearStart: NormYearStart,
  bounds: DateBounds,
): string {
  const year = Number(bounds.start.slice(0, 4));
  const month = monthOf(bounds.start);
  if (period === "week") {
    const [y, m, d] = bounds.start.split("-").map(Number);
    // Ugeåret er torsdagens år (uge 1 kan starte i december)
    const weekYear = addDaysToDateStr(bounds.start, 3).slice(0, 4);
    return `uge ${isoWeekNumber(new Date(y, m - 1, d))} ${weekYear}`;
  }
  if (period === "month") return `${DANISH_MONTHS[month - 1]} ${year}`;
  if (period === "quarter") {
    if (yearStart === "calendar") {
      return `${Math.floor((month - 1) / 3) + 1}. kvt. ${year}`;
    }
    return `${DANISH_MONTHS[month - 1].slice(0, 3)}.–${DANISH_MONTHS[(month + 1) % 12].slice(0, 3)}. ${year}`;
  }
  return yearStart === "calendar"
    ? String(year)
    : `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}

const DANISH_MONTHS = [
  "januar",
  "februar",
  "marts",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "december",
];

// ─── Dage ────────────────────────────────────────────────────────────────────

export type AbsenceKind = "vacation" | "other";

export interface NormDayInput {
  date: string;
  /** null = ikke ansat på dagen */
  employment: {
    dailyNorm: number;
    workingDays: readonly string[];
    /** Beskæftigelsesgrad (ugetimer / org'ens fuldtids-ugetimer) */
    grade: number;
  } | null;
  /** Arbejdsplan (#510): onPlan = planen gælder; hours null = fri i planen */
  plan?: { onPlan: boolean; hours: number | null } | null;
  dayOff?: { isHalfDay: boolean } | null;
  absence?: AbsenceKind | null;
  /** Sum af dagens tidsposter */
  entryHours: number;
  /** Afvigelse fra planen (#510) — dagens faktiske arbejdstid */
  deviationHours?: number | null;
  /** Årsnorm: bruttonorm pr. arbejdsdag ved fuld tid (annualHours / dage) */
  annualGrossPerWorkday?: number | null;
}

export interface NormDay {
  date: string;
  employed: boolean;
  grade: number;
  /** Bruttonorm (før fridage og fravær) */
  gross: number;
  daysOff: number;
  vacation: number;
  otherAbsence: number;
  /** Nettonorm = brutto − fridage − ferie − andet fravær */
  net: number;
  registered: number;
}

/** Normen og den registrerede tid for én dag (se reglerne øverst). */
export function computeNormDay(input: NormDayInput): NormDay {
  const emp = input.employment;
  const onPlan = !!emp && !!input.plan?.onPlan;
  let base = 0;
  if (emp) {
    if (onPlan) base = input.plan?.hours ?? 0;
    else if (emp.workingDays.includes(String(isoWeekdayOfDateStr(input.date))))
      base = emp.dailyNorm;
  }

  // Årsnorm: bruttonormen fordeles på arbejdsdagene; plandage bruger planen
  let gross = base;
  if (emp && !onPlan && input.annualGrossPerWorkday != null) {
    gross = base > 0 ? input.annualGrossPerWorkday * emp.grade : 0;
  }

  // Fridage og fravær trækker dagens bruttonorm fra (ved årsnorm altså den
  // fordelte dagsandel, så en fridag giver netto 0 — ikke et minus)
  let daysOff = 0;
  let vacation = 0;
  let otherAbsence = 0;
  if (gross > 0) {
    // Fravær dækker arbejdsnormen, der er tilbage efter fridagen.
    if (input.dayOff) daysOff = input.dayOff.isHalfDay ? gross / 2 : gross;
    if (input.absence === "vacation") vacation = gross - daysOff;
    else if (input.absence) otherAbsence = gross - daysOff;
  }

  // Plandage har altid gross = base (planens timer)
  const dayNet = gross - daysOff - vacation - otherAbsence;
  const registered =
    input.deviationHours != null
      ? input.deviationHours
      : onPlan
        ? Math.max(input.entryHours, dayNet)
        : input.entryHours;

  return {
    date: input.date,
    employed: !!emp,
    grade: emp?.grade ?? 0,
    gross,
    daysOff,
    vacation,
    otherAbsence,
    net: gross - daysOff - vacation - otherAbsence,
    registered,
  };
}

/** Antal datoer i [start, end] hvis ISO-ugedag er i `workingDays`. */
export function countWorkdays(
  start: string,
  end: string,
  workingDays: readonly string[],
): number {
  const set = new Set(workingDays);
  if (set.size === 0) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDaysToDateStr(d, 1)) {
    if (set.has(String(isoWeekdayOfDateStr(d)))) n++;
  }
  return n;
}

// ─── Summer og saldo ─────────────────────────────────────────────────────────

export interface NormTotals {
  gross: number;
  daysOff: number;
  vacation: number;
  otherAbsence: number;
  net: number;
  registered: number;
  /** Timer flyttet til overtidssaldoen — tæller ikke i flex */
  earnedOvertime: number;
  /** registreret − nettonorm − optjent overtid */
  flex: number;
  vacationDays: number;
  otherAbsenceDays: number;
  /** Gennemsnitlig beskæftigelsesgrad på ansatte dage (0 uden) */
  grade: number;
}

export const EMPTY_TOTALS: NormTotals = {
  gross: 0,
  daysOff: 0,
  vacation: 0,
  otherAbsence: 0,
  net: 0,
  registered: 0,
  earnedOvertime: 0,
  flex: 0,
  vacationDays: 0,
  otherAbsenceDays: 0,
  grade: 0,
};

/**
 * Summér dagene i [from, to]. Med `today` tæller dage efter i dag ikke, og
 * i dag tæller kun med den del af normen, der allerede er arbejdet — så
 * saldoen ikke står i minus om morgenen.
 */
export function sumNormDays(
  days: readonly NormDay[],
  opts: {
    from: string;
    to: string;
    today?: string;
    /** false = i dag tæller fuldt (fx en afsluttet periodes sidste dag) */
    partialToday?: boolean;
    earnedOvertimeByDate?: ReadonlyMap<string, number>;
  },
): NormTotals {
  const partial = opts.partialToday ?? true;
  const t = { ...EMPTY_TOTALS };
  let gradeSum = 0;
  let employedDays = 0;
  for (const d of days) {
    if (d.date < opts.from || d.date > opts.to) continue;
    if (opts.today && d.date > opts.today) continue;
    let net = d.net;
    let gross = d.gross;
    if (partial && opts.today && d.date === opts.today && d.registered < net) {
      gross -= net - d.registered;
      net = d.registered;
    }
    t.gross += gross;
    t.daysOff += d.daysOff;
    t.vacation += d.vacation;
    t.otherAbsence += d.otherAbsence;
    t.net += net;
    t.registered += d.registered;
    if (d.vacation > 0) t.vacationDays++;
    if (d.otherAbsence > 0) t.otherAbsenceDays++;
    if (d.employed) {
      gradeSum += d.grade;
      employedDays++;
    }
  }
  if (opts.earnedOvertimeByDate) {
    for (const [date, hours] of opts.earnedOvertimeByDate) {
      if (date < opts.from || date > opts.to) continue;
      if (opts.today && date > opts.today) continue;
      t.earnedOvertime += hours;
    }
  }
  t.flex = t.registered - t.net - t.earnedOvertime;
  return {
    gross: round2(t.gross),
    daysOff: round2(t.daysOff),
    vacation: round2(t.vacation),
    otherAbsence: round2(t.otherAbsence),
    net: round2(t.net),
    registered: round2(t.registered),
    earnedOvertime: round2(t.earnedOvertime),
    flex: round2(t.flex),
    vacationDays: t.vacationDays,
    otherAbsenceDays: t.otherAbsenceDays,
    grade: employedDays > 0 ? round2(gradeSum / employedDays) : 0,
  };
}

/** Overførsel efter org-reglen: plus/minus klippes til lofterne. */
export function applyCarryover(
  balance: number,
  settings: Pick<
    FlexNormSettings,
    "carryoverMaxHours" | "carryoverMaxDeficitHours"
  >,
): { carryOut: number; cutOff: number } {
  let carryOut = balance;
  if (
    settings.carryoverMaxHours != null &&
    carryOut > settings.carryoverMaxHours
  )
    carryOut = settings.carryoverMaxHours;
  if (
    settings.carryoverMaxDeficitHours != null &&
    carryOut < -settings.carryoverMaxDeficitHours
  )
    carryOut = -settings.carryoverMaxDeficitHours;
  return { carryOut: round2(carryOut), cutOff: round2(balance - carryOut) };
}

export interface PeriodBalance extends DateBounds {
  label: string;
  /** Perioden er slut (end < today) */
  closed: boolean;
  /** Saldo overført fra forrige periode */
  carryIn: number;
  /** Til og med i dag (hele perioden når den er slut) */
  totals: NormTotals;
  /** Nettonorm for hele perioden (inkl. fremtidige dage) */
  periodNet: number;
  /** carryIn + flex */
  balance: number;
  /** Kun for afsluttede perioder: det der overføres og det der skæres af */
  carryOut: number | null;
  cutOff: number | null;
}

/** Første dag i saldoen: startdatoen, ellers indeværende periodes start. */
export function balanceStart(
  settings: FlexNormSettings,
  today: string,
): string {
  if (settings.startDate && settings.startDate <= today) {
    return settings.startDate;
  }
  return normPeriodBounds(settings.period, settings.yearStart, today).start;
}

/**
 * Løbende saldo pr. periode fra saldoens start til og med perioden der
 * indeholder `today`. `days` skal dække [balanceStart, periodens slut].
 */
export function buildPeriodBalances(
  days: readonly NormDay[],
  settings: FlexNormSettings,
  today: string,
  earnedOvertimeByDate?: ReadonlyMap<string, number>,
  opts?: { partialToday?: boolean },
): PeriodBalance[] {
  const start = balanceStart(settings, today);
  const periods = periodsInRange(
    settings.period,
    settings.yearStart,
    start,
    today,
  );
  const out: PeriodBalance[] = [];
  let carryIn = 0;
  for (const p of periods) {
    const from = p.start < start ? start : p.start;
    const closed = p.end < today;
    const totals = sumNormDays(days, {
      from,
      to: p.end,
      today: closed ? undefined : today,
      partialToday: opts?.partialToday,
      earnedOvertimeByDate,
    });
    const periodNet = sumNormDays(days, { from, to: p.end }).net;
    const balance = round2(carryIn + totals.flex);
    const carry = closed ? applyCarryover(balance, settings) : null;
    out.push({
      start: p.start,
      end: p.end,
      label: formatPeriodLabel(settings.period, settings.yearStart, p),
      closed,
      carryIn: round2(carryIn),
      totals,
      periodNet,
      balance,
      carryOut: carry?.carryOut ?? null,
      cutOff: carry?.cutOff ?? null,
    });
    if (carry) carryIn = carry.carryOut;
  }
  return out;
}
