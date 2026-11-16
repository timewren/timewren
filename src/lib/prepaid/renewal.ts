// Periodiske klippekort (#79): ren beregningslogik for fornyelse —
// adskilt fra cron/DB så den kan unit-testes.

import {
  addMonthsToDateStr,
  entryDateFromStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";

export type RenewalInterval = "monthly" | "quarterly" | "yearly";
export type RenewalRollover = "none" | "carry";

const INTERVAL_MONTHS: Record<RenewalInterval, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * Næste fornyelse: den danske kalenderdato for `from` plus intervallet,
 * gemt som UTC-midnat (samme konvention som `expiry_date`). Dagen klemmes
 * til månedens sidste (31/1 → 28/2). Uafhængig af processens TZ (#758).
 */
export function computeNextRenewal(
  from: Date,
  interval: RenewalInterval,
): Date {
  return entryDateFromStr(
    addMonthsToDateStr(toCopenhagenDateStr(from), INTERVAL_MONTHS[interval]),
  );
}

export interface RenewalCalcInput {
  baseHours: number; // pakkens grund-timetal pr. periode
  oldRemaining: number;
  oldOverdraft: number; // #93-gæld på den gamle pakke
  rollover: RenewalRollover;
}

export interface RenewalCalc {
  /** Ny pakkes totalHours (grundtimer + evt. overført rest) */
  newTotalHours: number;
  /** Ny pakkes remainingHours efter gælds-modregning */
  newRemainingHours: number;
  /** Overtræk modregnet i den nye periode (dokumenteres som usage-note) */
  settledOverdraft: number;
  /** Restklip der blev overført */
  carriedHours: number;
}

/**
 * Fornyelses-regnestykket. "carry" overfører restklip til den nye
 * periode og modregner gammelt overtræk (#93) i de nye timer — gælden
 * forsvinder ikke, den betales af den nye periode. "none" starter altid
 * på grundtimerne, men gæld modregnes stadig (alt andet ville forære
 * kunden timerne).
 */
export function calcRenewal(input: RenewalCalcInput): RenewalCalc {
  const { baseHours, oldRemaining, oldOverdraft, rollover } = input;

  const carriedHours = rollover === "carry" ? Math.max(0, oldRemaining) : 0;
  const newTotalHours = baseHours + carriedHours;
  const settledOverdraft = Math.min(Math.max(0, oldOverdraft), newTotalHours);
  const newRemainingHours = newTotalHours - settledOverdraft;

  return { newTotalHours, newRemainingHours, settledOverdraft, carriedHours };
}
