// Belægningsgrad i teamrapporten (#704). Arbejdstiden er SAMME grundlag som
// dækningsgraden (#679): brugerens ugeskema (users.work_schedule) eller
// HR-normtiden for enterprise-medarbejdere — se loadWorkTimeContext i
// @/lib/coverage/load. Beregningen her er ren, så den kan testes uden DB.

import { datesInRange, expectedByDate } from "@/lib/coverage/coverage";

/** Samlet arbejdstid i [start, end] (begge inklusive, "yyyy-MM-dd"). */
export function workHoursInRange(
  start: string,
  end: string,
  hoursFor: (date: string) => number,
): number {
  if (end < start) return 0;
  let sum = 0;
  for (const hours of expectedByDate(
    datesInRange(start, end),
    hoursFor,
  ).values()) {
    sum += hours;
  }
  return Math.round(sum * 100) / 100;
}

export interface MemberUtilization {
  /** Belægningsgrad: fakturerbar tid ÷ arbejdstid (procent) */
  utilizationPct: number | null;
  /** Dækningsgrad: logget tid ÷ arbejdstid (procent) */
  coveragePct: number | null;
}

/** Belægnings- og dækningsgrad; null når der ingen arbejdstid er. */
export function memberUtilization(input: {
  loggedHours: number;
  billableHours: number;
  workHours: number;
}): MemberUtilization {
  if (!(input.workHours > 0)) {
    return { utilizationPct: null, coveragePct: null };
  }
  return {
    utilizationPct: (input.billableHours / input.workHours) * 100,
    coveragePct: (input.loggedHours / input.workHours) * 100,
  };
}
