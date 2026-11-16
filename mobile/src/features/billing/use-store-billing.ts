import type { ProductSubscription } from 'expo-iap';
import type { StoreOffer } from './billing-logic';
import type { StoreBillingConfig, StorePlatform } from './store-billing-api';
import { useQuery } from '@tanstack/react-query';
import Env from 'env';
import * as Application from 'expo-application';
import { deepLinkToSubscriptions, fetchProducts, requestPurchase } from 'expo-iap';
import * as React from 'react';
import { Linking } from 'react-native';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { buildOffers, canBuyInApp, purchaseRequest, storePlatform, storeSkus } from './billing-logic';
import { onPurchaseError, setPurchasing, showBillingError, useBillingStore } from './purchase-events';
import { ensureConnection, replaceablePurchase, restore } from './purchase-flow';
import { invalidateAfterPurchase, useStoreBillingConfig } from './store-billing-api';

const STORE_SUBSCRIPTIONS_URL: Record<StorePlatform, string> = {
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions',
};

async function loadOffers(config: StoreBillingConfig, platform: StorePlatform, skus: string[]): Promise<StoreOffer[]> {
  await ensureConnection();
  const items = await fetchProducts({ skus, type: 'subs' });
  return buildOffers(config.products, platform, (items ?? []) as ProductSubscription[]);
}

/** Start et køb. Svaret kommer via butikkens lytter (StoreTransactionObserver), ikke herfra. */
export async function startPurchase(config: StoreBillingConfig, platform: StorePlatform, offer: StoreOffer) {
  setPurchasing(true);
  try {
    const skus = storeSkus(config.products, platform);
    const replaces = await replaceablePurchase(skus, platform, offer);
    await requestPurchase(purchaseRequest(offer, config.accountToken, replaces));
  }
  catch (error) {
    onPurchaseError(error);
  }
}

/** "Gendan køb" med besked om udfaldet. */
export async function restoreWithFeedback(config: StoreBillingConfig, platform: StorePlatform) {
  try {
    const result = await restore(storeSkus(config.products, platform), platform);
    if (result.verified > 0) {
      await invalidateAfterPurchase();
      showMessage({ message: translate('billing.restore_done'), type: 'success' });
    }
    else if (result.error !== undefined) {
      showBillingError(result.error);
    }
    else if (result.pending > 0) {
      showMessage({ message: translate('billing.status_pending'), type: 'info' });
    }
    else {
      showMessage({ message: translate('billing.restore_none'), type: 'info' });
    }
  }
  catch (error) {
    showBillingError(error);
  }
}

/** Åbn butikkens egen abonnementsside (opsig, skift betalingsmetode). */
export async function openManageSubscriptions(platform: StorePlatform, productId: string | null) {
  try {
    await deepLinkToSubscriptions({
      skuAndroid: productId ?? undefined,
      packageNameAndroid: Application.applicationId ?? Env.EXPO_PUBLIC_PACKAGE,
    });
  }
  catch {
    await Linking.openURL(STORE_SUBSCRIPTIONS_URL[platform]).catch(() => {});
  }
}

const SOURCE_PLATFORM = { apple: 'ios', google: 'android' } as const;

/**
 * Abonnementssiden i den butik, abonnementet er købt i. Kører appen på den anden platform,
 * åbnes butikkens abonnementsside på nettet.
 */
export async function openSubscriptionStore(source: 'apple' | 'google', productId: string | null) {
  const platform = SOURCE_PLATFORM[source];
  if (storePlatform() === platform)
    return openManageSubscriptions(platform, productId);
  await Linking.openURL(STORE_SUBSCRIPTIONS_URL[platform]).catch(() => {});
}

/** Alt, abonnementsskærmen skal bruge til køb i appen. */
export function useStoreBilling() {
  const signedIn = useAuthStore.use.status() === 'signIn';
  const platform = storePlatform();
  const config = useStoreBillingConfig(signedIn);
  const data = config.data;
  const buyable = canBuyInApp(data, platform);
  const skus = buyable && data && platform ? storeSkus(data.products, platform) : [];
  const offers = useQuery({
    queryKey: [['storeBilling', 'offers'], { platform, skus }],
    queryFn: () => loadOffers(data!, platform!, skus),
    enabled: buyable && skus.length > 0,
    staleTime: 30 * 60 * 1000,
  });
  const purchasing = useBillingStore.use.purchasing();
  const pending = useBillingStore.use.pending();
  const [restoring, setRestoring] = React.useState(false);

  const buy = React.useCallback((offer: StoreOffer) => {
    if (data && platform)
      void startPurchase(data, platform, offer);
  }, [data, platform]);

  const restoreAction = React.useCallback(async () => {
    if (!data || !platform)
      return;
    setRestoring(true);
    await restoreWithFeedback(data, platform);
    setRestoring(false);
  }, [data, platform]);

  const manage = React.useCallback(() => {
    if (platform)
      void openManageSubscriptions(platform, data?.current.productId ?? null);
  }, [data, platform]);

  return { config, platform, buyable, offers, purchasing, pending, restoring, buy, restore: restoreAction, manage };
}
