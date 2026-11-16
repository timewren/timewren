import type { ProductSubscription, Purchase, PurchaseError, RequestPurchaseProps } from 'expo-iap';
import type { PurchaseBlockedReason, StoreBillingConfig, StoreCycle, StorePlanTier, StorePlatform, StoreProduct, StoreSubscription } from './store-billing-api';
import type { TxKeyPath } from '~/lib/i18n';
import { Platform } from 'react-native';
import { isTRPCClientError } from '~/lib/api';

/**
 * Ren købslogik: produkter fra serverens config, butikkens priser, købsforespørgsler
 * og fejltekster. Ingen kald til butikken eller serveren her (se purchase-flow.ts).
 */

/** Én købbar kombination af plan og periode med butikkens pris. */
export type StoreOffer = {
  planTier: StorePlanTier;
  cycle: StoreCycle;
  productId: string;
  basePlanId?: string;
  /** Butikkens lokaliserede pris, fx "29,00 kr." Aldrig hardkodet. */
  displayPrice: string;
  /** Android: basisplanens offerToken, som Play Billing kræver ved køb. */
  offerToken?: string;
};

export const PLAN_TIERS: readonly StorePlanTier[] = ['privat', 'solo'];

/** Butikken på denne enhed, eller null (web/test uden butik). */
export function storePlatform(os: string = Platform.OS): StorePlatform | null {
  return os === 'ios' || os === 'android' ? os : null;
}

const STORE_SOURCE: Record<StorePlatform, StoreSubscription['source']> = { ios: 'apple', android: 'google' };

/** TimeTracks status (ikke butikkens) for et abonnement, der giver adgang lige nu. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Butikken bag et løbende abonnement, eller null. Serveren sender også `apple`/`google` for et
 * udløbet eller refunderet butikskøb (status `canceled`); det tæller ikke som et abonnement.
 */
export function liveStoreSource(current: StoreSubscription): 'apple' | 'google' | null {
  const source = current.source;
  return (source === 'apple' || source === 'google') && LIVE_STATUSES.has(current.status) ? source : null;
}

/**
 * Abonnementet er købt i den ANDEN butik (fx App Store, men appen kører på Android). Her tæller
 * også status `canceled`: den dækker både et udløbet køb og et, butikken stadig prøver at
 * trække betaling for (billing retry, on hold), og så må kunden ikke kunne betale to steder.
 */
export function isOtherStore(config: StoreBillingConfig, platform: StorePlatform): boolean {
  const source = config.current.source;
  return (source === 'apple' || source === 'google') && source !== STORE_SOURCE[platform];
}

/**
 * Køb vises kun, når serveren tager imod et køb fra kontoen (`canPurchase`), kontoen ikke har
 * et web-abonnement, og et eksisterende butiksabonnement er fra denne butik. Ellers kunne
 * brugeren betale uden at få planen, eller betale to steder.
 */
export function canBuyInApp(config: StoreBillingConfig | undefined, platform: StorePlatform | null): boolean {
  if (!config || !platform || !config.enabled || !config.canPurchase || config.current.source === 'web')
    return false;
  return !isOtherStore(config, platform);
}

const BLOCKED_KEYS: Record<PurchaseBlockedReason, TxKeyPath> = {
  disabled: 'billing.blocked.disabled',
  not_owner: 'billing.blocked.not_owner',
  multi_member: 'billing.blocked.multi_member',
  other_organization: 'billing.blocked.other_organization',
  web_subscription: 'billing.account_managed',
};

/** Forklaringen, når serveren ikke tager imod køb fra kontoen. `null`, når køb er muligt. */
export function purchaseBlockedKey(config: StoreBillingConfig): TxKeyPath | null {
  if (config.canPurchase)
    return null;
  const reason = config.purchaseBlockedReason;
  return (reason && BLOCKED_KEYS[reason]) || 'billing.blocked.disabled';
}

export function platformProducts(products: StoreProduct[], platform: StorePlatform): StoreProduct[] {
  return products.filter(p => p.platform === platform);
}

/** Butikkens produkt-id'er (Android: ét produkt pr. plan med to basisplaner). */
export function storeSkus(products: StoreProduct[], platform: StorePlatform): string[] {
  return [...new Set(platformProducts(products, platform).map(p => p.productId))];
}

function androidBasePlanOffer(product: ProductSubscription, basePlanId: string | undefined) {
  const offers = (product.subscriptionOffers ?? []).filter(o => o.basePlanIdAndroid === basePlanId && o.offerTokenAndroid);
  // Basisplanen selv har intet offerId; ekstra tilbud på samme basisplan har. Ingen tilbud i v1.
  return offers.find(o => !o.id || o.id === basePlanId) ?? offers[0];
}

/** Matcher serverens produkter med butikkens. Produkter butikken ikke kender, udelades. */
export function buildOffers(products: StoreProduct[], platform: StorePlatform, storeProducts: ProductSubscription[]): StoreOffer[] {
  const offers: StoreOffer[] = [];
  for (const p of platformProducts(products, platform)) {
    const storeProduct = storeProducts.find(s => s.id === p.productId);
    if (!storeProduct)
      continue;
    const base = { planTier: p.planTier, cycle: p.cycle, productId: p.productId, basePlanId: p.basePlanId };
    if (platform === 'ios') {
      offers.push({ ...base, displayPrice: storeProduct.displayPrice });
      continue;
    }
    const offer = androidBasePlanOffer(storeProduct, p.basePlanId);
    if (offer?.offerTokenAndroid)
      offers.push({ ...base, displayPrice: offer.displayPrice, offerToken: offer.offerTokenAndroid });
  }
  return offers;
}

export function findOffer(offers: StoreOffer[], planTier: StorePlanTier, cycle: StoreCycle): StoreOffer | undefined {
  return offers.find(o => o.planTier === planTier && o.cycle === cycle);
}

/** Et eksisterende Google Play-abonnement, der skal skiftes ud (op- eller nedgradering). */
export type ReplacedPurchase = { productId: string; purchaseToken: string };

/**
 * Købsforespørgsel til expo-iap. Kontoen bindes til købet: `appAccountToken` på iOS og
 * `obfuscatedAccountId` på Android er begge serverens `accountToken`.
 */
export function purchaseRequest(offer: StoreOffer, accountToken: string, replaces?: ReplacedPurchase): RequestPurchaseProps {
  return {
    type: 'subs',
    request: {
      apple: { sku: offer.productId, appAccountToken: accountToken },
      google: {
        skus: [offer.productId],
        obfuscatedAccountId: accountToken,
        subscriptionOffers: offer.offerToken ? [{ sku: offer.productId, offerToken: offer.offerToken }] : undefined,
        ...(replaces
          ? {
              purchaseToken: replaces.purchaseToken,
              subscriptionProductReplacementParams: { oldProductId: replaces.productId, replacementMode: 'with-time-proration' },
            }
          : {}),
      },
    },
  };
}

export type VerifyInput
  = | { platform: 'ios'; signedTransaction: string }
    | { platform: 'android'; productId: string; purchaseToken: string };

/** Det serveren skal bruge for at verificere købet. iOS: StoreKit 2-JWS'en ligger i `purchaseToken`. */
export function verifyInput(purchase: Purchase, platform: StorePlatform): VerifyInput | null {
  if (!purchase.purchaseToken)
    return null;
  return platform === 'ios'
    ? { platform, signedTransaction: purchase.purchaseToken }
    : { platform, productId: purchase.productId, purchaseToken: purchase.purchaseToken };
}

export function isPendingPurchase(purchase: Purchase): boolean {
  return purchase.purchaseState === 'pending';
}

const STORE_ERROR_KEYS: Record<string, TxKeyPath> = {
  'pending': 'billing.status_pending',
  'deferred-payment': 'billing.status_pending',
  'already-owned': 'billing.errors.already_owned',
  'network-error': 'billing.errors.network',
  'service-timeout': 'billing.errors.network',
  'service-disconnected': 'billing.errors.store_unavailable',
  'billing-unavailable': 'billing.errors.store_unavailable',
  'iap-not-available': 'billing.errors.store_unavailable',
  'init-connection': 'billing.errors.store_unavailable',
  'not-prepared': 'billing.errors.store_unavailable',
  'item-unavailable': 'billing.errors.unavailable',
  'sku-not-found': 'billing.errors.unavailable',
};

const SERVER_ERROR_KEYS: Record<string, TxKeyPath> = {
  CONFLICT: 'billing.errors.web_subscription',
  FORBIDDEN: 'billing.errors.account_mismatch',
  PRECONDITION_FAILED: 'billing.errors.unavailable',
  // Forbigående fejl hos serveren, Apple eller Google. Verificeringen er idempotent, og
  // transaktionen er ikke afsluttet, så købet sendes igen senere.
  INTERNAL_SERVER_ERROR: 'billing.errors.verify_later',
};

function isStoreError(error: unknown): error is PurchaseError {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string';
}

/**
 * Oversættelsesnøgle til en fejl fra butikken eller serveren. `null` = vis ingenting
 * (brugeren afbrød selv købet).
 */
export function billingErrorKey(error: unknown): TxKeyPath | null {
  if (isTRPCClientError(error)) {
    const code = error.data?.code;
    if (code && SERVER_ERROR_KEYS[code])
      return SERVER_ERROR_KEYS[code];
    // Offline, timeout eller serverfejl: transaktionen er ikke afsluttet og prøves igen.
    return 'billing.errors.verify_later';
  }
  if (isStoreError(error)) {
    if (error.code === 'user-cancelled')
      return null;
    return STORE_ERROR_KEYS[error.code] ?? 'billing.errors.purchase_failed';
  }
  return 'billing.errors.purchase_failed';
}
