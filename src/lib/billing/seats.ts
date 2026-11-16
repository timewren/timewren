/**
 * Rene hjælpefunktioner til self-service pladskøb + tier-opgradering (#420).
 *
 * Alunta har ingen API-endpoints til at ændre quantity eller plan på et
 * eksisterende abonnement, så begge flows er "erstat og annullér": kunden
 * checker ud på en NY subscription, og når den aktiveres (webhook), annullerer
 * vi de gamle subscriptions den erstatter. Udvælgelsen af hvad der skal
 * annulleres ligger her som rene funktioner, så webhook-logikken kan testes
 * uden Alunta/db.
 */
import {
  aluntaPlanIdGroups,
  clampSeats,
  getAluntaSeatsPlanIdForTier,
  includedSeatsForTier,
  isAluntaSeatsPlan,
  maxSeatsForTier,
  type PlanTier,
  type PriceBook,
} from "@/lib/config";

/** Minimal udsnit af en Alunta-subscription som udvælgelsen behøver. */
export interface AluntaSubSummary {
  uuid: string;
  status: string;
  plan?: { uuid: string } | null;
}

/** Alunta-statusser der tæller som "live" — trialing er også et løbende abo. */
const LIVE_STATUSES = new Set(["active", "trialing"]);

export function isLiveAluntaStatus(status: string | null | undefined): boolean {
  return LIVE_STATUSES.has((status ?? "").toLowerCase());
}

/**
 * Numerisk rang til opgraderings-sammenligning:
 * free < privat < solo < team < business. Ukendt/null rangerer som solo.
 */
export function tierRank(tier: string | null | undefined): number {
  switch (tier) {
    case "free":
      return -2;
    case "privat":
      return -1;
    case "team":
      return 1;
    case "business":
      return 2;
    default:
      return 0;
  }
}

/** Tier for en seats-add-on-plan, eller null hvis planen ikke er en seats-plan. */
export function seatsPlanTier(
  planUuid: string | null | undefined,
): "team" | "business" | null {
  if (!planUuid) return null;
  const { teamSeats, businessSeats } = aluntaPlanIdGroups();
  if (teamSeats.includes(planUuid)) return "team";
  if (businessSeats.includes(planUuid)) return "business";
  return null;
}

/**
 * Tier for en KENDT base-plan (solo/founding/team/business), eller null for
 * ukendte plan-UUID'er. Bevidst strengere end `resolveAluntaPlanTier`, som
 * falder tilbage til "solo" for alt ukendt — her må vi ALDRIG annullere en
 * subscription vi ikke positivt genkender som en af vores base-planer.
 */
export function knownBasePlanTier(
  planUuid: string | null | undefined,
): PlanTier | null {
  if (!planUuid) return null;
  // Inkluderer legacy-planer (ALUNTA_PLAN_LEGACY_*), så grandfathered kunders
  // base-subs stadig genkendes ved erstat-og-annullér.
  const groups = aluntaPlanIdGroups();
  if (groups.soloBase.includes(planUuid)) return "solo";
  if (groups.privatBase.includes(planUuid)) return "privat";
  if (groups.teamBase.includes(planUuid)) return "team";
  if (groups.businessBase.includes(planUuid)) return "business";
  return null;
}

/**
 * Når en seats-add-on-subscription aktiveres: find de ANDRE live
 * seats-subscriptions for samme kunde, som den nye erstatter. Base-planer og
 * ukendte planer røres aldrig.
 */
export function findObsoleteSeatsSubs(
  activatedSubUuid: string,
  subs: AluntaSubSummary[],
): AluntaSubSummary[] {
  return subs.filter(
    (s) =>
      s.uuid !== activatedSubUuid &&
      isLiveAluntaStatus(s.status) &&
      isAluntaSeatsPlan(s.plan?.uuid),
  );
}

/**
 * Når en BASE-plan-subscription aktiveres som opgradering: find kundens live
 * base-subscriptions på en LAVERE tier samt seats-add-ons hørende til en
 * lavere tier (team-seats ved team→business). Subscriptions på samme eller
 * højere tier — og alt vi ikke positivt genkender — røres aldrig, så
 * funktionen er idempotent og ufarlig at køre på hvert aktiverings-event.
 */
export function findObsoleteSubsOnUpgrade(
  activatedSubUuid: string,
  newTier: string,
  subs: AluntaSubSummary[],
): AluntaSubSummary[] {
  const newRank = tierRank(newTier);
  return subs.filter((s) => {
    if (s.uuid === activatedSubUuid || !isLiveAluntaStatus(s.status))
      return false;
    const baseTier = knownBasePlanTier(s.plan?.uuid);
    if (baseTier !== null) return tierRank(baseTier) < newRank;
    const seatsTier = seatsPlanTier(s.plan?.uuid);
    if (seatsTier !== null) return tierRank(seatsTier) < newRank;
    return false; // ukendt plan — rør den aldrig
  });
}

/**
 * Annullér en liste subscriptions én ad gangen. Fejl på én må aldrig stoppe
 * de øvrige eller vælte webhook-behandlingen — de rapporteres via `onError`
 * (log + Sentry hos kalderen) og samles i resultatet.
 */
export async function cancelSubscriptionsSafely(
  subs: AluntaSubSummary[],
  cancelFn: (uuid: string) => Promise<unknown>,
  onError: (uuid: string, error: unknown) => void,
): Promise<{ cancelled: string[]; failed: string[] }> {
  const cancelled: string[] = [];
  const failed: string[] = [];
  for (const sub of subs) {
    try {
      await cancelFn(sub.uuid);
      cancelled.push(sub.uuid);
    } catch (err) {
      failed.push(sub.uuid);
      onError(sub.uuid, err);
    }
  }
  return { cancelled, failed };
}

/**
 * Parse `metadata.replaces_subscription_uuids` fra en checkout/subscription.
 * Metadataen er ankeret for erstat-og-annullér (#424): checkouten UDPEGER de
 * konkrete sub-UUID'er der skal annulleres, så webhooken aldrig behøver
 * annullere ud fra klassificering alene. Returnerer null når nøglen mangler
 * eller er ulæselig (→ backstop-heuristik med alarm), ellers listen
 * (evt. tom).
 */
export function parseReplacesUuids(raw: unknown): string[] | null {
  let value = raw;
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  return value.filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
}

/**
 * Seat-antal for en tier-OPGRADERINGS-checkout: kapaciteten skal FØLGE MED
 * (#424 fund 1) — aldrig `includedSeatsForTier(nyTier)`, som ville slette
 * betalt plads-kapacitet (fx Team 2+3=5 → Business skal starte på 5, ikke 5
 * inkluderede - de har tilfældigvis samme tal, men Team 2+8=10 → Business
 * skal starte på 10). Clampes til den nye tiers grænser.
 */
export function upgradeSeatCount(
  newTier: PlanTier | string,
  currentSeatCount: number | null | undefined,
  currentMaxSeats: number | null | undefined,
): number {
  return clampSeats(
    newTier,
    Math.max(
      currentMaxSeats ?? 0,
      currentSeatCount ?? 0,
      includedSeatsForTier(newTier),
    ),
  );
}

/**
 * Forventet total plads-kapacitet for et abonnement, beregnet fra Alunta som
 * sandhedskilde (#424 fund 3): inkluderede pladser + SUM af live
 * seats-add-on-subs' quantity — og aldrig under base-checkoutens
 * metadata.seat_count (kapacitet båret med fra fx en tier-opgradering, hvor
 * add-on'en endnu ikke er gentegnet på den nye tier). Clampet til tierens
 * grænser. Kan LOVLIGT være lavere end den lokale række (ægte annullering af
 * en add-on) — kalderen afgør om der korrigeres ned.
 */
export function expectedSeatsForSubscription(opts: {
  tier: string;
  baseMetaSeatCount: number | null | undefined;
  liveSeatsQuantities: number[];
}): number {
  const { tier, baseMetaSeatCount, liveSeatsQuantities } = opts;
  const included = includedSeatsForTier(tier);
  const addOn = liveSeatsQuantities.reduce(
    (sum, q) => sum + (Number.isFinite(q) && q > 0 ? q : 0),
    0,
  );
  const meta =
    typeof baseMetaSeatCount === "number" && baseMetaSeatCount > 0
      ? baseMetaSeatCount
      : 0;
  return clampSeats(tier, Math.max(included + addOn, meta));
}

/**
 * Seat-antal ved et BASE-plan-event (checkout/updated): base-checkoutens
 * metadata.seat_count er et FROSSENT øjebliksbillede og må aldrig sænke
 * pladser som et senere seats-add-on-køb har hævet (#424 fund 3). Kun en
 * eksplicit seats-annullering (egen handler-gren) må reducere. Clampet til
 * tierens grænser — så en tier-ÆNDRING stadig normaliserer.
 */
export function resolveBaseEventSeatCount(
  tier: string,
  resolvedSeats: number,
  existingSeats: number | null | undefined,
): number {
  return clampSeats(tier, Math.max(resolvedSeats, existingSeats ?? 0));
}

/**
 * Beslutning for et BASE-checkout-event når rækken allerede er linket til en
 * ANDEN subscription (#424 fund 7): re-point kun ved legitime opgraderinger —
 * eventet bærer vores egne upgrade-metadata, eller den nye plans tier er
 * højere end rækkens. Alt andet (fx en gammel, ikke-annulleret sub der
 * "vågner") må aldrig blindt nedgradere rækken; dér skal kalderen først
 * verificere adoption (er den linkede sub død?).
 */
export function baseCheckoutRelinkDecision(opts: {
  hasUpgradeMetadata: boolean;
  eventTier: string;
  rowTier: string | null | undefined;
}): "relink" | "verify-adoption" {
  if (opts.hasUpgradeMetadata) return "relink";
  if (tierRank(opts.eventTier) > tierRank(opts.rowTier ?? "solo"))
    return "relink";
  return "verify-adoption";
}

/**
 * Validér et self-service køb af ekstra pladser. Returnerer en dansk
 * fejlbesked, eller null når købet er gyldigt. `seatsInUse` = medlemmer +
 * afventende invitationer (samme tælling som invite-enforcementen), så kunden
 * ikke kan købe sig NED under det antal pladser der allerede er optaget.
 */
export function validateExtraSeatsPurchase(opts: {
  tier: string | null | undefined;
  totalExtraSeats: number;
  seatsInUse: number;
  priceBook?: PriceBook;
}): string | null {
  const { tier, totalExtraSeats, seatsInUse, priceBook } = opts;
  if (tier !== "team" && tier !== "business") {
    return "Ekstra pladser kræver en Team- eller Virksomhed-plan. Opgradér din plan først.";
  }
  if (!Number.isInteger(totalExtraSeats) || totalExtraSeats < 1) {
    return "Antal ekstra pladser skal være mindst 1.";
  }
  const included = includedSeatsForTier(tier);
  const max = maxSeatsForTier(tier);
  if (included + totalExtraSeats > max) {
    return `Din plan tillader højst ${max} pladser i alt (${included} inkluderet + ${max - included} ekstra).`;
  }
  if (included + totalExtraSeats < seatsInUse) {
    return `I bruger allerede ${seatsInUse} pladser (medlemmer + afventende invitationer). Fjern medlemmer eller invitationer før du reducerer antallet.`;
  }
  if (!getAluntaSeatsPlanIdForTier(tier, priceBook)) {
    return "Køb af ekstra pladser er ikke tilgængeligt for din plan endnu. Kontakt support.";
  }
  return null;
}
