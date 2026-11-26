/**
 * Ren (klient-sikker) plan-gate-logik til dashboard-UI'et. Ingen DB-/server-
 * imports, så den kan bruges fra "use client"-komponenter og testes i vitest.
 * Serveren håndhæver betalingsfristen og planens kapacitetsgrænser.
 * Ingen funktion er låst bag en plan (#1012).
 */

import { sharedT } from "@/i18n/shared-text";

/** Seven days of access after a payment first becomes past due. */
export function isPastDueWithinGrace(
  subscription:
    | { status: string; pastDueSince?: Date | string | null }
    | null
    | undefined,
  now = Date.now(),
): boolean {
  return (
    subscription?.status === "past_due" &&
    (!subscription.pastDueSince ||
      now - new Date(subscription.pastDueSince).getTime() <= 7 * 86_400_000)
  );
}

/**
 * Antal brugere (medlemmer + gyldige afventende invitationer) på Gratis.
 * Eneste kilde til tallet — markedsføring, invitationstjek, nedgradering og
 * adgangsvagten læser alle herfra (Mads 1/10-2026: 1 → 3 brugere).
 */
export const FREE_MAX_SEATS = 3;

/** Aktive (ikke-arkiverede) kunder på Gratis-tieren. */
export const FREE_MAX_ACTIVE_CLIENTS = 3;

/**
 * Aktive (ikke-arkiverede) kunder på Privat. Selvstændig, Team og Virksomhed
 * har ingen grænse. Det er kapacitet, ikke en låst funktion (#1012).
 */
export const PRIVAT_MAX_ACTIVE_CLIENTS = 10;

/**
 * Kundeloft-besked pr. tier, delt af server (fejl) og dashboard (note), på
 * kaldets sprog (dansk uden kontekst).
 */
export function clientLimitMessage(
  tier: string | null | undefined,
  locale?: string | null,
): string {
  if (tier === "privat") {
    return sharedT(
      "sharedLabels",
      "privatClientLimit",
      { clients: PRIVAT_MAX_ACTIVE_CLIENTS },
      locale,
    );
  }
  return sharedT(
    "sharedLabels",
    "freeClientLimit",
    { clients: FREE_MAX_ACTIVE_CLIENTS },
    locale,
  );
}

/**
 * Medlem ud over de første `FREE_MAX_SEATS` i en org på Gratis. Kan logge ind
 * og eksportere sine data, men ikke registrere eller ændre noget.
 */
export const FREE_MEMBER_LOCKED_MESSAGE = `Organisationen er på Gratis, som har plads til ${FREE_MAX_SEATS} brugere. Dine data er gemt — bed ejeren om at opgradere for at få adgang igen.`;

/** Samme besked på kaldets sprog (dansk uden kontekst). */
export function freeMemberLockedMessage(locale?: string | null): string {
  return sharedT(
    "sharedLabels",
    "freeMemberLocked",
    { seats: FREE_MAX_SEATS },
    locale,
  );
}

export interface FreeSeatCandidate {
  userId: string;
  role: string | null;
  createdAt: Date | string;
}

const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1 };

/**
 * Hvilke medlemmer der beholder adgang, når en organisation med flere end
 * `FREE_MAX_SEATS` medlemmer lander på Gratis (udløbet prøve eller opsagt
 * abonnement). Ejeren først, så administratorer, så resten efter hvornår de
 * blev medlem (ældst først). Rækkefølgen er stabil med vilje: den må ikke
 * skifte fordi et låst medlem logger ind, og ejeren styrer den ved at fjerne
 * medlemmer eller opgradere. Ingen data slettes — låste medlemmer kan stadig
 * logge ind, se abonnementssiden og eksportere deres data.
 */
export function freeSeatHolderIds(
  members: readonly FreeSeatCandidate[],
  limit: number = FREE_MAX_SEATS,
): Set<string> {
  const ranked = [...members].sort((a, b) => {
    const ra = ROLE_RANK[a.role ?? ""] ?? 2;
    const rb = ROLE_RANK[b.role ?? ""] ?? 2;
    if (ra !== rb) return ra - rb;
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  return new Set(ranked.slice(0, Math.max(0, limit)).map((m) => m.userId));
}

/** Det udsnit af subscription.getDetails som gaten har brug for. */
export interface PlanGateDetails {
  isFree: boolean;
  planTier: string | null;
  limits: { maxActiveClients: number | null };
  usage: { activeClients: number };
}

export interface PlanGate {
  /** Effektiv tier ("free" for Gratis/opsagte); null mens der indlæses eller uden abonnement. */
  tier: string | null;
  isLoading: boolean;
  /** Max aktive kunder; null = ubegrænset. */
  clientLimit: number | null;
  activeClients: number;
  /** Plads til endnu en aktiv kunde. */
  canAddClient: boolean;
}

/**
 * Udled UI-gaten fra getDetails.
 * - `undefined` = indlæser endnu → intet tilbydes og intet note-kort vises.
 * - `null` = intet abonnement → ingen plan-gate (serveren håndterer adgang).
 * - Admins har ingen plangrænser (spejler hasActiveSubscription).
 */
export function derivePlanGate(
  details: PlanGateDetails | null | undefined,
  opts: { isAdmin?: boolean } = {},
): PlanGate {
  if (details === undefined) {
    return {
      tier: null,
      isLoading: true,
      clientLimit: null,
      activeClients: 0,
      canAddClient: true,
    };
  }

  const activeClients = details?.usage.activeClients ?? 0;
  if (details === null || opts.isAdmin) {
    return {
      tier: details ? effectiveTier(details) : null,
      isLoading: false,
      clientLimit: null,
      activeClients,
      canAddClient: true,
    };
  }

  const tier = effectiveTier(details);
  const clientLimit = details.limits.maxActiveClients;
  return {
    tier,
    isLoading: false,
    clientLimit,
    activeClients,
    canAddClient: clientLimit === null || activeClients < clientLimit,
  };
}

function effectiveTier(details: PlanGateDetails): string {
  return details.isFree ? "free" : (details.planTier ?? "solo");
}
