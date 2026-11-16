import type { ProductSubscription } from 'expo-iap';
import type { StoreBillingConfig, StoreProduct } from './store-billing-api';
import { TRPCClientError } from '@trpc/client';
import { billingErrorKey, buildOffers, canBuyInApp, findOffer, liveStoreSource, purchaseBlockedKey, purchaseRequest, storePlatform, storeSkus, verifyInput } from './billing-logic';

jest.mock('~/lib/api', () => {
  const { TRPCClientError: Actual } = jest.requireActual('@trpc/client');
  return { isTRPCClientError: (e: unknown) => e instanceof Actual };
});

const PRODUCTS: StoreProduct[] = [
  { platform: 'ios', productId: 'dk.timetrack.app.privat.monthly', planTier: 'privat', cycle: 'monthly' },
  { platform: 'ios', productId: 'dk.timetrack.app.privat.yearly', planTier: 'privat', cycle: 'yearly' },
  { platform: 'ios', productId: 'dk.timetrack.app.solo.monthly', planTier: 'solo', cycle: 'monthly' },
  { platform: 'android', productId: 'privat', basePlanId: 'monthly', planTier: 'privat', cycle: 'monthly' },
  { platform: 'android', productId: 'privat', basePlanId: 'yearly', planTier: 'privat', cycle: 'yearly' },
  { platform: 'android', productId: 'solo', basePlanId: 'monthly', planTier: 'solo', cycle: 'monthly' },
];

function config(over: Partial<StoreBillingConfig> = {}): StoreBillingConfig {
  return {
    enabled: true,
    accountToken: '0f8fad5b-d9cb-569f-a165-70867728950e',
    products: PRODUCTS,
    current: { source: 'none', planTier: null, status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false, productId: null },
    canPurchase: true,
    purchaseBlockedReason: null,
    ...over,
  };
}

function trpcError(code: string) {
  return TRPCClientError.from({ error: { message: code, code: -32000, data: { code, httpStatus: 400, path: 'storeBilling.verifyApple' } } } as never);
}

const iosProduct = (id: string, displayPrice: string) => ({ id, displayPrice, platform: 'ios', type: 'subs' }) as unknown as ProductSubscription;

const androidPrivat = {
  id: 'privat',
  platform: 'android',
  type: 'subs',
  displayPrice: '29,00 kr.',
  subscriptionOffers: [
    { id: '', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'tok-m', displayPrice: '29,00 kr.', price: 29, type: 'promotional' },
    { id: '', basePlanIdAndroid: 'yearly', offerTokenAndroid: 'tok-y', displayPrice: '290,00 kr.', price: 290, type: 'promotional' },
  ],
} as unknown as ProductSubscription;

describe('billing-logic', () => {
  it('viser kun køb, når serveren har slået det til og kontoen ikke har web-abonnement', () => {
    expect(canBuyInApp(undefined, 'ios')).toBe(false);
    expect(canBuyInApp(config(), 'ios')).toBe(true);
    expect(canBuyInApp(config(), null)).toBe(false);
    expect(canBuyInApp(config({ enabled: false }), 'ios')).toBe(false);
    expect(canBuyInApp(config({ current: { ...config().current, source: 'web', planTier: 'team' } }), 'ios')).toBe(false);
    expect(canBuyInApp(config({ current: { ...config().current, source: 'apple', planTier: 'privat' } }), 'ios')).toBe(true);
  });

  it('sælger ikke på Android til en konto med App Store-abonnement (og omvendt)', () => {
    const apple = config({ current: { ...config().current, source: 'apple', planTier: 'privat', status: 'active' } });
    const google = config({ current: { ...config().current, source: 'google', planTier: 'solo', status: 'active' } });
    expect(canBuyInApp(apple, 'android')).toBe(false);
    expect(canBuyInApp(google, 'ios')).toBe(false);
    expect(canBuyInApp(google, 'android')).toBe(true);
  });

  it('kender kun iOS og Android som butikker', () => {
    expect(storePlatform('ios')).toBe('ios');
    expect(storePlatform('android')).toBe('android');
    expect(storePlatform('web')).toBeNull();
  });

  it('android-produkter slås sammen pr. produkt, iOS har ét pr. periode', () => {
    expect(storeSkus(PRODUCTS, 'android')).toEqual(['privat', 'solo']);
    expect(storeSkus(PRODUCTS, 'ios')).toHaveLength(3);
  });

  it('bruger butikkens pris på iOS og udelader produkter butikken ikke kender', () => {
    const offers = buildOffers(PRODUCTS, 'ios', [iosProduct('dk.timetrack.app.privat.monthly', '29,00 kr.')]);
    expect(offers).toEqual([expect.objectContaining({ planTier: 'privat', cycle: 'monthly', displayPrice: '29,00 kr.' })]);
  });

  it('finder basisplanens pris og offerToken på Android', () => {
    const offers = buildOffers(PRODUCTS, 'android', [androidPrivat]);
    expect(findOffer(offers, 'privat', 'yearly')).toEqual(expect.objectContaining({ displayPrice: '290,00 kr.', offerToken: 'tok-y', basePlanId: 'yearly' }));
    expect(findOffer(offers, 'solo', 'monthly')).toBeUndefined();
  });

  it('binder købet til kontoen på begge platforme', () => {
    const [offer] = buildOffers(PRODUCTS, 'android', [androidPrivat]);
    const req = purchaseRequest(offer, 'acct-1');
    expect(req.type).toBe('subs');
    expect(req.request.apple).toEqual({ sku: 'privat', appAccountToken: 'acct-1' });
    expect(req.request.google).toEqual(expect.objectContaining({
      skus: ['privat'],
      obfuscatedAccountId: 'acct-1',
      subscriptionOffers: [{ sku: 'privat', offerToken: 'tok-m' }],
    }));
  });

  it('skifter et eksisterende Google Play-abonnement ud ved planskift', () => {
    const [offer] = buildOffers(PRODUCTS, 'android', [androidPrivat]);
    const req = purchaseRequest(offer, 'acct-1', { productId: 'solo', purchaseToken: 'old-token' });
    expect(req.request.google).toEqual(expect.objectContaining({
      purchaseToken: 'old-token',
      subscriptionProductReplacementParams: { oldProductId: 'solo', replacementMode: 'with-time-proration' },
    }));
  });

  it('sender JWS på iOS og produkt + token på Android til verificering', () => {
    const purchase = { productId: 'privat', purchaseToken: 'jws-or-token', purchaseState: 'purchased' } as never;
    expect(verifyInput(purchase, 'ios')).toEqual({ platform: 'ios', signedTransaction: 'jws-or-token' });
    expect(verifyInput(purchase, 'android')).toEqual({ platform: 'android', productId: 'privat', purchaseToken: 'jws-or-token' });
    expect(verifyInput({ productId: 'privat', purchaseToken: null } as never, 'ios')).toBeNull();
  });

  it('oversætter serverens fejlkoder', () => {
    expect(billingErrorKey(trpcError('CONFLICT'))).toBe('billing.errors.web_subscription');
    expect(billingErrorKey(trpcError('FORBIDDEN'))).toBe('billing.errors.account_mismatch');
    expect(billingErrorKey(trpcError('PRECONDITION_FAILED'))).toBe('billing.errors.unavailable');
    expect(billingErrorKey(trpcError('INTERNAL_SERVER_ERROR'))).toBe('billing.errors.verify_later');
  });

  it('oversætter butikkens fejl og tier ved afbrudt køb', () => {
    expect(billingErrorKey({ code: 'user-cancelled', message: '' })).toBeNull();
    expect(billingErrorKey({ code: 'deferred-payment', message: '' })).toBe('billing.status_pending');
    expect(billingErrorKey({ code: 'already-owned', message: '' })).toBe('billing.errors.already_owned');
    expect(billingErrorKey({ code: 'network-error', message: '' })).toBe('billing.errors.network');
    expect(billingErrorKey({ code: 'noget-nyt', message: '' })).toBe('billing.errors.purchase_failed');
    expect(billingErrorKey(new Error('x'))).toBe('billing.errors.purchase_failed');
  });
});

describe('billing-logic: hvornår køb vises', () => {
  it('viser ingen køb, når serveren ikke tager imod køb fra kontoen', () => {
    expect(canBuyInApp(config({ canPurchase: false, purchaseBlockedReason: 'not_owner' }), 'ios')).toBe(false);
    expect(canBuyInApp(config({ canPurchase: false, purchaseBlockedReason: 'multi_member' }), 'android')).toBe(false);
    const ownApple = config({ canPurchase: false, purchaseBlockedReason: 'other_organization', current: { ...config().current, source: 'apple', planTier: 'privat' } });
    expect(canBuyInApp(ownApple, 'ios')).toBe(false);
  });

  it('forklarer hver årsag til, at køb ikke er muligt', () => {
    expect(purchaseBlockedKey(config())).toBeNull();
    expect(purchaseBlockedKey(config({ enabled: false, canPurchase: false, purchaseBlockedReason: 'disabled' }))).toBe('billing.blocked.disabled');
    expect(purchaseBlockedKey(config({ canPurchase: false, purchaseBlockedReason: 'not_owner' }))).toBe('billing.blocked.not_owner');
    expect(purchaseBlockedKey(config({ canPurchase: false, purchaseBlockedReason: 'multi_member' }))).toBe('billing.blocked.multi_member');
    expect(purchaseBlockedKey(config({ canPurchase: false, purchaseBlockedReason: 'other_organization' }))).toBe('billing.blocked.other_organization');
    expect(purchaseBlockedKey(config({ canPurchase: false, purchaseBlockedReason: 'web_subscription' }))).toBe('billing.account_managed');
    // En årsag appen ikke kender endnu, eller ingen årsag: stadig en forklaring.
    expect(purchaseBlockedKey(config({ canPurchase: false, purchaseBlockedReason: 'ny_aarsag' as never }))).toBe('billing.blocked.disabled');
    expect(purchaseBlockedKey(config({ canPurchase: false, purchaseBlockedReason: null }))).toBe('billing.blocked.disabled');
  });

  it('et butiksabonnement med status canceled spærrer stadig i den anden butik (billing retry ligner udløbet)', () => {
    const expired = config({ current: { ...config().current, source: 'apple', planTier: 'privat', status: 'canceled' } });
    expect(liveStoreSource(expired.current)).toBeNull();
    expect(canBuyInApp(expired, 'android')).toBe(false);
    expect(canBuyInApp(expired, 'ios')).toBe(true);
    expect(liveStoreSource({ ...expired.current, status: 'active' })).toBe('apple');
    expect(liveStoreSource({ ...expired.current, source: 'google', status: 'trialing' })).toBe('google');
  });
});
