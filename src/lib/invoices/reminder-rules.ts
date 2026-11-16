import {
  addDaysToDateStr,
  copenhagenDayStart,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";
// Automatiske rykkere med dansk rentelov (#92) — ren, deterministisk
// beregningslogik (rentelovens §9a/§9b + bekendtgørelse om
// kompensationsbeløb). Ingen AI, ingen DB — unit-testes isoleret.

/** Rykkergebyr pr. rykker (rentelovens §9b, stk. 2) */
export const RYKKERGEBYR_DKK = 100;
/** Maks. antal rykkere med gebyr (rentelovens §9b, stk. 2) */
export const MAX_RYKKERE = 3;
/** Mindste interval mellem rykkere med gebyr (rentelovens §9b, stk. 2) */
export const RYKKER_INTERVAL_DAYS = 10;
/** Fast kompensationsbeløb ved B2B-forsinkelse (rentelovens §9a, stk. 3) */
export const B2B_KOMPENSATION_DKK = 310;
/**
 * Morarente: Nationalbankens officielle udlånsrente + 8 %-point
 * (rentelovens §5). Referencesatsen fastsættes halvårligt — 1,60 % pr.
 * 1/7-2026. Kan gøres konfigurerbar når satsen ændres.
 */
export const MORARENTE_AARLIG_PCT = 1.6 + 8;

/** Dage før forfald hvor den venlige påmindelse sendes */
export const FRIENDLY_REMINDER_DAYS_BEFORE = 3;

export interface ReminderState {
  dueDate: Date;
  reminderCount: number;
  lastReminderAt: Date | null;
}

/**
 * Er fakturaen klar til næste rykker? Rykker 1 tidligst dagen efter
 * forfald; rykker 2/3 tidligst RYKKER_INTERVAL_DAYS efter forrige
 * (lovkravet for gebyr-berettigede rykkere).
 */
export function isReminderDue(state: ReminderState, now: Date): boolean {
  if (state.reminderCount >= MAX_RYKKERE) return false;

  // Dansk midnat efter forfaldsdagen, uanset processens TZ (#649)
  const dayAfterDue = copenhagenDayStart(
    addDaysToDateStr(toCopenhagenDateStr(new Date(state.dueDate)), 1),
  );
  if (now < dayAfterDue) return false;

  if (state.reminderCount === 0 || !state.lastReminderAt) return true;

  const earliestNext = new Date(state.lastReminderAt);
  earliestNext.setDate(earliestNext.getDate() + RYKKER_INTERVAL_DAYS);
  return now >= earliestNext;
}

export interface ReminderCharges {
  reminderNumber: number;
  /** Akkumuleret rykkergebyr inkl. denne rykker */
  totalFees: number;
  /** B2B-kompensation (kun når kunden er erhverv) */
  compensation: number;
  /** Påløbet morarente indtil nu */
  accruedInterest: number;
  /** Samlet krav: hovedstol + gebyrer + kompensation + rente */
  totalClaim: number;
}

/**
 * Opgørelse af kravet ved rykker nr. N. Renten beregnes af hovedstolen
 * (simpel rente, ikke rentes rente — dansk praksis for morarente).
 */
export function calcReminderCharges(params: {
  principal: number;
  reminderNumber: number;
  daysOverdue: number;
  isBusinessClient: boolean;
}): ReminderCharges {
  const { principal, reminderNumber, daysOverdue, isBusinessClient } = params;
  const cappedNumber = Math.min(Math.max(1, reminderNumber), MAX_RYKKERE);
  const totalFees = cappedNumber * RYKKERGEBYR_DKK;
  const compensation = isBusinessClient ? B2B_KOMPENSATION_DKK : 0;
  const accruedInterest =
    Math.max(0, principal) *
    (MORARENTE_AARLIG_PCT / 100) *
    (Math.max(0, daysOverdue) / 365);
  return {
    reminderNumber: cappedNumber,
    totalFees,
    compensation,
    accruedInterest: Math.round(accruedInterest * 100) / 100,
    totalClaim:
      Math.round(
        (Math.max(0, principal) + totalFees + compensation + accruedInterest) *
          100,
      ) / 100,
  };
}
