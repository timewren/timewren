import {
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { sharedT } from "@/i18n/shared-text";
import { countSeatUsage } from "@/lib/billing/seat-usage";
import type { db as DbHandle } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/pg-errors";
import { subscriptions } from "@/lib/db/schema";
import { notifyAdmin } from "@/lib/notifications/admin";
import { getOrgRole } from "@/lib/trpc/middleware/org-role";
import { resolveActiveSubscription } from "@/lib/trpc/routers/subscription";
import { accountTokenMatches } from "./account-token";
import type { AppleVerifier } from "./apple";
import {
  type GooglePlayClient,
  GooglePlayPurchaseNotFoundError,
  googlePlayPackageName,
} from "./google";
import {
  applyStoreSnapshot,
  findRowByAppleOriginalTransactionId,
  findRowByGooglePurchaseToken,
  recordStoreEvent,
  type SubscriptionRow,
  storeEventSeen,
} from "./persist";
import { storeProviderLabel } from "./products";
import {
  currentFromRow,
  deriveAppleSnapshot,
  deriveGoogleSnapshot,
  hasActiveWebSubscription,
  isIgnored,
  isStoreManaged,
  rowStatusForStoreState,
  type StoreBillingCurrent,
  type StoreSnapshot,
} from "./state";

type Db = typeof DbHandle;

/** Køb i appen er mørkt, indtil STORE_BILLING_ENABLED=1. */
export function isStoreBillingEnabled(): boolean {
  return process.env.STORE_BILLING_ENABLED === "1";
}

export type PurchaseBlockReason =
  | "disabled"
  | "not_owner"
  | "multi_member"
  | "web_subscription"
  | "other_organization";

export interface PurchaseBlock {
  code: "PRECONDITION_FAILED" | "FORBIDDEN" | "CONFLICT";
  reason: PurchaseBlockReason;
  message: string;
}

const msgWeb = () => sharedT("sharedLabels", "store.managedOnAccount");

/**
 * Må brugeren købe Privat/Selvstændig i appen, og i hvilken række skal købet
 * ligge? Privat og Selvstændig er én bruger: kun organisationens ejer, og kun
 * når organisationen ikke har andre brugere. Et løbende web-abonnement
 * (Alunta) blokerer (CONFLICT), så kunden ikke betaler to steder.
 */
export async function purchaseEligibility(
  db: Db,
  orgId: string | null | undefined,
  userId: string,
): Promise<{ row: SubscriptionRow | null; block: PurchaseBlock | null }> {
  if (orgId) {
    const role = await getOrgRole(db, userId, orgId);
    if (role !== "owner") {
      return {
        row: null,
        block: {
          code: "FORBIDDEN",
          reason: "not_owner",
          message: sharedT("sharedLabels", "store.ownerOnly"),
        },
      };
    }
    const seats = await countSeatUsage(db, orgId);
    if (seats.total > 1) {
      return {
        row: null,
        block: {
          code: "CONFLICT",
          reason: "multi_member",
          message: sharedT("sharedLabels", "store.multiMember"),
        },
      };
    }
  }

  const resolved = await resolveActiveSubscription(db, orgId, userId);
  if (resolved && hasActiveWebSubscription(resolved)) {
    return {
      row: resolved,
      block: {
        code: "CONFLICT",
        reason: "web_subscription",
        message: msgWeb(),
      },
    };
  }

  // subscriptions.userId er unik: købet ligger altid i brugerens egen række.
  const own =
    resolved?.userId === userId
      ? resolved
      : ((await db.query.subscriptions.findFirst({
          where: eq(subscriptions.userId, userId),
        })) ?? null);
  if (own && hasActiveWebSubscription(own)) {
    return {
      row: own,
      block: {
        code: "CONFLICT",
        reason: "web_subscription",
        message: msgWeb(),
      },
    };
  }
  if (own?.organizationId && own.organizationId !== (orgId ?? null)) {
    return {
      row: own,
      block: {
        code: "CONFLICT",
        reason: "other_organization",
        message: sharedT("sharedLabels", "store.otherOrganization"),
      },
    };
  }
  return { row: own, block: null };
}

function throwBlock(block: PurchaseBlock): never {
  throw new TRPCError({ code: block.code, message: block.message });
}

async function ensureOwnRow(
  db: Db,
  userId: string,
  orgId: string | null | undefined,
  now: Date,
): Promise<SubscriptionRow> {
  // Pladsholder; applyStoreSnapshot overskriver status/tier/periode straks.
  await db
    .insert(subscriptions)
    .values({
      userId,
      organizationId: orgId ?? null,
      billingCycle: "monthly",
      status: "trialing",
      isTrial: false,
      trialEndsAt: now,
    })
    .onConflictDoNothing({ target: subscriptions.userId });
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  if (!row) throw new Error("Kunne ikke oprette abonnementsrække");
  return row;
}

const isLive = (snap: StoreSnapshot) =>
  rowStatusForStoreState(snap.storeState) === "active";

/**
 * Fælles binding for et verificeret køb: konfliktregler, oprettelse af
 * rækken og skrivning. `sameIdentity` = rækken kender allerede købet (eller
 * Googles forgænger-token ved et plan-skift).
 */
async function bindSnapshot(
  db: Db,
  params: {
    userId: string;
    orgId: string | null | undefined;
    snap: StoreSnapshot;
    sameIdentity: (row: SubscriptionRow) => boolean;
    now: Date;
  },
): Promise<SubscriptionRow | null> {
  const { userId, orgId, now } = params;
  let snap = params.snap;
  const { row: target, block } = await purchaseEligibility(db, orgId, userId);
  // StoreKit har allerede trukket pengene, når appen sender et Apple-køb, og
  // Apple refunderer ikke selv (Google refunderer et køb uden acknowledge).
  // Afvises et betalt køb, har kunden betalt uden adgang, og den senere
  // App Store-notifikation finder ingen række: en admin skal have besked.
  const alertPaidButRejected = async (reason: string) => {
    if (snap.provider !== "apple" || !isLive(snap)) return;
    await notifyAdmin("subscription_duplicate", {
      userId,
      reason: `Betalt køb i appen (App Store, original transaction ${snap.originalTransactionId ?? "ukendt"}) blev afvist: ${reason}. Kunden har betalt uden adgang. Refundér eller bind købet manuelt.`,
    });
  };
  if (block) {
    await alertPaidButRejected(block.reason);
    throwBlock(block);
  }

  // Appen sender kun købet videre; nedgraderinger (udløb, refundering,
  // billing retry) kommer udelukkende fra butikkens notifikationer. Så kan
  // et gammelt køb ("Gendan køb") aldrig overskrive en prøveperiode, og en
  // transaktion uden renewal info aldrig tage adgangen i en grace period.
  if (!isLive(snap)) return target;
  const same = !!target && params.sameIdentity(target);
  if (target && isStoreManaged(target) && !same) {
    await alertPaidButRejected(
      `brugeren har allerede et abonnement via ${storeProviderLabel(target.storeProvider)}`,
    );
    throw new TRPCError({
      code: "CONFLICT",
      message: sharedT("sharedLabels", "store.alreadySubscribed", {
        store: storeProviderLabel(target.storeProvider),
      }),
    });
  }
  // Nyt køb uden renewal info: et netop købt abonnement fornyes.
  if (!same && snap.autoRenew === null) snap = { ...snap, autoRenew: true };

  const row = target ?? (await ensureOwnRow(db, userId, orgId, now));
  try {
    const result = await applyStoreSnapshot(db, row, snap, {
      force: !same,
      now,
      organizationId: orgId,
    });
    return result.row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: msgOtherAccount(),
      });
    }
    throw err;
  }
}

const msgOtherAccount = () => sharedT("sharedLabels", "store.otherAccount");

export async function verifyApplePurchase(
  db: Db,
  params: {
    userId: string;
    orgId: string | null | undefined;
    signedTransaction: string;
    verifier: AppleVerifier;
    now?: Date;
  },
): Promise<StoreBillingCurrent> {
  const now = params.now ?? new Date();
  let tx: Awaited<ReturnType<AppleVerifier["verifyTransaction"]>>;
  try {
    tx = await params.verifier.verifyTransaction(params.signedTransaction);
  } catch (err) {
    // OCSP-/netværksfejl hos Apple er forbigående: appen skal prøve igen
    // (transaktionen er ikke afsluttet). Alt andet er en ugyldig JWS.
    if (
      err instanceof VerificationException &&
      err.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
    ) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: sharedT("sharedLabels", "store.appStoreUnreachable"),
        cause: err,
      });
    }
    console.warn(
      `[StoreBilling] Apple-transaktion afvist (status ${err instanceof VerificationException ? err.status : "ukendt"})`,
    );
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: sharedT("sharedLabels", "store.appStoreVerify"),
    });
  }
  if (!accountTokenMatches(params.userId, tx.appAccountToken)) {
    throw new TRPCError({ code: "FORBIDDEN", message: msgOtherAccount() });
  }
  const derived = deriveAppleSnapshot({ transaction: tx, now });
  if (isIgnored(derived)) {
    if (derived.ignored === "superseded") {
      const { row } = await purchaseEligibility(
        db,
        params.orgId,
        params.userId,
      );
      return currentFromRow(row);
    }
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: sharedT("sharedLabels", "store.unknownProduct"),
    });
  }
  const holder = await findRowByAppleOriginalTransactionId(
    db,
    derived.originalTransactionId as string,
  );
  if (holder && holder.userId !== params.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: msgOtherAccount() });
  }
  const row = await bindSnapshot(db, {
    userId: params.userId,
    orgId: params.orgId,
    snap: derived,
    sameIdentity: (r) =>
      r.storeOriginalTransactionId === derived.originalTransactionId,
    now,
  });
  return currentFromRow(row);
}

export async function verifyGooglePurchase(
  db: Db,
  params: {
    userId: string;
    orgId: string | null | undefined;
    productId: string;
    purchaseToken: string;
    client: GooglePlayClient;
    now?: Date;
  },
): Promise<StoreBillingCurrent> {
  const now = params.now ?? new Date();
  const { purchaseToken } = params;
  let purchase: Awaited<ReturnType<GooglePlayClient["getSubscription"]>>;
  try {
    purchase = await params.client.getSubscription(purchaseToken);
  } catch (err) {
    if (err instanceof GooglePlayPurchaseNotFoundError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: sharedT("sharedLabels", "store.googleNotFound"),
      });
    }
    throw err;
  }
  if (
    !accountTokenMatches(
      params.userId,
      purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId,
    )
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: msgOtherAccount() });
  }
  const derived = deriveGoogleSnapshot({ purchase, purchaseToken, now });
  if (isIgnored(derived)) {
    if (derived.ignored === "pending") {
      // Afventende betaling: ingen adgang og ingen acknowledge endnu. Appen
      // sender købet igen, når Google melder det gennemført.
      const { row } = await purchaseEligibility(
        db,
        params.orgId,
        params.userId,
      );
      return currentFromRow(row);
    }
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: sharedT("sharedLabels", "store.unknownProduct"),
    });
  }
  if (derived.productId !== params.productId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: sharedT("sharedLabels", "store.productMismatch"),
    });
  }
  const holder = await findRowByGooglePurchaseToken(db, purchaseToken);
  if (holder && holder.userId !== params.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: msgOtherAccount() });
  }
  const linked = purchase.linkedPurchaseToken;
  const row = await bindSnapshot(db, {
    userId: params.userId,
    orgId: params.orgId,
    snap: derived,
    sameIdentity: (r) =>
      !!r.storePurchaseToken &&
      (r.storePurchaseToken === purchaseToken ||
        r.storePurchaseToken === linked),
    now,
  });

  // Uden acknowledge refunderer Google købet efter 3 dage. Først når rækken
  // er skrevet; fejler det, kaster vi, så appen sender købet igen (idempotent).
  if (
    row?.storePurchaseToken === purchaseToken &&
    purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING" &&
    isLive(derived)
  ) {
    try {
      await params.client.acknowledge(derived.productId, purchaseToken);
    } catch (err) {
      console.error("[StoreBilling] Google acknowledge fejlede:", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: sharedT("sharedLabels", "store.googleAck"),
        cause: err,
      });
    }
  }
  return currentFromRow(row);
}

// ── Notifikationer ──────────────────────────────────────────────────

export interface NotificationOutcome {
  outcome: string;
  eventId: string | null;
  notificationType: string | null;
  subscriptionId: string | null;
}

const WEB_LIVE_ROW_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Skriv en notifikations snapshot under hensyn til, hvem der ejer rækken nu.
 * Er butiksabonnementet sluttet, og har web (Alunta) eller en admin siden
 * overtaget rækken, må en sen butiksnotifikation for det gamle køb aldrig
 * ændre status, plan eller pladser — kun butikkens egne kolonner. Bliver det
 * gamle køb fornyet (fx genoptaget i iOS-indstillinger), mens et web-
 * abonnement løber, betaler kunden to steder: intet skrives, admin får besked.
 */
async function applyNotificationSnapshot(
  db: Db,
  row: SubscriptionRow,
  snap: StoreSnapshot,
  opts: { force?: boolean; now: Date },
): Promise<string> {
  if (!isStoreManaged(row)) {
    if (!isLive(snap)) {
      const r = await applyStoreSnapshot(db, row, snap, {
        ...opts,
        storeColumnsOnly: true,
      });
      return r.applied ? "store_columns_only" : r.outcome;
    }
    // Adgang fra et andet sted (web-abonnement eller en admin-tildelt
    // Team/Virksomhed) må et genoplivet butikskøb ikke overskrive.
    const otherAccess =
      hasActiveWebSubscription(row) ||
      (WEB_LIVE_ROW_STATUSES.has(row.status) &&
        row.planTier !== "privat" &&
        row.planTier !== "solo");
    if (otherAccess) {
      await notifyAdmin("subscription_duplicate", {
        userId: row.userId,
        reason: `Køb i appen (${storeProviderLabel(snap.provider)}) er aktivt igen på række ${row.id}, som også har adgang andetsteds fra (status ${row.status}, plan ${row.planTier}, Alunta ${row.aluntaSubscriptionId ?? "ingen"}). Muligt dobbelt-abonnement — rækken er ikke ændret; verificér og annullér det ene manuelt.`,
      });
      return "conflict_web_subscription";
    }
    const r = await applyStoreSnapshot(db, row, snap, {
      ...opts,
      requireNoActiveWeb: true,
    });
    return r.outcome;
  }
  const r = await applyStoreSnapshot(db, row, snap, opts);
  return r.outcome;
}

/**
 * App Store Server Notifications V2. Verificerer signedPayload og de indlejrede
 * transaction/renewal-JWS'er og skriver den afledte tilstand på rækken, der
 * kender originalTransactionId. Ukendte køb ignoreres: appen binder dem
 * selv via verifyApple (StoreKit leverer ufærdige transaktioner igen).
 * Kaster ved ugyldig signatur.
 */
export async function handleAppleNotification(
  db: Db,
  signedPayload: string,
  verifier: AppleVerifier,
  now: Date = new Date(),
): Promise<NotificationOutcome> {
  const decoded = await verifier.verifyNotification(signedPayload);
  const eventId = decoded.notificationUUID ?? null;
  const notificationType = [decoded.notificationType, decoded.subtype]
    .filter(Boolean)
    .join(":");
  const result = (outcome: string, subscriptionId: string | null = null) => ({
    outcome,
    eventId,
    notificationType,
    subscriptionId,
  });

  if (eventId && (await storeEventSeen(db, "apple", eventId))) {
    return result("duplicate");
  }

  const finish = async (outcome: string, subscriptionId: string | null) => {
    if (eventId) {
      await recordStoreEvent(db, {
        provider: "apple",
        eventId,
        notificationType,
        subscriptionId,
        outcome,
      });
    }
    return result(outcome, subscriptionId);
  };

  if (decoded.notificationType === "TEST") return finish("test", null);
  const signedTx = decoded.data?.signedTransactionInfo;
  if (!signedTx) return finish("ignored_no_transaction", null);

  const tx = await verifier.verifyTransaction(signedTx);
  const renewalInfo = decoded.data?.signedRenewalInfo
    ? await verifier.verifyRenewalInfo(decoded.data.signedRenewalInfo)
    : null;
  if (!tx.originalTransactionId) return finish("ignored_missing_data", null);

  const row = await findRowByAppleOriginalTransactionId(
    db,
    tx.originalTransactionId,
  );
  if (!row) return finish("unknown_subscription", null);
  if (
    tx.appAccountToken &&
    !accountTokenMatches(row.userId, tx.appAccountToken)
  ) {
    return finish("account_mismatch", row.id);
  }

  const derived = deriveAppleSnapshot({
    transaction: tx,
    renewalInfo,
    now,
    eventAt: decoded.signedDate ? new Date(decoded.signedDate) : now,
  });
  if (isIgnored(derived)) return finish(`ignored_${derived.ignored}`, row.id);

  return finish(
    await applyNotificationSnapshot(db, row, derived, { now }),
    row.id,
  );
}

/** Pub/Sub push-body for Google Play Real-time developer notifications. */
export interface PubSubPushBody {
  message?: {
    data?: string;
    messageId?: string;
    message_id?: string;
  };
}

interface DeveloperNotification {
  packageName?: string;
  subscriptionNotification?: {
    notificationType?: number;
    purchaseToken?: string;
  };
  voidedPurchaseNotification?: { purchaseToken?: string };
  testNotification?: unknown;
}

/**
 * Google Play RTDN. Notifikationen bærer kun et purchaseToken og en type;
 * den aktuelle tilstand hentes altid frisk hos Google (subscriptionsv2.get),
 * så rækkefølgen af notifikationer er ligegyldig. Et nyt token fra et
 * plan-skift findes via linkedPurchaseToken og overtager rækken.
 * Kaster ved forbigående fejl, så Pub/Sub leverer igen.
 */
export async function handleGooglePlayNotification(
  db: Db,
  body: PubSubPushBody,
  client: GooglePlayClient,
  now: Date = new Date(),
): Promise<NotificationOutcome> {
  const eventId = body.message?.messageId ?? body.message?.message_id ?? null;
  let notification: DeveloperNotification;
  try {
    notification = JSON.parse(
      Buffer.from(body.message?.data ?? "", "base64").toString("utf8"),
    );
  } catch {
    return {
      outcome: "ignored_bad_payload",
      eventId,
      notificationType: null,
      subscriptionId: null,
    };
  }
  const notificationType = notification.subscriptionNotification
    ? `subscription:${notification.subscriptionNotification.notificationType ?? "?"}`
    : notification.voidedPurchaseNotification
      ? "voided"
      : notification.testNotification
        ? "test"
        : "other";
  const result = (outcome: string, subscriptionId: string | null = null) => ({
    outcome,
    eventId,
    notificationType,
    subscriptionId,
  });

  if (notification.packageName !== googlePlayPackageName()) {
    return result("ignored_wrong_package");
  }
  if (eventId && (await storeEventSeen(db, "google", eventId))) {
    return result("duplicate");
  }
  const finish = async (outcome: string, subscriptionId: string | null) => {
    if (eventId) {
      await recordStoreEvent(db, {
        provider: "google",
        eventId,
        notificationType,
        subscriptionId,
        outcome,
      });
    }
    return result(outcome, subscriptionId);
  };

  const token =
    notification.subscriptionNotification?.purchaseToken ??
    notification.voidedPurchaseNotification?.purchaseToken;
  if (notification.testNotification) return finish("test", null);
  if (!token) return finish("ignored_no_token", null);

  let purchase: Awaited<ReturnType<GooglePlayClient["getSubscription"]>>;
  try {
    purchase = await client.getSubscription(token);
  } catch (err) {
    if (err instanceof GooglePlayPurchaseNotFoundError) {
      return finish("unknown_purchase", null);
    }
    throw err;
  }

  const row =
    (await findRowByGooglePurchaseToken(db, token)) ??
    (purchase.linkedPurchaseToken
      ? await findRowByGooglePurchaseToken(db, purchase.linkedPurchaseToken)
      : null);
  if (!row) return finish("unknown_subscription", null);
  if (
    !accountTokenMatches(
      row.userId,
      purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId,
    )
  ) {
    return finish("account_mismatch", row.id);
  }

  const derived = deriveGoogleSnapshot({ purchase, purchaseToken: token, now });
  if (isIgnored(derived)) return finish(`ignored_${derived.ignored}`, row.id);

  const isNewToken = row.storePurchaseToken !== token;
  // Et nyt token i kæden må kun overtage rækken når det giver adgang; et
  // udløbet forgænger-token må aldrig overskrive efterfølgeren.
  if (isNewToken && !isLive(derived)) {
    return finish("ignored_superseded", row.id);
  }
  const outcome = await applyNotificationSnapshot(db, row, derived, {
    force: isNewToken,
    now,
  });
  if (
    outcome === "applied" &&
    purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING" &&
    isLive(derived)
  ) {
    await client.acknowledge(derived.productId, token);
  }
  return finish(outcome, row.id);
}

const MANAGED_STATES = ["active", "grace_period", "billing_retry", "paused"];

/**
 * Sikkerhedsnet for tabte notifikationer (fx en webhook-URL der pegede på et
 * miljø med flaget slået fra, eller Pub/Sub der opgav). Butiksrækker, hvis
 * periode er overskredet uden at butikken har meldt fornyelse eller udløb:
 * - Google: tilstanden hentes frisk og skrives som en notifikation.
 * - Apple: kræver App Store Server API (ikke i første version) — rækkerne
 *   returneres, så cronen kan alarmere i stedet for at gætte.
 */
export async function sweepStoreSubscriptions(
  db: Db,
  client: GooglePlayClient,
  now: Date = new Date(),
): Promise<{
  googleChecked: number;
  googleUpdated: number;
  googleFailed: number;
  /** Google-rækker sweepen tog adgangen fra — kan skyldes et tabt nyt token. */
  googleDowngradedIds: string[];
  appleOverdueIds: string[];
}> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await db.query.subscriptions.findMany({
    where: and(
      isNotNull(subscriptions.storeProvider),
      inArray(subscriptions.storeStatus, MANAGED_STATES),
      lt(subscriptions.currentPeriodEnd, dayAgo),
    ),
  });

  let googleChecked = 0;
  let googleUpdated = 0;
  let googleFailed = 0;
  const appleOverdueIds: string[] = [];
  const googleDowngradedIds: string[] = [];
  // Apples grace period er højst 28 dage; derefter er en "grace"-række uden
  // notifikation også overskredet.
  const graceLimit = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  for (const row of rows) {
    if (row.storeProvider === "google" && row.storePurchaseToken) {
      googleChecked++;
      try {
        const purchase = await client.getSubscription(row.storePurchaseToken);
        const derived = deriveGoogleSnapshot({
          purchase,
          purchaseToken: row.storePurchaseToken,
          now,
        });
        if (isIgnored(derived)) continue;
        const outcome = await applyNotificationSnapshot(db, row, derived, {
          now,
        });
        if (outcome === "applied") {
          googleUpdated++;
          if (row.status === "active" && !isLive(derived)) {
            googleDowngradedIds.push(row.id);
          }
        }
      } catch (err) {
        googleFailed++;
        console.error(
          `[StoreBilling] Sweep: Google-række ${row.id} kunne ikke opdateres:`,
          err instanceof Error ? err.message : err,
        );
      }
    } else if (row.storeProvider === "apple") {
      const hasAccess =
        row.storeStatus === "active" ||
        (row.storeStatus === "grace_period" &&
          !!row.currentPeriodEnd &&
          row.currentPeriodEnd < graceLimit);
      if (hasAccess) appleOverdueIds.push(row.id);
    }
  }
  return {
    googleChecked,
    googleUpdated,
    googleFailed,
    googleDowngradedIds,
    appleOverdueIds,
  };
}
