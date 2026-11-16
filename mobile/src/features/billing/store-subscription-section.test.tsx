import type { StoreOffer } from './billing-logic';
import type { StoreBillingConfig } from './store-billing-api';
import * as React from 'react';
import { translate } from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';
import { StoreSubscriptionSection } from './store-subscription-section';

const mockBilling: { current: Record<string, unknown> } = { current: {} };

jest.mock('./use-store-billing', () => ({ useStoreBilling: () => mockBilling.current }));
jest.mock('~/lib/api', () => ({ isTRPCClientError: () => false }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

const NONE = { source: 'none', planTier: null, status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false, productId: null } as const;

function config(over: Partial<StoreBillingConfig> = {}): StoreBillingConfig {
  return {
    enabled: true,
    accountToken: '0f8fad5b-d9cb-569f-a165-70867728950e',
    products: [],
    current: NONE,
    canPurchase: true,
    purchaseBlockedReason: null,
    ...over,
  };
}

const OFFERS: StoreOffer[] = [
  { planTier: 'privat', cycle: 'monthly', productId: 'dk.timetrack.app.privat.monthly', displayPrice: '29,00 kr.' },
  { planTier: 'solo', cycle: 'monthly', productId: 'dk.timetrack.app.solo.monthly', displayPrice: '79,00 kr.' },
];

function given(data: StoreBillingConfig) {
  const buyable = data.enabled && data.canPurchase && data.current.source !== 'web';
  mockBilling.current = {
    config: { data },
    platform: 'ios',
    buyable,
    offers: { data: OFFERS, isLoading: false, isError: false, refetch: jest.fn() },
    purchasing: false,
    pending: false,
    restoring: false,
    buy: jest.fn(),
    restore: jest.fn(),
    manage: jest.fn(),
  };
}

const buyButtons = () => screen.queryAllByTestId(/^billing-buy-[a-z]+-(monthly|yearly)$/);

describe('abonnementssektionen', () => {
  afterEach(cleanup);

  it('viser købsknapper, når serveren tager imod køb', () => {
    given(config());
    render(<StoreSubscriptionSection />);
    expect(buyButtons()).toHaveLength(2);
    expect(screen.queryByTestId('billing-blocked')).toBeNull();
  });

  it.each([
    ['not_owner', 'billing.blocked.not_owner'],
    ['multi_member', 'billing.blocked.multi_member'],
    ['other_organization', 'billing.blocked.other_organization'],
    ['web_subscription', 'billing.account_managed'],
  ] as const)('viser ingen købsknapper ved %s, kun en forklaring', (reason, key) => {
    given(config({ canPurchase: false, purchaseBlockedReason: reason }));
    render(<StoreSubscriptionSection />);
    expect(buyButtons()).toHaveLength(0);
    expect(screen.queryByTestId('billing-restore')).toBeNull();
    expect(screen.getByText(translate(key))).toBeOnTheScreen();
  });

  // App Review 2.1: en flade der kun siger "kan ikke købes lige nu" ligner ufærdig funktionalitet.
  it('viser intet, når køb i appen er slået fra på serveren', () => {
    given(config({ enabled: false, canPurchase: false, purchaseBlockedReason: 'disabled' }));
    render(<StoreSubscriptionSection />);
    expect(buyButtons()).toHaveLength(0);
    expect(screen.queryByTestId('billing-section')).toBeNull();
    expect(screen.queryByText(translate('billing.blocked.disabled'))).toBeNull();
  });

  it('lader et App Store-abonnement blive administreret, selv når køb er slået fra på serveren', () => {
    given(config({
      enabled: false,
      canPurchase: false,
      purchaseBlockedReason: 'disabled',
      current: { ...NONE, source: 'apple', planTier: 'privat', status: 'active', productId: 'dk.timetrack.app.privat.monthly' },
    }));
    render(<StoreSubscriptionSection />);
    expect(screen.getByTestId('billing-current')).toBeOnTheScreen();
    expect(screen.getByTestId('billing-manage')).toBeOnTheScreen();
  });

  it('lader et eksisterende App Store-abonnement blive administreret, selv når køb er blokeret', () => {
    given(config({
      canPurchase: false,
      purchaseBlockedReason: 'multi_member',
      current: { ...NONE, source: 'apple', planTier: 'privat', status: 'active', productId: 'dk.timetrack.app.privat.monthly' },
    }));
    render(<StoreSubscriptionSection />);
    expect(buyButtons()).toHaveLength(0);
    expect(screen.getByTestId('billing-current')).toBeOnTheScreen();
    expect(screen.getByTestId('billing-manage')).toBeOnTheScreen();
  });

  it('viser et udløbet App Store-køb som intet abonnement, så det kan købes igen', () => {
    given(config({ current: { ...NONE, source: 'apple', planTier: 'privat', status: 'canceled', currentPeriodEnd: '2026-09-01T00:00:00.000Z', productId: 'dk.timetrack.app.privat.monthly' } }));
    render(<StoreSubscriptionSection />);
    expect(screen.queryByTestId('billing-current')).toBeNull();
    expect(screen.getByTestId('billing-buy-privat-monthly')).toBeOnTheScreen();
    expect(screen.queryByText(translate('billing.current_plan'))).toBeNull();
  });

  it('skjuler købsknappen for det produkt, der løber nu', () => {
    given(config({ current: { ...NONE, source: 'apple', planTier: 'privat', status: 'active', currentPeriodEnd: '2026-11-23T00:00:00.000Z', productId: 'dk.timetrack.app.privat.monthly' } }));
    render(<StoreSubscriptionSection />);
    expect(screen.getByTestId('billing-current')).toBeOnTheScreen();
    expect(screen.queryByTestId('billing-buy-privat-monthly')).toBeNull();
    expect(screen.getByTestId('billing-buy-solo-monthly')).toBeOnTheScreen();
  });

  it('viser ingen halv købsflade, når butikken ikke kender produkterne', () => {
    given(config());
    mockBilling.current.offers = { data: [], isLoading: false, isError: false, isSuccess: true, refetch: jest.fn() };
    render(<StoreSubscriptionSection />);
    expect(screen.queryByTestId('billing-section')).toBeNull();
    expect(screen.queryByTestId('billing-restore')).toBeNull();
  });

  it('viser stadig en fejl med prøv igen, når hentningen fra butikken fejler', () => {
    given(config());
    mockBilling.current.offers = { data: undefined, isLoading: false, isError: true, isSuccess: false, refetch: jest.fn() };
    render(<StoreSubscriptionSection />);
    expect(screen.getByText(translate('billing.products_unavailable'))).toBeOnTheScreen();
  });
});
