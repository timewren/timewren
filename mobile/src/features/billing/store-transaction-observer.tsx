import { purchaseErrorListener, purchaseUpdatedListener } from 'expo-iap';
import * as React from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { captureError } from '~/lib/monitoring';
import { storePlatform, storeSkus } from './billing-logic';
import { clearPending, onPurchaseError, onPurchaseUpdated, setPurchasing } from './purchase-events';
import { closeConnection, ensureConnection, recoverUnfinished } from './purchase-flow';
import { invalidateAfterPurchase, useStoreBillingConfig } from './store-billing-api';

/**
 * Lytter efter butikkens transaktioner, så længe en konto er logget ind og køb er slået til.
 * Fanger både nye køb og køb, der blev afbrudt (appen lukket før verificering), og
 * verificerer dem, før de afsluttes. Viser intet selv.
 */
export function StoreTransactionObserver() {
  const signedIn = useAuthStore.use.status() === 'signIn';
  const config = useStoreBillingConfig(signedIn);
  const platform = storePlatform();
  const enabled = signedIn && !!config.data?.enabled && platform !== null;
  const skusKey = enabled && platform ? storeSkus(config.data?.products ?? [], platform).join(',') : '';

  React.useEffect(() => {
    if (!enabled || !platform || !skusKey)
      return;
    const skus = skusKey.split(',');
    const updated = purchaseUpdatedListener((purchase) => {
      void onPurchaseUpdated(purchase, platform, skus);
    });
    const failed = purchaseErrorListener(onPurchaseError);
    const recover = () => {
      void ensureConnection()
        .then(() => recoverUnfinished(skus, platform))
        .then((recovered) => {
          if (!recovered?.verified)
            return;
          // Et ventende køb er blevet godkendt: teksten om ventende køb skal væk.
          if (!recovered.pending)
            clearPending();
          void invalidateAfterPurchase();
        })
        .catch((error: unknown) => captureError(error));
    };
    recover();
    // Et ventende køb kan blive godkendt, mens appen ligger i baggrunden.
    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'active')
        recover();
    });
    return () => {
      updated.remove();
      failed.remove();
      appState.remove();
      // Uden lytter kommer svaret på et igangværende køb aldrig hertil.
      setPurchasing(false);
    };
  }, [enabled, platform, skusKey]);

  // Log ud: forbindelsen lukkes, så en ny konto starter forfra.
  React.useEffect(() => {
    if (signedIn)
      return;
    void closeConnection();
  }, [signedIn]);

  return null;
}
