/**
 * Aktivering (#91, med #173 timer-first og #175 adfærdsdrip).
 *
 * Ren, deterministisk logik uden DB og React, så den kan testes i vitest:
 * - velkomstspørgsmålets svarmuligheder
 * - hvilket "næste skridt" Hjem viser ud fra svaret
 * - hvilken adfærdsmail (hvis nogen) en ny bruger skal have i dag
 * - sendevinduet (aldrig mails om natten)
 */

export const PRIMARY_USES = [
  "time",
  "invoicing",
  "klippekort",
  "team",
] as const;

export type PrimaryUse = (typeof PRIMARY_USES)[number];

export const PRIMARY_USE_LABELS: Record<PrimaryUse, string> = {
  time: "Holde styr på min tid",
  invoicing: "Fakturere mine kunder",
  klippekort: "Klippekort og forudbetalte timer",
  team: "Følge mit teams tid",
};

export function isPrimaryUse(value: unknown): value is PrimaryUse {
  return (
    typeof value === "string" &&
    (PRIMARY_USES as readonly string[]).includes(value)
  );
}

/** Velkomstspørgsmålet stilles til konti op til så mange dage gamle. */
export const WELCOME_SURVEY_MAX_AGE_DAYS = 30;

/**
 * Velkomstkortet på Hjem: "start din første timer" indtil første tidspost
 * (også for ældre konti, der aldrig kom i gang), og spørgsmålet til nye
 * konti, der ikke har svaret. Skjules for altid, når brugeren lukker det.
 */
export function welcomeCardState(params: {
  hasTimeEntry: boolean;
  primaryUse: PrimaryUse | null;
  dismissed: boolean;
  accountAgeDays: number | null;
}): { visible: boolean; showFirstTimer: boolean; showSurvey: boolean } {
  if (params.dismissed) {
    return { visible: false, showFirstTimer: false, showSurvey: false };
  }
  const showFirstTimer = !params.hasTimeEntry;
  const isNew =
    params.accountAgeDays !== null &&
    params.accountAgeDays <= WELCOME_SURVEY_MAX_AGE_DAYS;
  const showSurvey = params.primaryUse === null && (showFirstTimer || isNew);
  return { visible: showFirstTimer || showSurvey, showFirstTimer, showSurvey };
}

export interface ActivationFacts {
  /** Org'en har andre medlemmer end brugeren selv. */
  hasTeammates?: boolean;
  hasClient: boolean;
  hasTimeEntry: boolean;
  hasKlippekort: boolean;
  hasInvoice: boolean;
}

export interface HomeNudge {
  key: "first-invoice" | "first-client" | "first-klippekort" | "invite-team";
  label: string;
  href: string;
}

/**
 * Ét roligt "næste skridt" på Hjem ud fra velkomstsvaret. Kun når der er
 * noget at gøre, og kun for funktioner planen har. "time" (eller intet svar)
 * giver ingen ekstra signaler — så er Hjem bare tidsregistrering.
 */
export function activationNudge(params: {
  primaryUse: PrimaryUse | null;
  facts: ActivationFacts;
  showInvoicing: boolean;
  showKlippekort: boolean;
  showClients: boolean;
  canManageTeam: boolean;
}): HomeNudge | null {
  const { primaryUse, facts } = params;
  switch (primaryUse) {
    case "invoicing":
      if (!params.showInvoicing || facts.hasInvoice) return null;
      if (!facts.hasTimeEntry) return null; // velkomstkortet tager første skridt
      return {
        key: "first-invoice",
        label: "Lav din første faktura ud fra din tid",
        href: "/dashboard/invoices/new",
      };
    case "klippekort":
      if (!params.showKlippekort || facts.hasKlippekort) return null;
      if (!facts.hasClient) {
        return params.showClients
          ? {
              key: "first-client",
              label: "Opret den kunde, klippekortet skal høre til",
              href: "/dashboard/clients/new",
            }
          : null;
      }
      return {
        key: "first-klippekort",
        label: "Opret dit første klippekort",
        href: "/dashboard/klippekort",
      };
    case "team":
      if (!params.canManageTeam || facts.hasTeammates) return null;
      return {
        key: "invite-team",
        label: "Invitér en kollega",
        href: "/dashboard/organization",
      };
    default:
      return null;
  }
}

// ============================================
// Adfærdsdrip (#175)
// ============================================

export type ActivationDripType =
  | "drip_no_time_48h"
  | "drip_time_no_invoice"
  | "drip_client_no_klippekort";

/** Kun nye brugere: ældre konti får win-back-sekvensen, ikke aktivering. */
export const ACTIVATION_DRIP_MAX_AGE_DAYS = 45;
/**
 * Kun konti oprettet efter release: eksisterende brugere skal ikke have en
 * bølge af aktiveringsmails første gang cron'en kører med de nye triggere.
 */
export const ACTIVATION_DRIP_SIGNUP_FROM = new Date("2026-10-03T00:00:00Z");
/** Tid uden faktura: så mange dage efter første tidspost. */
export const TIME_NO_INVOICE_AFTER_DAYS = 14;
/** Mindst så meget ufaktureret tid, før en faktura-mail giver mening. */
export const TIME_NO_INVOICE_MIN_HOURS = 1;
/** Kunde uden klippekort: så mange dage efter signup. */
export const CLIENT_NO_KLIPPEKORT_AFTER_DAYS = 7;

export interface ActivationDripInput {
  signupAt: Date;
  hoursSinceSignup: number;
  /** Dage siden første tidspost; null = ingen tidsposter. */
  daysSinceFirstEntry: number | null;
  hasClient: boolean;
  hasKlippekort: boolean;
  hasInvoice: boolean;
  unbilledHours: number;
  /** Brugeren kan oprette fakturaer og klippekort (ejer/admin). Planen afgør det ikke. */
  canManageBilling: boolean;
  /** Mailtyper der allerede er sendt til brugeren. */
  sent: ReadonlySet<string>;
}

/**
 * Hvilken aktiveringsmail skal brugeren have i dag? Højst én, hver type kun
 * én gang. Rækkefølgen er prioriteten: først det mest grundlæggende skridt.
 */
export function pickActivationDrip(
  input: ActivationDripInput,
): ActivationDripType | null {
  const ageDays = input.hoursSinceSignup / 24;
  if (ageDays > ACTIVATION_DRIP_MAX_AGE_DAYS) return null;
  if (input.signupAt < ACTIVATION_DRIP_SIGNUP_FROM) return null;

  if (
    input.daysSinceFirstEntry === null &&
    input.hoursSinceSignup >= 48 &&
    !input.sent.has("drip_no_time_48h")
  ) {
    return "drip_no_time_48h";
  }

  if (
    input.canManageBilling &&
    input.daysSinceFirstEntry !== null &&
    input.daysSinceFirstEntry >= TIME_NO_INVOICE_AFTER_DAYS &&
    !input.hasInvoice &&
    input.unbilledHours >= TIME_NO_INVOICE_MIN_HOURS &&
    !input.sent.has("drip_time_no_invoice")
  ) {
    return "drip_time_no_invoice";
  }

  if (
    input.canManageBilling &&
    ageDays >= CLIENT_NO_KLIPPEKORT_AFTER_DAYS &&
    input.hasClient &&
    !input.hasKlippekort &&
    !input.sent.has("drip_client_no_klippekort") &&
    // Den generelle klippekort-mail dækker samme budskab
    !input.sent.has("drip_klippekort_tips")
  ) {
    return "drip_client_no_klippekort";
  }

  return null;
}

/** Mindst så lang tid mellem to drip-mails til samme bruger. */
export const DRIP_COOLDOWN_HOURS = 48;

/**
 * Sendevindue i dansk tid: aldrig mails om natten, uanset hvornår cron'en
 * bliver kaldt (manuel kørsel, forsinket job). 08:00–19:59.
 */
export function isWithinDripSendWindow(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: "Europe/Copenhagen",
    }).format(now),
  );
  return hour >= 8 && hour < 20;
}

/**
 * Den generelle klippekort-mail (drip_klippekort_tips): kun til planer, der
 * kan oprette klippekort (alle planer).
 */
export function shouldSendKlippekortTips(input: {
  canManageBilling: boolean;
  daysSinceSignup: number;
  isActive: boolean;
  sent: ReadonlySet<string>;
}): boolean {
  return (
    input.canManageBilling &&
    input.isActive &&
    input.daysSinceSignup >= 30 &&
    !input.sent.has("drip_klippekort_tips") &&
    !input.sent.has("drip_client_no_klippekort")
  );
}
