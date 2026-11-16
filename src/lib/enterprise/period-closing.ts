// Periodeafslutning (#518, inkl. #509): rene regler uden DB-adgang.
//
// Flow pr. medarbejder og periode (måned eller kvartal):
//   open          opgørelsen er dannet (automatisk ved periodens slut)
//   approved      lederen har godkendt — perioden er LÅST
//   acknowledged  medarbejderen har kvitteret — stadig låst
//   reopened      låst op med en logget årsag — kan dannes/godkendes igen

import { syncT } from "@/i18n/sync-text";
import { addDaysToDateStr } from "@/lib/time/copenhagen";
import {
  type DateBounds,
  formatPeriodLabel,
  type NormTotals,
  normPeriodBounds,
} from "./norm-period";

export const PERIOD_CLOSING_INTERVALS = ["month", "quarter"] as const;
export type PeriodClosingInterval = (typeof PERIOD_CLOSING_INTERVALS)[number];

export const PERIOD_CLOSING_INTERVAL_LABELS: Record<
  PeriodClosingInterval,
  string
> = {
  month: "Hver måned",
  quarter: "Hvert kvartal",
};

/** Forudindstilling fra OK/kunde C: opgørelse mindst hver 3. måned. */
export const PERIOD_CLOSING_PRESET = {
  label: "Opgørelse mindst hver 3. måned",
  interval: "quarter" as PeriodClosingInterval,
};

export function isPeriodClosingInterval(
  v: unknown,
): v is PeriodClosingInterval {
  return (PERIOD_CLOSING_INTERVALS as readonly unknown[]).includes(v);
}

export const PERIOD_CLOSING_STATUSES = [
  "open",
  "approved",
  "acknowledged",
  "reopened",
] as const;
export type PeriodClosingStatus = (typeof PERIOD_CLOSING_STATUSES)[number];

export const PERIOD_CLOSING_STATUS_LABELS: Record<PeriodClosingStatus, string> =
  {
    open: "Afventer leder",
    approved: "Afventer kvittering",
    acknowledged: "Afsluttet",
    reopened: "Låst op",
  };

/** Statusser hvor periodens registreringer er låst. */
export const LOCKED_CLOSING_STATUSES: readonly PeriodClosingStatus[] = [
  "approved",
  "acknowledged",
];

export function isClosingLocked(status: string): boolean {
  return (LOCKED_CLOSING_STATUSES as readonly string[]).includes(status);
}

export function canApproveClosing(status: string): boolean {
  return status === "open" || status === "reopened";
}

export function canAcknowledgeClosing(status: string): boolean {
  return status === "approved";
}

export function canUnlockClosing(status: string): boolean {
  return isClosingLocked(status);
}

/** Opdatér opgørelsen (genberegn) — kun før den er godkendt. */
export function canRefreshClosing(status: string): boolean {
  return status === "open" || status === "reopened";
}

export const MIN_UNLOCK_REASON = 3;
export const MAX_UNLOCK_REASON = 500;

/** Afslutningsperioden der indeholder datoen (kalendermåned/-kvartal). */
export function closingPeriodBounds(
  interval: PeriodClosingInterval,
  date: string,
): DateBounds {
  return normPeriodBounds(interval, "calendar", date);
}

/** Den senest afsluttede periode før `today`. */
export function previousClosingPeriod(
  interval: PeriodClosingInterval,
  today: string,
): DateBounds {
  const current = closingPeriodBounds(interval, today);
  return closingPeriodBounds(interval, addDaysToDateStr(current.start, -1));
}

export function closingPeriodLabel(
  interval: PeriodClosingInterval,
  bounds: DateBounds,
): string {
  return formatPeriodLabel(interval, "calendar", bounds);
}

/** Opgørelsen der gemmes på perioden (registreret, norm, flex, fravær). */
export interface ClosingSummary {
  registered: number;
  gross: number;
  net: number;
  daysOff: number;
  vacation: number;
  vacationDays: number;
  otherAbsence: number;
  otherAbsenceDays: number;
  earnedOvertime: number;
  /** Periodens flex (registreret − nettonorm − optjent overtid) */
  flex: number;
  grade: number;
  /** Løbende flexsaldo i normperioden pr. periodens sidste dag */
  flexBalance: number | null;
  computedAt: string;
}

export function toClosingSummary(
  totals: NormTotals,
  flexBalance: number | null,
  computedAt: Date = new Date(),
): ClosingSummary {
  return {
    registered: totals.registered,
    gross: totals.gross,
    net: totals.net,
    daysOff: totals.daysOff,
    vacation: totals.vacation,
    vacationDays: totals.vacationDays,
    otherAbsence: totals.otherAbsence,
    otherAbsenceDays: totals.otherAbsenceDays,
    earnedOvertime: totals.earnedOvertime,
    flex: totals.flex,
    grade: totals.grade,
    flexBalance,
    computedAt: computedAt.toISOString(),
  };
}

/** Datoer (yyyy-MM-dd) der ligger i en låst periode. */
export function lockedDates(
  dates: readonly string[],
  closings: ReadonlyArray<{
    periodStart: string;
    periodEnd: string;
    status: string;
  }>,
): string[] {
  const locked = closings.filter((c) => isClosingLocked(c.status));
  return dates.filter((d) =>
    locked.some((c) => c.periodStart <= d && d <= c.periodEnd),
  );
}

export function closingLockedMessage(): string {
  return syncT("enterprise.closing.locked");
}
