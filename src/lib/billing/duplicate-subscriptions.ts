import { isLiveAluntaStatus } from "@/lib/billing/seats";

/**
 * Dobbelt-abonnement-detektion (kunde B-incident 1/9-2026).
 *
 * En kunde kan ende med to løbende Alunta-abonnementer på samme
 * `customer.uuid`: det vi linkede via checkout (med external_customer_id) og
 * et fremmed startet direkte i Alunta (uden external_customer_id, uden
 * metadata). Webhooken for det fremmede kunne tidligere ikke slå kunden op
 * og returnerede stille → kunden blev faktureret dobbelt i to måneder.
 *
 * Alt her er rene funktioner uden I/O, så de kan testes isoleret og genbruges
 * af både webhook-fallbacken og den daglige reconciliation-cron.
 */

/** webhook_events.status når et event er behandlet men kræver et menneske. */
export const WEBHOOK_STATUS_NEEDS_REVIEW = "needs_review";

/**
 * Statusser der tæller som "faktureres stadig" i dobbelt-abonnement-
 * sammenhæng. Bevidst BREDERE end `isLiveAluntaStatus` (active/trialing,
 * bruges på den destruktive annullér-sti): past_due og under_cancellation er
 * abonnementer Alunta stadig forsøger at opkræve for, så de skal med når vi
 * leder efter dobbeltbetaling — men de må aldrig få cancel-heuristikken til
 * at annullere mere.
 */
const BILLING_EXTRA_STATUSES = new Set(["past_due", "under_cancellation"]);

export function isBillingAluntaStatus(
  status: string | null | undefined,
): boolean {
  const s = (status ?? "").toLowerCase();
  return isLiveAluntaStatus(s) || BILLING_EXTRA_STATUSES.has(s);
}

/** Minimalt udsnit af en Alunta-subscription som detektionen behøver. */
export interface DuplicateCheckAluntaSub {
  uuid: string;
  status: string;
  /** Sat når abonnementet udløber uden fornyelse (opsagt). */
  end_date?: string | null;
  /** Slut på nuværende periode — findes ikke i alle Alunta-payloads. */
  current_period_end?: string | null;
  customer?: { uuid: string } | null;
  plan?: { uuid: string; name?: string } | null;
}

const ENDING_STATUSES = new Set([
  "under_cancellation",
  "cancelled",
  "canceled",
]);

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Fakturerer Alunta stadig denne sub? Som `isBillingAluntaStatus`, men en
 * opsagt sub (under_cancellation/cancelled) med `end_date` sat — og ikke
 * senere end `current_period_end`, når feltet findes — fornyer ikke og
 * tæller derfor IKKE som dobbeltbetaling: den udløber af sig selv.
 * active/trialing/past_due tæller altid.
 */
export function isStillBillingAluntaSub(
  sub: Pick<
    DuplicateCheckAluntaSub,
    "status" | "end_date" | "current_period_end"
  >,
): boolean {
  const status = (sub.status ?? "").toLowerCase();
  if (ENDING_STATUSES.has(status)) {
    const endDate = parseDate(sub.end_date);
    if (endDate !== null) {
      const periodEnd = parseDate(sub.current_period_end);
      if (periodEnd === null || endDate <= periodEnd) return false;
    }
  }
  return isBillingAluntaStatus(status);
}

/** Minimalt udsnit af vores `subscriptions`-række. */
export interface DuplicateCheckLocalRow {
  id: string;
  userId: string;
  organizationId: string | null;
  aluntaCustomerId: string;
  aluntaSubscriptionId: string | null;
  /**
   * Rækken betales i appen (App Store/Google Play). Så er ÉT live Alunta-
   * abonnement nok til dobbeltbetaling, og rækkens Alunta-link er ikke det
   * legitime abonnement.
   */
  storeManaged?: boolean;
}

export interface DuplicateFinding {
  row: DuplicateCheckLocalRow;
  customerUuid: string;
  linkedSubUuid: string | null;
  /** Alle abonnementer med billing-status hos Alunta for kunden. */
  liveSubUuids: string[];
  /** De live abonnementer der IKKE er rækkens linkede. */
  foreignSubUuids: string[];
}

/**
 * Gruppér Aluntas fulde abonnementsliste pr. customer.uuid og returnér de
 * lokale rækker hvis kunde har MERE END ÉT abonnement med billing-status.
 *
 * Aluntas `?customer_id=`-filter ignoreres tilsyneladende og returnerer alle
 * abonnementer, så kalderen henter alt (alle sider) én gang og filtreringen
 * sker her klient-side.
 */
export function findDuplicateSubscriptions(
  rows: DuplicateCheckLocalRow[],
  aluntaSubs: DuplicateCheckAluntaSub[],
): DuplicateFinding[] {
  const liveByCustomer = new Map<string, DuplicateCheckAluntaSub[]>();
  for (const sub of aluntaSubs) {
    const customerUuid = sub.customer?.uuid;
    if (!customerUuid || !isStillBillingAluntaSub(sub)) continue;
    const list = liveByCustomer.get(customerUuid) ?? [];
    list.push(sub);
    liveByCustomer.set(customerUuid, list);
  }

  const findings: DuplicateFinding[] = [];
  for (const row of rows) {
    const live = liveByCustomer.get(row.aluntaCustomerId) ?? [];
    // Dedup på uuid — samme sub kan i princippet optræde på to sider ved
    // pagination-drift under hentningen.
    const liveSubUuids = [...new Set(live.map((s) => s.uuid))];
    if (liveSubUuids.length <= (row.storeManaged ? 0 : 1)) continue;
    const linkedSubUuid = row.storeManaged ? null : row.aluntaSubscriptionId;
    findings.push({
      row,
      customerUuid: row.aluntaCustomerId,
      linkedSubUuid,
      liveSubUuids,
      foreignSubUuids: liveSubUuids.filter((uuid) => uuid !== linkedSubUuid),
    });
  }
  return findings;
}

/**
 * Webhook-siden: er et event fra sub `eventSubUuid` for en række linket til
 * `linkedSubUuid` et muligt dobbelt-abonnement? Ja, når eventets sub er en
 * anden end den linkede, eventets sub faktureres stadig, og den linkede sub
 * ikke er bekræftet død (null = kunne ikke verificeres → hellere alarmere
 * end tie på en pengesti).
 */
export function isPossibleDuplicateEvent(params: {
  linkedSubUuid: string | null;
  eventSubUuid: string;
  eventSubStatus: string | null | undefined;
  /** Eventets end_date — en opsagt sub der udløber uden fornyelse er ikke dobbelt. */
  eventSubEndDate?: string | null;
  eventSubCurrentPeriodEnd?: string | null;
  linkedSubLive: boolean | null;
}): boolean {
  const { linkedSubUuid, eventSubUuid, linkedSubLive } = params;
  if (!linkedSubUuid || linkedSubUuid === eventSubUuid) return false;
  if (
    !isStillBillingAluntaSub({
      status: params.eventSubStatus ?? "",
      end_date: params.eventSubEndDate,
      current_period_end: params.eventSubCurrentPeriodEnd,
    })
  )
    return false;
  return linkedSubLive !== false;
}

/** Fælles alarmtekst — bruges af webhook og cron så Discord-søgning rammer begge. */
export function formatDuplicateReason(params: {
  source: string;
  customerUuid: string;
  linkedSubUuid: string | null;
  foreignSubUuids: string[];
  /** "App Store"/"Google Play" når rækken også betales i appen. */
  storeLabel?: string;
}): string {
  const { source, customerUuid, linkedSubUuid, foreignSubUuids } = params;
  return (
    `${source} — Alunta-kunde ${customerUuid}: linket sub ${linkedSubUuid ?? "ingen"}, ` +
    (params.storeLabel
      ? `rækken betales også via ${params.storeLabel} (køb i appen), `
      : "") +
    `fremmed live sub(s) [${foreignSubUuids.join(", ")}]. ` +
    "Muligt dobbelt-abonnement — verificér og annullér manuelt i Alunta (ingen auto-annullering)."
  );
}
