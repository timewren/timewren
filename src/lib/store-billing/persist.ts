import {
  and,
  eq,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  type SQL,
} from "drizzle-orm";
import { maxSeatsForTier } from "@/lib/config";
import type { db as DbHandle } from "@/lib/db";
import { storeBillingEvents, subscriptions } from "@/lib/db/schema";
import { rowStatusForStoreState, type StoreSnapshot } from "./state";

type Db = typeof DbHandle;
export type SubscriptionRow = typeof subscriptions.$inferSelect;

/**
 * SQL-modstykket til isStoreManaged: sand for rækker der IKKE ejes af en
 * butik (aldrig købt i appen, eller butiksabonnementet er udløbet/refunderet).
 * Bruges af crons og web-flows, så de aldrig nedgraderer, opkræver eller
 * mailer om et abonnement App Store/Google Play fakturerer.
 */
export function notStoreManaged(): SQL {
  return or(
    isNull(subscriptions.storeProvider),
    inArray(subscriptions.storeStatus, ["expired", "revoked"]),
  ) as SQL;
}

export async function findRowByAppleOriginalTransactionId(
  db: Db,
  originalTransactionId: string,
) {
  return (
    (await db.query.subscriptions.findFirst({
      where: eq(
        subscriptions.storeOriginalTransactionId,
        originalTransactionId,
      ),
    })) ?? null
  );
}

export async function findRowByGooglePurchaseToken(
  db: Db,
  purchaseToken: string,
) {
  return (
    (await db.query.subscriptions.findFirst({
      where: eq(subscriptions.storePurchaseToken, purchaseToken),
    })) ?? null
  );
}

export type ApplyOutcome = "applied" | "stale" | "past_period";

const ENDED_STATES: string[] = ["expired", "revoked"];
const WEB_LIVE_STATUSES = ["active", "trialing", "past_due"];

/** Null-sikker lighed: rækkens købs-id skal stadig være det, vi læste. */
function unchanged(
  column:
    | typeof subscriptions.storeOriginalTransactionId
    | typeof subscriptions.storePurchaseToken,
  value: string | null,
): SQL {
  return value === null ? isNull(column) : eq(column, value);
}

/**
 * Skriv en butikssnapshot på rækken.
 *
 * - Atomisk mod forsinkede events: en snapshot ældre end rækkens
 *   storeLastEventAt skrives ikke, medmindre det er et andet køb end det
 *   rækken kender (`force`).
 * - Optimistisk samtidighed: skrivningen kræver, at rækkens købs-id stadig er
 *   det, der blev læst — ellers har en samtidig notifikation (fx Googles nye
 *   token ved et plan-skift) allerede overtaget rækken, og den vinder.
 * - En Apple-transaktion for en tidligere periode (fx refundering af sidste
 *   års fornyelse) ændrer ikke den aktuelle periode.
 * - `storeColumnsOnly`: rækken ejes ikke længere af butikken (web/admin har
 *   overtaget den) — kun butikkens egne kolonner opdateres, aldrig status,
 *   plan eller pladser.
 */
export async function applyStoreSnapshot(
  db: Db,
  row: SubscriptionRow,
  snap: StoreSnapshot,
  opts: {
    force?: boolean;
    now?: Date;
    /** Knyt rækken til organisationen, hvis den ikke har nogen. */
    organizationId?: string | null;
    storeColumnsOnly?: boolean;
    /**
     * Skriv kun, hvis rækken stadig ikke har et løbende web-abonnement
     * (Alunta kan have overtaget den, siden den blev læst).
     */
    requireNoActiveWeb?: boolean;
  } = {},
): Promise<{ row: SubscriptionRow; applied: boolean; outcome: ApplyOutcome }> {
  const now = opts.now ?? new Date();
  const isApple = snap.provider === "apple";

  if (
    !opts.force &&
    isApple &&
    row.storeOriginalTransactionId === snap.originalTransactionId &&
    snap.periodStart &&
    row.currentPeriodStart &&
    snap.periodStart.getTime() < row.currentPeriodStart.getTime()
  ) {
    return { row, applied: false, outcome: "past_period" };
  }

  const status = rowStatusForStoreState(snap.storeState);
  const live = status === "active";
  const cancelAtPeriodEnd =
    snap.autoRenew === null ? undefined : live && !snap.autoRenew;
  const willCancel = !live || (cancelAtPeriodEnd ?? row.cancelAtPeriodEnd);

  const storeColumns = {
    storeProductId: snap.productId,
    storeEnvironment: snap.environment,
    storeStatus: snap.storeState,
    storeLastEventAt: snap.eventAt,
    updatedAt: now,
  };
  const values = opts.storeColumnsOnly
    ? {
        ...storeColumns,
        // Kun en ophørt tilstand: en "billing_retry"/"paused" ville gøre en
        // web-ejet række butiksejet igen (isStoreManaged).
        storeStatus: ENDED_STATES.includes(snap.storeState)
          ? snap.storeState
          : undefined,
      }
    : {
        ...storeColumns,
        storeProvider: snap.provider,
        // Ét købs-id ad gangen: skifter brugeren butik, slippes det gamle
        // id, så den gamle butiks notifikationer ikke længere rammer rækken.
        storeOriginalTransactionId: isApple ? snap.originalTransactionId : null,
        storePurchaseToken: isApple ? null : snap.purchaseToken,
        ...(opts.organizationId && !row.organizationId
          ? { organizationId: opts.organizationId }
          : {}),
        status,
        planTier: snap.planTier,
        billingCycle: snap.cycle,
        seatCount: 1,
        maxSeats: maxSeatsForTier(snap.planTier),
        isTrial: false,
        currentPeriodStart: snap.periodStart,
        currentPeriodEnd: snap.periodEnd,
        cancelAtPeriodEnd: live ? cancelAtPeriodEnd : false,
        canceledAt: willCancel ? (row.canceledAt ?? now) : null,
        pastDueSince: null,
      };

  const [updated] = await db
    .update(subscriptions)
    .set(values)
    .where(
      and(
        eq(subscriptions.id, row.id),
        unchanged(
          subscriptions.storeOriginalTransactionId,
          row.storeOriginalTransactionId,
        ),
        unchanged(subscriptions.storePurchaseToken, row.storePurchaseToken),
        opts.requireNoActiveWeb
          ? or(
              isNull(subscriptions.aluntaSubscriptionId),
              notInArray(subscriptions.status, WEB_LIVE_STATUSES),
            )
          : undefined,
        opts.force
          ? undefined
          : or(
              isNull(subscriptions.storeLastEventAt),
              lte(subscriptions.storeLastEventAt, snap.eventAt),
            ),
      ),
    )
    .returning();

  if (updated) return { row: updated, applied: true, outcome: "applied" };
  const current = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, row.id),
  });
  return { row: current ?? row, applied: false, outcome: "stale" };
}

/** Er notifikationen allerede behandlet? (gen-levering fra Apple/Pub/Sub) */
export async function storeEventSeen(
  db: Db,
  provider: "apple" | "google",
  eventId: string,
): Promise<boolean> {
  const existing = await db.query.storeBillingEvents.findFirst({
    where: and(
      eq(storeBillingEvents.provider, provider),
      eq(storeBillingEvents.eventId, eventId),
    ),
    columns: { id: true },
  });
  return !!existing;
}

/**
 * Registrér en behandlet notifikation. Skrives EFTER behandlingen, så en
 * fejl midtvejs ikke blokerer gen-leveringen; samtidige dubletter er ufarlige,
 * fordi selve skrivningen er idempotent (seneste tilstand vinder).
 */
export async function recordStoreEvent(
  db: Db,
  values: {
    provider: "apple" | "google";
    eventId: string;
    notificationType: string | null;
    subscriptionId: string | null;
    outcome: string;
  },
) {
  await db
    .insert(storeBillingEvents)
    .values(values)
    .onConflictDoNothing({
      target: [storeBillingEvents.provider, storeBillingEvents.eventId],
    });
}
