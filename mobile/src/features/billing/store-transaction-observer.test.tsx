import { act, render } from '@testing-library/react-native';
import * as React from 'react';
import { useBillingStore } from './purchase-events';
import { recoverUnfinished } from './purchase-flow';
import { StoreTransactionObserver } from './store-transaction-observer';

const mockInvalidate = jest.fn(async () => {});
let mockAppStateListener: ((status: string) => void) | undefined;

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.Platform.OS = 'android';
  RN.AppState.addEventListener = (_: string, listener: (status: string) => void) => {
    mockAppStateListener = listener;
    return { remove: jest.fn() };
  };
  return RN;
});
jest.mock('expo-iap', () => ({
  purchaseUpdatedListener: () => ({ remove: jest.fn() }),
  purchaseErrorListener: () => ({ remove: jest.fn() }),
}));
jest.mock('~/features/auth/use-auth-store', () => ({ useAuthStore: { use: { status: () => 'signIn' } } }));
jest.mock('~/lib/monitoring', () => ({ captureError: jest.fn() }));
jest.mock('~/lib/api', () => ({ isTRPCClientError: () => false }));
jest.mock('~/lib/notify', () => ({ showMessage: jest.fn() }));
jest.mock('./purchase-flow', () => ({
  ensureConnection: jest.fn(async () => true),
  closeConnection: jest.fn(async () => {}),
  recoverUnfinished: jest.fn(async () => null),
  verifyAndFinish: jest.fn(),
}));
jest.mock('./store-billing-api', () => ({
  invalidateAfterPurchase: () => mockInvalidate(),
  useStoreBillingConfig: () => ({
    data: {
      enabled: true,
      canPurchase: true,
      products: [
        { platform: 'android', productId: 'privat', basePlanId: 'monthly', planTier: 'privat', cycle: 'monthly' },
        { platform: 'android', productId: 'solo', basePlanId: 'monthly', planTier: 'solo', cycle: 'monthly' },
      ],
    },
  }),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('lytteren efter butikkens køb', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBillingStore.setState({ purchasing: false, pending: false });
  });

  it('sender ukvitterede køb til serveren ved opstart og når appen kommer frem', async () => {
    render(<StoreTransactionObserver />);
    await flush();
    expect(recoverUnfinished).toHaveBeenCalledTimes(1);
    expect(recoverUnfinished).toHaveBeenCalledWith(['privat', 'solo'], 'android');

    mockAppStateListener?.('background');
    await flush();
    expect(recoverUnfinished).toHaveBeenCalledTimes(1);

    mockAppStateListener?.('active');
    await flush();
    expect(recoverUnfinished).toHaveBeenCalledTimes(2);
  });

  it('fjerner teksten om ventende køb og henter planen, når købet er godkendt', async () => {
    useBillingStore.setState({ pending: true });
    jest.mocked(recoverUnfinished).mockResolvedValueOnce({ found: 1, verified: 1, pending: 0 });
    render(<StoreTransactionObserver />);
    await flush();
    expect(useBillingStore.getState().pending).toBe(false);
    expect(mockInvalidate).toHaveBeenCalled();
  });
});
