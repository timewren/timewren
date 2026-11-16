import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { syncT } from "@/i18n/sync-text";
import * as schema from "@/lib/db/schema";
import { toLocalDateStr } from "@/lib/format";
import { resolveUserLabel } from "@/lib/org-audit";
import { copenhagenToday } from "@/lib/time/copenhagen";
import {
  employmentIntervals,
  loadEmploymentPeriodsForUser,
} from "./employment";
import {
  lastDayOfMonth,
  periodLabelFor,
  type VacationPeriod,
  vacationPeriodFor,
} from "./vacation-period";

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Calculate vacation days between two dates, excluding weekends and holidays,
 * accounting for half-days on start/end.
 *
 * @param startDate - YYYY-MM-DD
 * @param endDate - YYYY-MM-DD
 * @param halfDayStart - true if start date is a half day
 * @param halfDayEnd - true if end date is a half day
 * @param holidays - Set of YYYY-MM-DD holiday dates to exclude
 * @returns Number of working days (with half-day deductions)
 */
export function calculateVacationDays(
  startDate: string,
  endDate: string,
  halfDayStart: boolean,
  halfDayEnd: boolean,
  holidays: Set<string>,
): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  let count = 0;

  const current = new Date(start);
  while (current <= end) {
    const dateStr = toLocalDateStr(current);
    const dayOfWeek = current.getDay(); // 0=Sun, 6=Sat

    // Skip weekends and holidays
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.has(dateStr)) {
      let dayValue = 1;

      const isFirstDay = current.getTime() === start.getTime();
      const isLastDay = current.getTime() === end.getTime();

      if (isFirstDay && isLastDay) {
        // Single day request
        if (halfDayStart || halfDayEnd) {
          dayValue = 0.5;
        }
      } else if (isFirstDay && halfDayStart) {
        dayValue = 0.5;
      } else if (isLastDay && halfDayEnd) {
        dayValue = 0.5;
      }

      count += dayValue;
    }

    current.setDate(current.getDate() + 1);
  }

  return count;
}

/**
 * Apply conversion factor for part-time/flexjob employees.
 * For full-time (37h/week), factor = 1.0
 * For flexjob (e.g. 22.5h/week), factor = 37/22.5 = 1.644
 *
 * Vacation days deducted = working days * conversionFactor
 */
export function applyConversionFactor(
  workingDays: number,
  conversionFactor: number,
): number {
  return Math.round(workingDays * conversionFactor * 100) / 100;
}

/**
 * Calculate the conversion factor from weekly hours. Fuldtidsnormen er
 * org'ens defaultWeeklyHours (dansk standard 37) — send den med, så
 * faktoren ikke drifter fra org-indstillingen.
 */
export function calculateConversionFactor(
  weeklyHours: number,
  fullTimeWeeklyHours = 37,
): number {
  if (weeklyHours <= 0) return 1;
  const fullTime = fullTimeWeeklyHours > 0 ? fullTimeWeeklyHours : 37;
  return fullTime / weeklyHours;
}

function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// ─── Ferieår, puljer og saldo ───────────────────────────────────────────────

/** Feriepulje: "vacation" = ferie (25 dage), "extra" = feriefridage (6. uge). */
export type VacationPool = "vacation" | "extra";

export const VACATION_POOL_LABELS: Record<VacationPool, string> = {
  vacation: "Ferie",
  extra: "Feriefridage",
};

export function toVacationPool(value: string | null | undefined): VacationPool {
  return value === "extra" ? "extra" : "vacation";
}

// ─── Org-indstillinger for ferieår og optjening (#461) ──────────────────────

export const VACATION_ACCRUAL_MODES = ["upfront", "monthly"] as const;
export type VacationAccrualMode = (typeof VACATION_ACCRUAL_MODES)[number];

export const VACATION_ACCRUAL_MODE_LABELS: Record<VacationAccrualMode, string> =
  {
    upfront: "Tildelt ved ferieårets start",
    monthly: "Løbende optjening (2,08 dage/md)",
  };

/** Ferielovens samtidighedsferie: 2,08 dage pr. måneds ansættelse. */
export const MONTHLY_ACCRUAL_DAYS = 2.08;

export type VacationOrgSettings = {
  /** 1 = kalenderår (freelance-default), 9 = ferielovens 1/9–31/8 */
  yearStartMonth: number;
  accrualMode: VacationAccrualMode;
  /** Maks. dage der overføres til næste ferieår (ferieloven: 5) */
  carryOverMaxDays: number;
  /** Rest ud over loftet udbetales (true) eller fortabes (false) */
  payOutRemaining: boolean;
  /** Fuldtids-ugetimer — skaleringsgrundlag for optjening (2,08 × FTE) */
  defaultWeeklyHours: number;
  /**
   * Dato (YYYY-MM-DD) for seneste skift af model/ferieår-start (#532).
   * Catch-up af måneds-optjening går aldrig længere tilbage — måneder før
   * skiftet dækkes af en 'opening'-postering. null = ingen grænse.
   */
  settingsChangedAt: string | null;
};

export const DEFAULT_VACATION_ORG_SETTINGS: VacationOrgSettings = {
  yearStartMonth: 1,
  accrualMode: "upfront",
  carryOverMaxDays: 5,
  payOutRemaining: false,
  defaultWeeklyHours: 37,
  settingsChangedAt: null,
};

export function toVacationAccrualMode(
  value: string | null | undefined,
): VacationAccrualMode {
  return value === "monthly" ? "monthly" : "upfront";
}

export async function getVacationOrgSettings(
  db: PostgresJsDatabase<typeof schema>,
  orgId: string,
): Promise<VacationOrgSettings> {
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
    columns: {
      vacationYearStartMonth: true,
      vacationAccrualMode: true,
      vacationCarryOverMaxDays: true,
      vacationPayOutRemaining: true,
      defaultWeeklyHours: true,
      vacationSettingsChangedAt: true,
    },
  });
  if (!org) return DEFAULT_VACATION_ORG_SETTINGS;
  const startMonth = Number(org.vacationYearStartMonth ?? 1);
  return {
    yearStartMonth:
      Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12
        ? startMonth
        : 1,
    accrualMode: toVacationAccrualMode(org.vacationAccrualMode),
    carryOverMaxDays: Math.max(0, Number(org.vacationCarryOverMaxDays ?? 5)),
    payOutRemaining: Boolean(org.vacationPayOutRemaining),
    defaultWeeklyHours: Number(org.defaultWeeklyHours ?? 37) || 37,
    settingsChangedAt: org.vacationSettingsChangedAt
      ? toLocalDateStr(org.vacationSettingsChangedAt)
      : null,
  };
}

// ─── Ferieår-perioder ───────────────────────────────────────────────────────
// Ren implementation i vacation-period.ts (deles med E4's rapportlag, som
// også kører i klienten). Re-eksporteres her for eksisterende kald.

export {
  nextVacationPeriod,
  periodLabelFor,
  type VacationPeriod,
  vacationPeriodFor,
  vacationPeriodForYear,
  vacationYearOf,
} from "./vacation-period";

/**
 * Pro rata-tildeling for ansatte der starter midt i ferieåret.
 *
 * Regel: der optjenes for hele måneder — starter man den 1. i en måned tæller
 * måneden med, ellers tælles fra og med den følgende måned. Kalenderår: start
 * 1/1 → 12/12, start 1/8 → 5/12, start 15/8 → 4/12 (sep–dec). Resultatet
 * afrundes til nærmeste halve dag. Start før perioden → fuld pulje; start
 * efter perioden → 0.
 */
export function proRataForPeriod(
  fullYearDays: number,
  startDate: string | null | undefined,
  period: Pick<VacationPeriod, "start" | "end">,
): number {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return fullYearDays;
  }
  if (startDate <= period.start) return fullYearDays;
  if (startDate > period.end) return 0;
  const startMonth = Number.parseInt(period.start.slice(5, 7), 10);
  const month = Number.parseInt(startDate.slice(5, 7), 10);
  const day = Number.parseInt(startDate.slice(8, 10), 10);
  const monthIndex = (month - startMonth + 12) % 12;
  const remainingMonths = 12 - monthIndex - (day === 1 ? 0 : 1);
  return Math.round(((fullYearDays * remainingMonths) / 12) * 2) / 2;
}

/** Kalenderår-variant af proRataForPeriod (bevaret for eksisterende kald/tests). */
export function proRataVacationDays(
  fullYearDays: number,
  startDate: string | null | undefined,
  year: number,
): number {
  return proRataForPeriod(fullYearDays, startDate, {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  });
}

// ─── Løbende optjening ──────────────────────────────────────────────────────

/**
 * Optjening pr. måned: flat 2,08 dage uanset timetal (ferieloven — en
 * deltidsansats feriedag er bare kortere). Saldoen er i DAGE; timeværdien
 * af en dag er calculateDailyNorm og bruges kun til løn/rapport.
 */
export function monthlyAccrualDays(rate = MONTHLY_ACCRUAL_DAYS): number {
  return Math.round(rate * 100) / 100;
}

/**
 * Faktor for fradrag ved afholdelse. Monthly-orgs: saldoen er i dage og
 * 1 feriedag koster præcis 1 dag (faktor 1) — ellers dobbelt-skaleres
 * deltid (optjening OG fradrag). Upfront-orgs (freelance/legacy) beholder
 * den eksisterende FTE-konvertering (fuldtidsnorm / ugetimer), så
 * eksisterende kunders tal er uændrede.
 */
export function vacationDeductionFactor(
  settings: Pick<VacationOrgSettings, "accrualMode" | "defaultWeeklyHours">,
  weeklyHours: number,
): number {
  if (settings.accrualMode === "monthly") return 1;
  return calculateConversionFactor(weeklyHours, settings.defaultWeeklyHours);
}

/** Måneden ('YYYY-MM') før den måned `date` ligger i. */
export function previousMonthKey(date: string): string {
  const y = Number.parseInt(date.slice(0, 4), 10);
  const m = Number.parseInt(date.slice(5, 7), 10);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}

/** Sidste dag i måneden 'YYYY-MM' som YYYY-MM-DD. */
export function monthEndDate(monthKey: string): string {
  const y = Number.parseInt(monthKey.slice(0, 4), 10);
  const m = Number.parseInt(monthKey.slice(5, 7), 10);
  return `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}`;
}

/**
 * Måneder ('YYYY-MM') i ferieåret der er FÆRDIG-optjent pr. `asOf`: måneden
 * skal være afsluttet (månedens sidste dag < asOf), og medarbejderen skal
 * have været ansat hele måneden (startdato d. 1. tæller måneden med, ellers
 * fra næste måned; fratrædelse før månedens udgang tæller ikke). Bruges til
 * catch-up når en periode åbnes i monthly-mode, og af måneds-cronen.
 */
export function accruedMonthsInPeriod(
  period: Pick<VacationPeriod, "start" | "end">,
  asOf: string,
  employeeStart?: string | null,
  employeeEnd?: string | null,
): string[] {
  return accruedMonthsForIntervals(period, asOf, [
    { start: employeeStart ?? null, end: employeeEnd ?? null },
  ]);
}

/**
 * Som accruedMonthsInPeriod, men med ansættelseshistorik (#465): måneden
 * tæller hvis ÉT sammenhængende ansættelsesinterval dækker hele måneden.
 * Optjeningen er flat 2,08 uanset timetal — en FTE-ændring midt i måneden
 * påvirker ikke optjeningen, kun et hul i ansættelsen gør.
 *
 * `notBefore` (#532) afgrænser catch-up: måneder der begynder før datoen
 * tæller ikke (org'en skiftede til monthly midt i ferieåret — resten ligger
 * i en 'opening'-postering). Måneden hvor der skiftes d. 1. tæller med.
 */
export function accruedMonthsForIntervals(
  period: Pick<VacationPeriod, "start" | "end">,
  asOf: string,
  intervals: ReadonlyArray<{ start: string | null; end: string | null }>,
  notBefore?: string | null,
): string[] {
  const months: string[] = [];
  let y = Number.parseInt(period.start.slice(0, 4), 10);
  let m = Number.parseInt(period.start.slice(5, 7), 10);
  const endKey = period.end.slice(0, 7);
  for (let i = 0; i < 12; i++) {
    const key = `${y}-${pad2(m)}`;
    if (key > endKey) break;
    const monthStart = `${key}-01`;
    const monthEnd = monthEndDate(key);
    const completed = monthEnd < asOf;
    const afterBound = !notBefore || monthStart >= notBefore;
    const employedWholeMonth = intervals.some(
      (iv) =>
        (!iv.start || iv.start <= monthStart) &&
        (!iv.end || iv.end >= monthEnd),
    );
    if (completed && afterBound && employedWholeMonth) months.push(key);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

// ─── Årsskifte ──────────────────────────────────────────────────────────────

export type RolloverPlan = {
  /** Dage der overføres til næste ferieår (negativ rest følger med) */
  carry: number;
  /** Dage der fortabes */
  forfeited: number;
  /** Dage der udbetales */
  paidOut: number;
};

/**
 * Fordel restsaldoen ved ferieårets udløb: min(rest, loft) overføres, resten
 * udbetales eller fortabes. Negativ rest (tilladt overtræk) følger med som
 * negativ overførsel, så gælden ikke forsvinder.
 */
export function planRollover(
  remaining: number,
  carryOverMaxDays: number,
  payOutRemaining: boolean,
): RolloverPlan {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const rest = round2(remaining);
  if (rest <= 0) return { carry: rest, forfeited: 0, paidOut: 0 };
  const carry = round2(Math.min(rest, Math.max(0, carryOverMaxDays)));
  const leftover = round2(rest - carry);
  return {
    carry,
    forfeited: payOutRemaining ? 0 : leftover,
    paidOut: payOutRemaining ? leftover : 0,
  };
}

// ─── Ledger-projektion ──────────────────────────────────────────────────────

export const VACATION_LEDGER_TYPES = [
  "earned",
  "opening",
  "used",
  "reversed",
  "carried_over",
  "paid_out",
  "forfeited",
  "adjustment",
] as const;
export type VacationLedgerType = (typeof VACATION_LEDGER_TYPES)[number];

export const VACATION_LEDGER_TYPE_LABELS: Record<VacationLedgerType, string> = {
  earned: "Optjent",
  opening: "Åbningssaldo",
  used: "Afholdt",
  reversed: "Tilbageført",
  carried_over: "Overført",
  paid_out: "Udbetalt",
  forfeited: "Fortabt",
  adjustment: "Justering",
};

export type VacationLedgerRefType =
  | "absence_request"
  | "closure"
  | "cron"
  | "rollover"
  | "period_open"
  | "migration"
  | "manual";

export type PoolProjection = {
  earned: number;
  /** Overført IND fra forrige ferieår (signeret — negativ ved overtræk) */
  carriedIn: number;
  /** Overført UD til næste ferieår, som positivt tal (negativ ved overtræk) */
  carriedOut: number;
  adjustments: number;
  paidOut: number;
  forfeited: number;
  /** Afholdt minus tilbageført, klippet ved 0 */
  used: number;
  /** earned + carriedIn − carriedOut + adjustments − paidOut − forfeited */
  total: number;
  /** total − used (kan være negativ ved tilladt overtræk) */
  remaining: number;
};

export type BalanceProjection = Record<VacationPool, PoolProjection>;

function emptyProjection(): PoolProjection {
  return {
    earned: 0,
    carriedIn: 0,
    carriedOut: 0,
    adjustments: 0,
    paidOut: 0,
    forfeited: 0,
    used: 0,
    total: 0,
    remaining: 0,
  };
}

/**
 * Saldo som projektion af ledger-poster. Semantik (spejler applyBalanceDelta):
 * total = earned + opening + carried_over(signeret) + adjustment(signeret) −
 * paid_out − forfeited; used = max(0, used − reversed); remaining = total − used.
 */
export function projectVacationBalance(
  entries: Array<{
    pool: string | null;
    entryType: string;
    days: number | string;
    /** carried_over: true = ind (effective_date = ferieårets start), false = ud */
    atPeriodStart?: boolean | null;
  }>,
): BalanceProjection {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const acc: Record<VacationPool, PoolProjection & { usedRaw: number }> = {
    vacation: { ...emptyProjection(), usedRaw: 0 },
    extra: { ...emptyProjection(), usedRaw: 0 },
  };
  for (const e of entries) {
    const p = acc[toVacationPool(e.pool)];
    const days = Number(e.days) || 0;
    switch (e.entryType) {
      case "earned":
      // Åbningssaldo ved modelskift (#532) — restsaldoen fra den gamle
      // periode indgår som optjent i den nye, så total/rest er korrekte.
      case "opening":
        p.earned += days;
        break;
      case "carried_over": {
        // Retning afgøres af posteringsdatoen (ind = ved periodens start),
        // ikke fortegnet — negativ rest overføres som negativ "ind"/"ud".
        const incoming =
          e.atPeriodStart == null ? days >= 0 : Boolean(e.atPeriodStart);
        if (incoming) p.carriedIn += days;
        else p.carriedOut += -days;
        break;
      }
      case "adjustment":
        p.adjustments += days;
        break;
      case "paid_out":
        p.paidOut += days;
        break;
      case "forfeited":
        p.forfeited += days;
        break;
      case "used":
        p.usedRaw += days;
        break;
      case "reversed":
        p.usedRaw -= days;
        break;
      default:
        break;
    }
  }
  const out = {} as BalanceProjection;
  for (const pool of ["vacation", "extra"] as const) {
    const p = acc[pool];
    const total = round2(
      p.earned +
        p.carriedIn -
        p.carriedOut +
        p.adjustments -
        p.paidOut -
        p.forfeited,
    );
    const used = Math.max(0, round2(p.usedRaw));
    out[pool] = {
      earned: round2(p.earned),
      carriedIn: round2(p.carriedIn),
      carriedOut: round2(p.carriedOut),
      adjustments: round2(p.adjustments),
      paidOut: round2(p.paidOut),
      forfeited: round2(p.forfeited),
      used,
      total,
      remaining: round2(total - used),
    };
  }
  return out;
}

// ─── Saldo-guard ────────────────────────────────────────────────────────────

/**
 * Saldo-guard med tolerance (#437). `overdraft` er org'ens tilladte overtræk
 * i dage (0 = intet). Tillader registreringen hvis den resulterende saldo er
 * ≥ −overdraft; `warning` er sat når saldoen ender negativ (men inden for
 * tolerancen), så UI'et kan vise en gul advarsel.
 */
export function evaluateVacationGuard(
  remaining: number,
  deducted: number,
  overdraft: number,
): { allowed: boolean; warning: boolean; resulting: number } {
  const resulting = Math.round((remaining - deducted) * 100) / 100;
  const allowed = resulting >= -Math.max(0, overdraft) - 1e-9;
  return { allowed, warning: allowed && resulting < 0, resulting };
}

/** Dansk fejlbesked når saldo-guarden afviser. */
export function vacationGuardMessage(
  pool: VacationPool,
  remaining: number,
  deducted: number,
  overdraft: number,
): string {
  const fmt = (n: number) => n.toFixed(1).replace(".", ",");
  const tolerance =
    overdraft > 0
      ? syncT("enterprise.vacation.overdraftAllowed", { days: fmt(overdraft) })
      : syncT("enterprise.vacation.overdraftNotAllowed");
  return syncT("enterprise.vacation.notEnough", {
    pool: VACATION_POOL_LABELS[pool],
    remaining: fmt(remaining),
    deducted: fmt(deducted),
    tolerance,
  });
}

/**
 * Count working days between two dates, excluding non-working weekdays and
 * full-day holidays, capping half-day holidays at 0.5. Supports half-day
 * start/end without a second halving. Delt af absence-routeren,
 * lukkeperioder (#436) og timesedlen.
 */
export function countWorkingDays(
  startDate: string,
  endDate: string,
  workingDays: string[],
  holidayDates: string[],
  startHalf: "full" | "morning" | "afternoon",
  endHalf: "full" | "morning" | "afternoon",
  halfDayHolidayDates: readonly string[] = [],
  maxDayFraction = 1,
): number {
  const halfDayHolidaySet = new Set(halfDayHolidayDates);
  const holidaySet = new Set(holidayDates);
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  let count = 0;
  const current = new Date(start);

  while (current <= end) {
    const dateStr = toLocalDateStr(current);
    const isoDay = current.getDay() === 0 ? "7" : String(current.getDay());

    if (workingDays.includes(isoDay) && !holidaySet.has(dateStr)) {
      let dayValue = 1;
      const isFirstDay = current.getTime() === start.getTime();
      const isLastDay = current.getTime() === end.getTime();

      if (isFirstDay && isLastDay) {
        if (startHalf !== "full" || endHalf !== "full") dayValue = 0.5;
      } else if (isFirstDay && startHalf !== "full") {
        dayValue = 0.5;
      } else if (isLastDay && endHalf !== "full") {
        dayValue = 0.5;
      }

      count += Math.min(
        dayValue,
        halfDayHolidaySet.has(dateStr) ? 0.5 : 1,
        maxDayFraction,
      );
    }

    current.setDate(current.getDate() + 1);
  }

  return count;
}

// ─── Saldo-rækker (projektion i vacation_balances) ──────────────────────────

export type VacationBalanceSnapshot = {
  id: string;
  year: number;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  rolledOverAt: Date | null;
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  extraTotalDays: number;
  extraUsedDays: number;
  extraRemainingDays: number;
};

function toSnapshot(
  row: typeof schema.vacationBalances.$inferSelect,
): VacationBalanceSnapshot {
  return {
    id: row.id,
    year: row.year,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    periodLabel: periodLabelFor(row.periodStart),
    rolledOverAt: row.rolledOverAt ?? null,
    totalDays: Number(row.totalDays),
    usedDays: Number(row.usedDays),
    remainingDays: Number(row.remainingDays),
    extraTotalDays: Number(row.extraTotalDays),
    extraUsedDays: Number(row.extraUsedDays),
    extraRemainingDays: Number(row.extraRemainingDays),
  };
}

type Db = PostgresJsDatabase<typeof schema>;

/** Åbningssaldo pr. pulje når en periode åbnes ved modelskift (#532). */
export type VacationOpeningBalance = {
  vacation: number;
  extra: number;
  note?: string | null;
  createdBy?: string | null;
};

export type VacationLedgerInput = {
  userId: string;
  orgId: string;
  pool: VacationPool;
  entryType: VacationLedgerType;
  /** Signeret antal dage (used/reversed/paid_out/forfeited altid ≥ 0) */
  days: number;
  effectiveDate: string;
  vacationYearStart: string;
  refType?: VacationLedgerRefType;
  refId?: string | null;
  note?: string | null;
  createdBy?: string | null;
};

/**
 * Postér én ledger-linje. System-referencer (cron/rollover/period_open/
 * migration) er beskyttet af et unikt indeks, så gentagne kørsler er no-ops.
 * Returnerer true hvis linjen blev indsat. userLabel er et tekst-snapshot af
 * medarbejderen (#499), så posteringen forbliver læsbar efter brugersletning.
 */
export async function postVacationLedger(
  tx: Db,
  entry: VacationLedgerInput,
): Promise<boolean> {
  // Ikke-finite dage (NaN/Infinity fra en defekt konverteringsfaktor) må
  // aldrig nå SQL — numeric-kolonnen ville fejle kryptisk eller gemme skrald (#457)
  if (!Number.isFinite(entry.days)) {
    throw new Error(`Ugyldigt antal feriedage: ${String(entry.days)}`);
  }
  const userLabel = await resolveUserLabel(tx, entry.userId);
  const inserted = await tx
    .insert(schema.vacationLedger)
    .values({
      organizationId: entry.orgId,
      userId: entry.userId,
      userLabel,
      pool: entry.pool,
      entryType: entry.entryType,
      days: (Math.round(entry.days * 100) / 100).toFixed(2),
      effectiveDate: entry.effectiveDate,
      vacationYearStart: entry.vacationYearStart,
      refType: entry.refType ?? null,
      refId: entry.refId ?? null,
      note: entry.note ?? null,
      createdBy: entry.createdBy ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.vacationLedger.id });
  return inserted.length > 0;
}

/** Ledger-summer pr. pulje/type for én periode — grundlaget for projektionen. */
export async function loadLedgerProjection(
  db: Db,
  userId: string,
  orgId: string,
  periodStart: string,
): Promise<BalanceProjection> {
  const vl = schema.vacationLedger;
  const rows = await db
    .select({
      pool: vl.pool,
      entryType: vl.entryType,
      days: sql<string>`COALESCE(SUM(${vl.days}), 0)`,
      atPeriodStart: sql<boolean>`${vl.effectiveDate} = ${vl.vacationYearStart}`,
    })
    .from(vl)
    .where(
      and(
        eq(vl.userId, userId),
        eq(vl.organizationId, orgId),
        eq(vl.vacationYearStart, periodStart),
      ),
    )
    .groupBy(
      vl.pool,
      vl.entryType,
      sql`${vl.effectiveDate} = ${vl.vacationYearStart}`,
    );
  return projectVacationBalance(rows);
}

/**
 * Genberegn vacation_balances-rækken for perioden fra ledgeren (kilde til
 * sandhed). Kaldes i samme tx som posteringen. Rækken skal findes
 * (ensureVacationPeriod).
 */
export async function recomputeVacationBalance(
  tx: Db,
  userId: string,
  orgId: string,
  periodStart: string,
): Promise<VacationBalanceSnapshot> {
  const vb = schema.vacationBalances;
  // Lås saldo-rækken FØR summen læses: to samtidige tx'er (fx godkend +
  // annullér for samme medarbejder) serialiseres her, og den ventende ser
  // den andens committede ledger-poster når den selv summerer (READ
  // COMMITTED giver hvert statement et frisk snapshot). Uden låsen kunne
  // den sidste UPDATE overskrive projektionen med en forældet sum.
  await tx
    .select({ id: vb.id })
    .from(vb)
    .where(
      and(
        eq(vb.userId, userId),
        eq(vb.organizationId, orgId),
        eq(vb.periodStart, periodStart),
      ),
    )
    .for("update");
  const projection = await loadLedgerProjection(tx, userId, orgId, periodStart);
  const [row] = await tx
    .update(vb)
    .set({
      totalDays: projection.vacation.total.toFixed(2),
      usedDays: projection.vacation.used.toFixed(2),
      remainingDays: projection.vacation.remaining.toFixed(2),
      extraTotalDays: projection.extra.total.toFixed(2),
      extraUsedDays: projection.extra.used.toFixed(2),
      extraRemainingDays: projection.extra.remaining.toFixed(2),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(vb.userId, userId),
        eq(vb.organizationId, orgId),
        eq(vb.periodStart, periodStart),
      ),
    )
    .returning();
  if (!row) {
    throw new Error(
      "Feriesaldo-perioden findes ikke — kald ensureVacationPeriod",
    );
  }
  return toSnapshot(row);
}

/**
 * Postér måneds-optjening ('earned', ref cron/YYYY-MM, flat 2,08) for de givne måneder.
 * Idempotent via det unikke system-ref-indeks. Returnerer antal nye poster.
 * Kalder IKKE recompute — det gør kalderen én gang bagefter.
 */
export async function postMonthlyAccruals(
  tx: Db,
  params: {
    userId: string;
    orgId: string;
    period: Pick<VacationPeriod, "start" | "end">;
    months: string[];
  },
): Promise<number> {
  const days = monthlyAccrualDays();
  if (days <= 0) return 0;
  let inserted = 0;
  for (const month of params.months) {
    const ok = await postVacationLedger(tx, {
      userId: params.userId,
      orgId: params.orgId,
      pool: "vacation",
      entryType: "earned",
      days,
      effectiveDate: monthEndDate(month),
      vacationYearStart: params.period.start,
      refType: "cron",
      refId: month,
      note: `Optjent for ${month}`,
    });
    if (ok) inserted++;
  }
  return inserted;
}

/**
 * Sørg for at der findes en saldo-periode for bruger/org/dato ud fra org'ens
 * ferieår-start, og returnér den. Oprettes on-demand med åbningsposter i
 * ledgeren:
 *  - feriefridage (extra): hele puljen pro rata ved periodens start (begge modes)
 *  - ferie (vacation), upfront: hele puljen pro rata som 'earned'
 *  - ferie, monthly: catch-up af allerede afsluttede måneder (2,08 × FTE)
 *    fra max(periodens start, org'ens settingsChangedAt, ansættelsesstart)
 *    (#532), resten posteres af måneds-cronen (api/cron/vacation-accrual)
 *  - `opening` (#532, modelskift midt i et ferieår): perioden åbnes med én
 *    'opening'-postering pr. pulje = den angivne rest — INGEN tildeling/
 *    catch-up, den gamle periodes saldo er flyttet over
 * Saldo-kolonnerne sættes som projektion af ledgeren.
 */
export async function ensureVacationPeriod(
  db: Db,
  userId: string,
  orgId: string,
  date: string,
  settings?: VacationOrgSettings,
  options: { opening?: VacationOpeningBalance | null } = {},
): Promise<VacationBalanceSnapshot> {
  const cfg = settings ?? (await getVacationOrgSettings(db, orgId));
  const period = vacationPeriodFor(date, cfg.yearStartMonth);
  const where = and(
    eq(schema.vacationBalances.userId, userId),
    eq(schema.vacationBalances.organizationId, orgId),
    eq(schema.vacationBalances.periodStart, period.start),
  );
  const existing = await db.query.vacationBalances.findFirst({ where });
  if (existing) return toSnapshot(existing);

  const inserted = await db
    .insert(schema.vacationBalances)
    .values({
      organizationId: orgId,
      userId,
      year: period.year,
      periodStart: period.start,
      periodEnd: period.end,
      totalDays: "0",
      usedDays: "0",
      remainingDays: "0",
      extraTotalDays: "0",
      extraUsedDays: "0",
      extraRemainingDays: "0",
    })
    .onConflictDoNothing({
      target: [
        schema.vacationBalances.userId,
        schema.vacationBalances.organizationId,
        schema.vacationBalances.periodStart,
      ],
    })
    .returning({ id: schema.vacationBalances.id });

  if (inserted.length === 0) {
    // Oprettet samtidig af en anden transaktion — brug dens række
    const raced = await db.query.vacationBalances.findFirst({ where });
    if (!raced) throw new Error("Kunne ikke oprette feriesaldo");
    return toSnapshot(raced);
  }

  const profile = await db.query.employeeProfiles.findFirst({
    where: and(
      eq(schema.employeeProfiles.userId, userId),
      eq(schema.employeeProfiles.organizationId, orgId),
    ),
    columns: {
      vacationDaysPerYear: true,
      extraVacationDaysPerYear: true,
      startDate: true,
      endDate: true,
    },
  });

  if (options.opening) {
    for (const pool of ["vacation", "extra"] as const) {
      const days = Math.round(options.opening[pool] * 100) / 100;
      if (days === 0) continue;
      await postVacationLedger(db, {
        userId,
        orgId,
        pool,
        entryType: "opening",
        days,
        effectiveDate: period.start,
        vacationYearStart: period.start,
        refType: "period_open",
        refId: period.start,
        note: options.opening.note ?? "Åbningssaldo ved skift af feriemodel",
        createdBy: options.opening.createdBy ?? null,
      });
    }
    return recomputeVacationBalance(db, userId, orgId, period.start);
  }

  const extra = proRataForPeriod(
    Number(profile?.extraVacationDaysPerYear ?? 5),
    profile?.startDate,
    period,
  );
  if (extra > 0) {
    await postVacationLedger(db, {
      userId,
      orgId,
      pool: "extra",
      entryType: "earned",
      days: extra,
      effectiveDate: period.start,
      vacationYearStart: period.start,
      refType: "period_open",
      refId: period.start,
      note: "Feriefridage tildelt ved ferieårets start",
    });
  }

  if (cfg.accrualMode === "monthly") {
    // Ansættelseshistorik (#465): hele måneder inden for et sammenhængende
    // ansættelsesforhold — fratrædelse/genansættelse respekteres
    const months = accruedMonthsForIntervals(
      period,
      copenhagenToday(),
      employmentIntervals(
        await loadEmploymentPeriodsForUser(db, userId, orgId),
        profile,
      ),
      cfg.settingsChangedAt,
    );
    await postMonthlyAccruals(db, { userId, orgId, period, months });
  } else {
    const total = proRataForPeriod(
      profile?.vacationDaysPerYear ?? 25,
      profile?.startDate,
      period,
    );
    if (total > 0) {
      await postVacationLedger(db, {
        userId,
        orgId,
        pool: "vacation",
        entryType: "earned",
        days: total,
        effectiveDate: period.start,
        vacationYearStart: period.start,
        refType: "period_open",
        refId: period.start,
        note: "Ferie tildelt ved ferieårets start",
      });
    }
  }

  return recomputeVacationBalance(db, userId, orgId, period.start);
}

/**
 * Sørg for at saldo-perioden findes og lås den (SELECT … FOR UPDATE) i den
 * igangværende transaktion, så saldo-guard + fradrag serialiseres på tværs
 * af samtidige anmodninger (#452). Returnerer det låste, friske snapshot.
 * SKAL kaldes med en transaktion — uden for en tx er låsen virkningsløs.
 */
export async function lockVacationBalance(
  tx: Db,
  userId: string,
  orgId: string,
  date: string,
  settings?: VacationOrgSettings,
): Promise<VacationBalanceSnapshot> {
  const ensured = await ensureVacationPeriod(tx, userId, orgId, date, settings);
  const vb = schema.vacationBalances;
  const rows = await tx
    .select()
    .from(vb)
    .where(
      and(
        eq(vb.userId, userId),
        eq(vb.organizationId, orgId),
        eq(vb.periodStart, ensured.periodStart),
      ),
    )
    .for("update");
  if (!rows[0]) {
    throw new Error("Kunne ikke låse feriesaldo");
  }
  return toSnapshot(rows[0]);
}

/**
 * Ren semantik for en saldo-ændring: used klippes ved 0, remaining =
 * total − used (må blive negativ, #437), begge afrundet til 2 decimaler.
 * projectVacationBalance spejler PRÆCIS denne funktion.
 */
export function applyBalanceDelta(
  used: number,
  total: number,
  delta: number,
): { used: number; remaining: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const newUsed = Math.max(0, round2(used + delta));
  return { used: newUsed, remaining: round2(total - newUsed) };
}

/**
 * Registrér afholdt ferie (days > 0 → 'used') eller tilbageførsel (days < 0
 * → 'reversed') i ledgeren for den periode `date` hører til, og genberegn
 * saldo-rækken — i samme tx. Erstatter den gamle direkte UPDATE (#461).
 */
export async function postVacationUsage(
  tx: Db,
  params: {
    userId: string;
    orgId: string;
    /** Fraværets startdato — afgør ferieåret */
    date: string;
    /** Signeret: positiv = afholdt, negativ = tilbageført */
    days: number;
    pool: VacationPool;
    refType: VacationLedgerRefType;
    refId?: string | null;
    note?: string | null;
    createdBy?: string | null;
    settings?: VacationOrgSettings;
  },
): Promise<VacationBalanceSnapshot> {
  const period = await ensureVacationPeriod(
    tx,
    params.userId,
    params.orgId,
    params.date,
    params.settings,
  );
  const rounded = Math.round(params.days * 100) / 100;
  if (rounded === 0) return period;
  await postVacationLedger(tx, {
    userId: params.userId,
    orgId: params.orgId,
    pool: params.pool,
    entryType: rounded > 0 ? "used" : "reversed",
    days: Math.abs(rounded),
    effectiveDate: params.date,
    vacationYearStart: period.periodStart,
    refType: params.refType,
    refId: params.refId ?? null,
    note: params.note ?? null,
    createdBy: params.createdBy ?? null,
  });
  return recomputeVacationBalance(
    tx,
    params.userId,
    params.orgId,
    period.periodStart,
  );
}

/** Org'ens tilladte overtræk af feriesaldoen i dage (#437, default 0). */
export async function getVacationOverdraft(
  db: PostgresJsDatabase<typeof schema>,
  orgId: string,
): Promise<number> {
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
    columns: { vacationOverdraftDays: true },
  });
  return Math.max(0, Number(org?.vacationOverdraftDays ?? 0));
}

/** Restsaldo i den relevante pulje. */
export function remainingInPool(
  balance: VacationBalanceSnapshot,
  pool: VacationPool,
): number {
  return pool === "extra" ? balance.extraRemainingDays : balance.remainingDays;
}
