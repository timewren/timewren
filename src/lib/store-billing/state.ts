/**
 * Ren tilstandslogik for butiksabonnementer (App Store / Google Play): fra
 * butikkens data til én snapshot, og fra snapshot til TimeTrack-status.
 * Ingen DB- eller netværks-imports, så alt her kan unit-testes direkte.
 */
import {
  appleProduct,
  googleProduct,
  type StoreCycle,
  type StorePlanTier,
  type StoreProvider,
} from "./products";

/**
 * Butikkens egen tilstand. `active` og `grace_period` giver adgang; de øvrige
 * lander på Gratis (samme sted som en opsagt web-betaler, isFreeSubscription).
 */
export type StoreState =
  | "active"
  | "grace_period"
  | "billing_retry"
  | "paused"
  | "expired"
  | "revoked";

export type StoreEnvironment = "Production" | "Sandbox";

export interface StoreSnapshot {
  provider: StoreProvider;
  productId: string;
  planTier: StorePlanTier;
  cycle: StoreCycle;
  environment: StoreEnvironment;
  storeState: StoreState;
  /** undefined = ukendt, bevar rækkens værdi. */
  periodStart?: Date;
  periodEnd?: Date;
  /** null = ukendt (fx en StoreKit-transaktion uden renewal info) — bevar rækkens værdi. */
  autoRenew: boolean | null;
  originalTransactionId?: string;
  purchaseToken?: string;
  /** Tidspunktet butikken har signeret/rapporteret tilstanden — bruges mod forsinkede events. */
  eventAt: Date;
}

/** Butiksdata der ikke skal skrives (afventende køb, erstattet transaktion …). */
export interface IgnoredStoreData {
  ignored:
    | "unknown_product"
    | "superseded"
    | "pending"
    | "missing_data"
    | "wrong_package";
}

export type DeriveResult = StoreSnapshot | IgnoredStoreData;

export function isIgnored(r: DeriveResult): r is IgnoredStoreData {
  return "ignored" in r;
}

const ENDED_STORE_STATES = new Set<string>(["expired", "revoked"]);

/**
 * Ejes rækkens abonnement (stadig) af en butik? Sandt fra køb til udløb/
 * refundering — også i grace period og billing retry, hvor butikken stadig
 * forsøger at trække betalingen. Så længe det gælder, må intet web-flow
 * (Alunta, crons, admin) skrive status eller tier på rækken.
 */
export function isStoreManaged(row: {
  storeProvider?: string | null;
  storeStatus?: string | null;
}): boolean {
  return !!row.storeProvider && !ENDED_STORE_STATES.has(row.storeStatus ?? "");
}

/** TimeTrack-status for en butikstilstand. */
export function rowStatusForStoreState(
  state: StoreState,
): "active" | "canceled" {
  return state === "active" || state === "grace_period" ? "active" : "canceled";
}

/** Lokale statusser der betyder et løbende web-abonnement (Alunta). */
const WEB_LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Har rækken et løbende web-abonnement (Alunta)? Så må der ikke købes i
 * appen (dobbeltbetaling). Opsagte web-abonnementer tæller med til
 * periodens udløb — de faktureres ikke igen, men perioden er betalt.
 */
export function hasActiveWebSubscription(row: {
  aluntaSubscriptionId?: string | null;
  status?: string | null;
  storeProvider?: string | null;
  storeStatus?: string | null;
}): boolean {
  return (
    !!row.aluntaSubscriptionId &&
    WEB_LIVE_STATUSES.has(row.status ?? "") &&
    !isStoreManaged(row)
  );
}

// ── Apple ────────────────────────────────────────────────────────────

/** Det udsnit af Apples JWSTransactionDecodedPayload vi bruger. */
export interface AppleTransactionData {
  originalTransactionId?: string;
  productId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  isUpgraded?: boolean;
  appAccountToken?: string;
  environment?: string;
  signedDate?: number;
}

/** Det udsnit af Apples JWSRenewalInfoDecodedPayload vi bruger. */
export interface AppleRenewalData {
  autoRenewStatus?: number;
  isInBillingRetryPeriod?: boolean;
  gracePeriodExpiresDate?: number;
}

export function deriveAppleSnapshot(params: {
  transaction: AppleTransactionData;
  renewalInfo?: AppleRenewalData | null;
  now: Date;
  /** Notifikationens signedDate; ellers transaktionens. */
  eventAt?: Date;
}): DeriveResult {
  const { transaction: tx, renewalInfo, now } = params;
  if (!tx.originalTransactionId || !tx.productId) {
    return { ignored: "missing_data" };
  }
  // En transaktion der er erstattet af en opgradering: den nye transaktion
  // (samme originalTransactionId) bærer den gældende plan.
  if (tx.isUpgraded) return { ignored: "superseded" };
  const product = appleProduct(tx.productId);
  if (!product) return { ignored: "unknown_product" };

  const nowMs = now.getTime();
  let storeState: StoreState;
  if (tx.revocationDate) {
    storeState = "revoked";
  } else if (tx.expiresDate && tx.expiresDate > nowMs) {
    storeState = "active";
  } else if (
    renewalInfo?.gracePeriodExpiresDate &&
    renewalInfo.gracePeriodExpiresDate > nowMs
  ) {
    storeState = "grace_period";
  } else if (renewalInfo?.isInBillingRetryPeriod) {
    storeState = "billing_retry";
  } else {
    storeState = "expired";
  }

  return {
    provider: "apple",
    productId: tx.productId,
    planTier: product.planTier,
    cycle: product.cycle,
    environment: tx.environment === "Sandbox" ? "Sandbox" : "Production",
    storeState,
    periodStart: tx.purchaseDate ? new Date(tx.purchaseDate) : undefined,
    periodEnd: tx.expiresDate ? new Date(tx.expiresDate) : undefined,
    autoRenew:
      renewalInfo?.autoRenewStatus === undefined
        ? null
        : renewalInfo.autoRenewStatus === 1,
    originalTransactionId: tx.originalTransactionId,
    eventAt:
      params.eventAt ??
      (tx.signedDate ? new Date(tx.signedDate) : new Date(nowMs)),
  };
}

// ── Google ───────────────────────────────────────────────────────────

/** Det udsnit af Play Developer API's SubscriptionPurchaseV2 vi bruger. */
export interface GooglePurchaseData {
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  startTime?: string;
  testPurchase?: object;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    offerDetails?: { basePlanId?: string };
  }>;
}

export function deriveGoogleSnapshot(params: {
  purchase: GooglePurchaseData;
  purchaseToken: string;
  now: Date;
}): DeriveResult {
  const { purchase, now } = params;
  const item = purchase.lineItems?.[0];
  if (!item?.productId) return { ignored: "missing_data" };
  const product = googleProduct(item.productId, item.offerDetails?.basePlanId);
  if (!product) return { ignored: "unknown_product" };

  const expiry = item.expiryTime ? new Date(item.expiryTime) : undefined;
  const stillValid = !!expiry && expiry.getTime() > now.getTime();
  let storeState: StoreState;
  switch (purchase.subscriptionState) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      storeState = "active";
      break;
    // Opsagt af brugeren, men perioden er betalt: adgang til udløb.
    case "SUBSCRIPTION_STATE_CANCELED":
      storeState = stillValid ? "active" : "expired";
      break;
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      storeState = "grace_period";
      break;
    case "SUBSCRIPTION_STATE_ON_HOLD":
      storeState = "billing_retry";
      break;
    case "SUBSCRIPTION_STATE_PAUSED":
      storeState = "paused";
      break;
    case "SUBSCRIPTION_STATE_EXPIRED":
      storeState = "expired";
      break;
    default:
      // PENDING, PENDING_PURCHASE_CANCELED og ukendte: aldrig adgang, og
      // intet at skrive før betalingen er gennemført.
      return { ignored: "pending" };
  }

  const autoRenew =
    purchase.subscriptionState === "SUBSCRIPTION_STATE_CANCELED"
      ? false
      : (item.autoRenewingPlan?.autoRenewEnabled ?? null);

  return {
    provider: "google",
    productId: item.productId,
    planTier: product.planTier,
    cycle: product.cycle,
    environment: purchase.testPurchase ? "Sandbox" : "Production",
    storeState,
    periodEnd: expiry,
    autoRenew,
    purchaseToken: params.purchaseToken,
    eventAt: now,
  };
}

// ── Kontraktens `current` ────────────────────────────────────────────

export interface StoreBillingCurrent {
  source: "apple" | "google" | "web" | "none";
  planTier: string | null;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  productId: string | null;
}

export interface CurrentSourceRow {
  status: string;
  planTier: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
  aluntaSubscriptionId: string | null;
  storeProvider: string | null;
  storeStatus: string | null;
  storeProductId: string | null;
}

/**
 * `current` i kontrakten. Kilden er butikken så længe rækken er
 * butiksejet; ellers web når rækken har et løbende Alunta-abonnement; ellers
 * none (prøve, Gratis eller et opsagt web-abonnement, som kan købes igen i
 * appen). Et udløbet butiksabonnement rapporteres stadig som butikkens, så
 * appen kan tilbyde at forny.
 */
export function currentFromRow(
  row: CurrentSourceRow | null | undefined,
): StoreBillingCurrent {
  if (!row) {
    return {
      source: "none",
      planTier: null,
      status: "none",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      productId: null,
    };
  }
  const storeSource =
    row.storeProvider === "apple" || row.storeProvider === "google"
      ? row.storeProvider
      : null;
  const source =
    storeSource && isStoreManaged(row)
      ? storeSource
      : hasActiveWebSubscription(row)
        ? "web"
        : (storeSource ?? "none");
  const isStore = source === "apple" || source === "google";
  return {
    source,
    planTier: row.planTier,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd
      ? row.currentPeriodEnd.toISOString()
      : null,
    cancelAtPeriodEnd: !!row.cancelAtPeriodEnd,
    productId: isStore ? row.storeProductId : null,
  };
}
