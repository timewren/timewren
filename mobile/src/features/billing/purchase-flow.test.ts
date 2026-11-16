import type { Purchase } from 'expo-iap';
import { TRPCClientError } from '@trpc/client';
import { finishTransaction, getAvailablePurchases, restorePurchases } from 'expo-iap';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { onPurchaseError, onPurchaseUpdated, useBillingStore } from './purchase-events';
import { recoverUnfinished, replaceablePurchase, restore, verifyAndFinish } from './purchase-flow';

const mockVerifyApple = jest.fn();
const mockVerifyGoogle = jest.fn();
const mockInvalidate = jest.fn(async () => {});

jest.mock('expo-iap', () => ({
  initConnection: jest.fn(async () => true),
  endConnection: jest.fn(async () => true),
  finishTransaction: jest.fn(async () => {}),
  getAvailablePurchases: jest.fn(async () => []),
  restorePurchases: jest.fn(async () => {}),
}));
jest.mock('~/lib/api', () => {
  const { TRPCClientError: Actual } = jest.requireActual('@trpc/client');
  return {
    isTRPCClientError: (e: unknown) => e instanceof Actual,
    trpcClient: {
      storeBilling: {
        verifyApple: { mutate: (i: unknown) => mockVerifyApple(i) },
        verifyGoogle: { mutate: (i: unknown) => mockVerifyGoogle(i) },
      },
    },
  };
});
jest.mock('~/lib/api/provider', () => ({ queryClient: { invalidateQueries: () => mockInvalidate() } }));
jest.mock('~/lib/monitoring', () => ({ captureError: jest.fn() }));
jest.mock('~/lib/notify', () => ({ showMessage: jest.fn() }));

const CURRENT = { source: 'apple', planTier: 'privat', status: 'active', currentPeriodEnd: '2026-11-23T00:00:00.000Z', cancelAtPeriodEnd: false, productId: 'dk.timetrack.app.privat.monthly' };

function purchase(over: Partial<Record<string, unknown>> = {}): Purchase {
  return {
    id: 't1',
    productId: 'dk.timetrack.app.privat.monthly',
    purchaseToken: 'signed-jws',
    purchaseState: 'purchased',
    isAutoRenewing: true,
    quantity: 1,
    store: 'apple',
    storeId: 't1',
    transactionDate: 0,
    ...over,
  } as unknown as Purchase;
}

function trpcError(code: string) {
  return TRPCClientError.from({ error: { message: code, code: -32000, data: { code, httpStatus: 409, path: 'storeBilling.verifyApple' } } } as never);
}

const GOOGLE_SOLO = { ...CURRENT, source: 'google', planTier: 'solo', productId: 'solo' };

const SKUS = ['dk.timetrack.app.privat.monthly', 'privat', 'solo'];

beforeEach(() => {
  jest.clearAllMocks();
  useBillingStore.setState({ purchasing: false, pending: false });
});

describe('verifyAndFinish', () => {
  it('verificerer hos serveren og afslutter først derefter transaktionen', async () => {
    const order: string[] = [];
    mockVerifyApple.mockImplementation(async () => {
      order.push('verify');
      return CURRENT;
    });
    jest.mocked(finishTransaction).mockImplementation(async () => {
      order.push('finish');
    });
    const p = purchase();
    await expect(verifyAndFinish(p, 'ios')).resolves.toEqual({ status: 'verified', current: CURRENT });
    expect(mockVerifyApple).toHaveBeenCalledWith({ signedTransaction: 'signed-jws' });
    expect(finishTransaction).toHaveBeenCalledWith({ purchase: p, isConsumable: false });
    expect(order).toEqual(['verify', 'finish']);
  });

  it('sender produkt og token til Google på Android', async () => {
    mockVerifyGoogle.mockResolvedValue(GOOGLE_SOLO);
    await verifyAndFinish(purchase({ productId: 'solo', purchaseToken: 'gp-token' }), 'android');
    expect(mockVerifyGoogle).toHaveBeenCalledWith({ productId: 'solo', purchaseToken: 'gp-token' });
  });

  it('afslutter IKKE transaktionen, når verificeringen fejler', async () => {
    const error = trpcError('FORBIDDEN');
    mockVerifyApple.mockRejectedValue(error);
    await expect(verifyAndFinish(purchase(), 'ios')).resolves.toEqual({ status: 'error', error });
    expect(finishTransaction).not.toHaveBeenCalled();
  });

  it('rører ikke et ventende køb (Ask to Buy / ventende betaling)', async () => {
    await expect(verifyAndFinish(purchase({ purchaseState: 'pending' }), 'ios')).resolves.toEqual({ status: 'pending' });
    expect(mockVerifyApple).not.toHaveBeenCalled();
    expect(finishTransaction).not.toHaveBeenCalled();
  });

  it('verificerer det samme køb én gang, selv om det kommer to gange samtidig', async () => {
    mockVerifyApple.mockResolvedValue(CURRENT);
    const [a, b] = await Promise.all([verifyAndFinish(purchase(), 'ios'), verifyAndFinish(purchase(), 'ios')]);
    expect([a.status, b.status].sort()).toEqual(['skipped', 'verified']);
    expect(mockVerifyApple).toHaveBeenCalledTimes(1);
  });
});

describe('onPurchaseUpdated', () => {
  it('opdaterer planen og viser tak efter et verificeret køb', async () => {
    mockVerifyApple.mockResolvedValue(CURRENT);
    useBillingStore.setState({ purchasing: true });
    await onPurchaseUpdated(purchase(), 'ios', SKUS);
    expect(mockInvalidate).toHaveBeenCalled();
    expect(useBillingStore.getState().purchasing).toBe(false);
    expect(showMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('viser en pæn besked, når kontoen allerede har et web-abonnement (CONFLICT)', async () => {
    mockVerifyApple.mockRejectedValue(trpcError('CONFLICT'));
    useBillingStore.setState({ purchasing: true });
    await onPurchaseUpdated(purchase(), 'ios', SKUS);
    expect(finishTransaction).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith({ message: translate('billing.errors.web_subscription'), type: 'danger' });
  });

  it('markerer et ventende køb uden at verificere det', async () => {
    useBillingStore.setState({ purchasing: true });
    await onPurchaseUpdated(purchase({ purchaseState: 'pending' }), 'ios', SKUS);
    expect(useBillingStore.getState().pending).toBe(true);
    expect(mockVerifyApple).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
  });

  it('opdaterer stille ved en fornyelse, brugeren ikke venter på', async () => {
    mockVerifyApple.mockResolvedValue(CURRENT);
    await onPurchaseUpdated(purchase(), 'ios', SKUS);
    expect(mockInvalidate).toHaveBeenCalled();
    expect(finishTransaction).toHaveBeenCalled();
    expect(showMessage).not.toHaveBeenCalled();
  });

  it('viser en købsfejl én gang, selv om både lytter og requestPurchase melder den', () => {
    useBillingStore.setState({ purchasing: true });
    onPurchaseError({ code: 'network-error', message: '' });
    onPurchaseError({ code: 'network-error', message: '' });
    expect(showMessage).toHaveBeenCalledTimes(1);
    expect(useBillingStore.getState().purchasing).toBe(false);
  });

  it('viser intet, når brugeren selv afbryder købet', () => {
    useBillingStore.setState({ purchasing: true });
    onPurchaseError({ code: 'user-cancelled', message: '' });
    expect(showMessage).not.toHaveBeenCalled();
    expect(useBillingStore.getState().purchasing).toBe(false);
  });

  it('ignorerer produkter, der ikke er appens abonnementer', async () => {
    await onPurchaseUpdated(purchase({ productId: 'noget.andet' }), 'ios', SKUS);
    expect(mockVerifyApple).not.toHaveBeenCalled();
  });
});

describe('restore', () => {
  it('synkroniserer med butikken og verificerer appens køb', async () => {
    mockVerifyApple.mockResolvedValue(CURRENT);
    jest.mocked(getAvailablePurchases).mockResolvedValue([purchase(), purchase({ id: 'x', productId: 'noget.andet', purchaseToken: 'x' })]);
    const result = await restore(SKUS, 'ios');
    expect(restorePurchases).toHaveBeenCalled();
    expect(result).toEqual({ found: 1, verified: 1, pending: 0, current: CURRENT });
    expect(finishTransaction).toHaveBeenCalledTimes(1);
  });

  it('melder serverens fejl tilbage og afslutter intet', async () => {
    const error = trpcError('FORBIDDEN');
    mockVerifyApple.mockRejectedValue(error);
    jest.mocked(getAvailablePurchases).mockResolvedValue([purchase()]);
    await expect(restore(SKUS, 'ios')).resolves.toEqual({ found: 1, verified: 0, pending: 0, error });
    expect(finishTransaction).not.toHaveBeenCalled();
  });
});

describe('opstart og planskift på Android', () => {
  it('verificerer kun køb, der ikke er kvitteret', async () => {
    mockVerifyGoogle.mockResolvedValue(GOOGLE_SOLO);
    jest.mocked(getAvailablePurchases).mockResolvedValue([
      purchase({ id: 'a', productId: 'privat', purchaseToken: 'a', isAcknowledgedAndroid: true }),
      purchase({ id: 'b', productId: 'solo', purchaseToken: 'b', isAcknowledgedAndroid: false }),
    ]);
    const result = await recoverUnfinished(SKUS, 'android');
    expect(result?.verified).toBe(1);
    expect(mockVerifyGoogle).toHaveBeenCalledWith({ productId: 'solo', purchaseToken: 'b' });
  });

  it('gør intet på iOS (StoreKit sender selv uafsluttede køb)', async () => {
    await expect(recoverUnfinished(SKUS, 'ios')).resolves.toBeNull();
    expect(getAvailablePurchases).not.toHaveBeenCalled();
  });

  it('finder det abonnement, der skal skiftes ud', async () => {
    jest.mocked(getAvailablePurchases).mockResolvedValue([purchase({ productId: 'privat', purchaseToken: 'old', currentPlanId: 'monthly' })]);
    const offer = { planTier: 'solo', cycle: 'monthly', productId: 'solo', basePlanId: 'monthly', displayPrice: '79,00 kr.' } as const;
    await expect(replaceablePurchase(SKUS, 'android', offer)).resolves.toEqual({ productId: 'privat', purchaseToken: 'old' });
    const same = { ...offer, planTier: 'privat', productId: 'privat' } as const;
    await expect(replaceablePurchase(SKUS, 'android', same)).resolves.toBeUndefined();
    const yearly = { ...same, cycle: 'yearly', basePlanId: 'yearly' } as const;
    await expect(replaceablePurchase(SKUS, 'android', yearly)).resolves.toEqual({ productId: 'privat', purchaseToken: 'old' });
  });
});

describe('afventende Google Play-køb', () => {
  const pendingSolo = purchase({ id: 'p', productId: 'solo', purchaseToken: 'pending-token', purchaseState: 'pending', isAcknowledgedAndroid: false });
  const approvedSolo = purchase({ id: 'p', productId: 'solo', purchaseToken: 'pending-token', purchaseState: 'purchased', isAcknowledgedAndroid: false });

  it('sendes til serveren, så snart købet er gennemført, og afsluttes først da', async () => {
    jest.mocked(getAvailablePurchases).mockResolvedValueOnce([pendingSolo]);
    await expect(recoverUnfinished(SKUS, 'android')).resolves.toEqual({ found: 1, verified: 0, pending: 1 });
    expect(mockVerifyGoogle).not.toHaveBeenCalled();
    expect(finishTransaction).not.toHaveBeenCalled();

    // Næste opstart eller når appen kommer frem: Google har godkendt betalingen.
    mockVerifyGoogle.mockResolvedValue(GOOGLE_SOLO);
    jest.mocked(getAvailablePurchases).mockResolvedValueOnce([approvedSolo]);
    await expect(recoverUnfinished(SKUS, 'android')).resolves.toEqual({ found: 1, verified: 1, pending: 0, current: GOOGLE_SOLO });
    expect(mockVerifyGoogle).toHaveBeenCalledWith({ productId: 'solo', purchaseToken: 'pending-token' });
    // Serveren kvitterer selv Google-købet, når den har skrevet det.
    expect(finishTransaction).not.toHaveBeenCalled();
  });

  it('meldes stadig afventende, når serveren ikke har skrevet købet', async () => {
    const none = { source: 'none', planTier: null, status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false, productId: null };
    mockVerifyGoogle.mockResolvedValue(none);
    await expect(verifyAndFinish(approvedSolo, 'android')).resolves.toEqual({ status: 'pending' });
    // Planskift på samme produkt (Privat måned til år), mens Google stadig melder det nye køb
    // afventende: serveren svarer med den gamle plan, og købet må ikke kvitteres af appen.
    mockVerifyGoogle.mockResolvedValue({ ...GOOGLE_SOLO, planTier: 'privat', productId: 'privat' });
    await verifyAndFinish(purchase({ id: 'y', productId: 'privat', purchaseToken: 'new', isAcknowledgedAndroid: false }), 'android');
    expect(finishTransaction).not.toHaveBeenCalled();
  });

  it('melder et allerede kvitteret køb som gendannet, ikke afventende', async () => {
    mockVerifyGoogle.mockResolvedValue({ ...GOOGLE_SOLO, planTier: 'privat', productId: 'privat' });
    const acknowledged = purchase({ id: 'a', productId: 'solo', purchaseToken: 'a', isAcknowledgedAndroid: true });
    await expect(verifyAndFinish(acknowledged, 'android')).resolves.toEqual(expect.objectContaining({ status: 'verified' }));
    expect(finishTransaction).not.toHaveBeenCalled();
  });
});

describe('forbigående serverfejl (INTERNAL_SERVER_ERROR)', () => {
  it('afslutter ikke købet og beder brugeren vente', async () => {
    mockVerifyApple.mockRejectedValue(trpcError('INTERNAL_SERVER_ERROR'));
    useBillingStore.setState({ purchasing: true });
    await onPurchaseUpdated(purchase(), 'ios', SKUS);
    expect(finishTransaction).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith({ message: translate('billing.errors.verify_later'), type: 'danger' });
  });

  it('sender købet igen næste gang, og afslutter det, når serveren svarer', async () => {
    const solo = purchase({ id: 's', productId: 'solo', purchaseToken: 'gp', isAcknowledgedAndroid: false });
    jest.mocked(getAvailablePurchases).mockResolvedValue([solo]);
    const error = trpcError('INTERNAL_SERVER_ERROR');
    mockVerifyGoogle.mockRejectedValueOnce(error).mockResolvedValueOnce(GOOGLE_SOLO);
    await expect(recoverUnfinished(SKUS, 'android')).resolves.toEqual({ found: 1, verified: 0, pending: 0, error });
    await expect(recoverUnfinished(SKUS, 'android')).resolves.toEqual({ found: 1, verified: 1, pending: 0, current: GOOGLE_SOLO });
    expect(mockVerifyGoogle).toHaveBeenCalledTimes(2);
  });

  it('afslutter heller ikke et iOS-køb, og StoreKit sender det igen', async () => {
    mockVerifyApple.mockRejectedValueOnce(trpcError('INTERNAL_SERVER_ERROR')).mockResolvedValueOnce(CURRENT);
    await expect(verifyAndFinish(purchase(), 'ios')).resolves.toEqual(expect.objectContaining({ status: 'error' }));
    expect(finishTransaction).not.toHaveBeenCalled();
    await expect(verifyAndFinish(purchase(), 'ios')).resolves.toEqual({ status: 'verified', current: CURRENT });
    expect(finishTransaction).toHaveBeenCalledTimes(1);
  });
});
