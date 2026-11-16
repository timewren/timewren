import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { sharedT } from "@/i18n/shared-text";
import { maxSeatsForTier, type PlanTier } from "@/lib/config";
import type { db as DbHandle } from "@/lib/db";
import { clients, members } from "@/lib/db/schema";
import { capacityLimitsApply } from "./capacity-gate";
import {
  clientLimitMessage,
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
  freeSeatHolderIds,
  PRIVAT_MAX_ACTIVE_CLIENTS,
} from "./plan-gate";

type Db = typeof DbHandle;

// Bor i plan-gate.ts (klient-sikker), så dashboard-UI'et deler samme regel
export {
  clientLimitMessage,
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
  FREE_MEMBER_LOCKED_MESSAGE,
  freeMemberLockedMessage,
  freeSeatHolderIds,
  PRIVAT_MAX_ACTIVE_CLIENTS,
} from "./plan-gate";

export const FREE_CLIENT_LIMIT_MESSAGE = clientLimitMessage("free");
export const PRIVAT_CLIENT_LIMIT_MESSAGE = clientLimitMessage("privat");

/** Invitation afvist fordi Gratis-orgen har brugt alle sine pladser. */
export const FREE_SEAT_LIMIT_MESSAGE = `Gratis har plads til ${FREE_MAX_SEATS} brugere, inklusive afventende invitationer. Opgradér under Indstillinger → Abonnement for at invitere flere.`;

export function freeClientLimitMessage(locale?: string | null): string {
  return sharedT(
    "sharedLabels",
    "freeClientLimit",
    { clients: FREE_MAX_ACTIVE_CLIENTS },
    locale,
  );
}

export function freeSeatLimitMessage(locale?: string | null): string {
  return sharedT(
    "sharedLabels",
    "freeSeatLimit",
    { seats: FREE_MAX_SEATS },
    locale,
  );
}

export interface PlanLimits {
  /** Infinity = ingen grænse. */
  maxActiveClients: number;
  maxSeats: number;
}

/**
 * Produktgrænser pr. tier. Gratis: max 3 brugere og 3 aktive kunder. Privat:
 * 1 bruger og max 5 aktive kunder. Selvstændig, Team og Virksomhed har
 * ubegrænsede kunder. En ukendt/null tier behandles som solo (samme fallback
 * som resten af billing-koden). Grænserne gælder kun når capacityLimitsApply().
 */
export function planLimits(
  tier: PlanTier | string | null | undefined,
): PlanLimits {
  if (tier === "free") {
    return {
      maxActiveClients: FREE_MAX_ACTIVE_CLIENTS,
      maxSeats: FREE_MAX_SEATS,
    };
  }
  if (tier === "privat") {
    return {
      maxActiveClients: PRIVAT_MAX_ACTIVE_CLIENTS,
      maxSeats: maxSeatsForTier("privat"),
    };
  }
  return {
    maxActiveClients: Number.POSITIVE_INFINITY,
    maxSeats: maxSeatsForTier(tier ?? "solo"),
  };
}

/**
 * Kundeloftet som UI'et skal vise: null = ubegrænset. Selvhost uden billing
 * har ingen grænse (null), også for Gratis/Privat.
 */
export function displayedMaxActiveClients(
  tier: PlanTier | string | null | undefined,
): number | null {
  const max = planLimits(tier).maxActiveClients;
  return capacityLimitsApply() && Number.isFinite(max) ? max : null;
}

/**
 * Felter der sætter et abonnement på Gratis-tieren. Delt af trial-expire-cronen
 * (og spejlet i backfill-migrationen), så nedgraderingen er ens overalt. Data
 * røres ikke — kun tier, status og pladser.
 */
export const FREE_TIER_SUBSCRIPTION_FIELDS = {
  status: "free",
  planTier: "free",
  isTrial: false,
  // seatCount = betalte pladser (Gratis betaler for én), maxSeats = loftet.
  // seatCount må ikke være 3: webhooken bærer den med som betalt kapacitet
  // ved checkout (resolveBaseEventSeatCount → Team med 3 pladser for 2).
  seatCount: 1,
  maxSeats: FREE_MAX_SEATS,
} as const;

/**
 * True hvis brugeren er medlem nr. 4+ i en org på Gratis og derfor er låst
 * (se freeSeatHolderIds for rækkefølgen). Slår kun op i DB når orgen har
 * flere medlemmer end Gratis giver plads til.
 */
export async function isFreeTierMemberLocked(
  db: Db,
  orgId: string,
  userId: string,
): Promise<boolean> {
  if (!capacityLimitsApply()) return false;
  const rows = await db
    .select({
      userId: members.userId,
      role: members.role,
      createdAt: members.createdAt,
    })
    .from(members)
    .where(eq(members.organizationId, orgId));
  if (rows.length <= FREE_MAX_SEATS) return false;
  // Ikke-medlemmer (fx en personlig fallback-kontekst) låses ikke her.
  if (!rows.some((r) => r.userId === userId)) return false;
  return !freeSeatHolderIds(rows).has(userId);
}

/** True for et abonnement på Gratis-tieren (status eller tier "free"). */
export function isFreeSubscription(sub: {
  planTier?: string | null;
  status?: string | null;
}): boolean {
  // Opsagte betalere lander også på Gratis i stedet for betalingsmuren (CEO-beslutning 25/9)
  return (
    sub.status === "free" ||
    sub.status === "canceled" ||
    sub.planTier === "free"
  );
}

/** True hvis endnu en aktiv kunde kan tilføjes givet det nuværende antal. */
export function canAddActiveClient(
  tier: PlanTier | string | null | undefined,
  activeClients: number,
): boolean {
  return activeClients < planLimits(tier).maxActiveClients;
}

/**
 * Antal ikke-arkiverede kunder i org'en (eller brugerens egne uden org).
 * Org-løs tælles kun på rækker uden organizationId — ellers ville et fjernet
 * medlem stadig tælle (og dermed se) den forladte organisations kunder.
 */
export async function countActiveClients(
  db: Db,
  orgId: string | null | undefined,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clients)
    .where(
      and(
        orgId
          ? eq(clients.organizationId, orgId)
          : and(eq(clients.userId, userId), isNull(clients.organizationId)),
        eq(clients.isArchived, false),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Kast FORBIDDEN hvis tieren ikke har plads til endnu en aktiv kunde. En org
 * over loftet (fx Privat med 7 kunder fra før) mister intet: ingen arkiveres
 * og ingen låses, den kan blot ikke tilføje eller genaktivere flere. Springer
 * DB-opslaget over for tiers uden grænse, så betalende kunder ikke betaler en
 * ekstra query pr. oprettelse.
 */
export async function assertCanAddActiveClient(
  db: Db,
  opts: {
    planTier: string | null | undefined;
    orgId: string | null | undefined;
    userId: string;
  },
): Promise<void> {
  if (!capacityLimitsApply()) return;
  if (!Number.isFinite(planLimits(opts.planTier).maxActiveClients)) return;
  const active = await countActiveClients(db, opts.orgId, opts.userId);
  if (!canAddActiveClient(opts.planTier, active)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: clientLimitMessage(opts.planTier),
    });
  }
}
