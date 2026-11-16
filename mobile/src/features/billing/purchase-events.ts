import type { Purchase } from 'expo-iap';
import type { StorePlatform } from './store-billing-api';
import { create } from 'zustand';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { createSelectors } from '~/lib/utils';
import { billingErrorKey } from './billing-logic';
import { verifyAndFinish } from './purchase-flow';
import { invalidateAfterPurchase } from './store-billing-api';

type BillingState = {
  /** Et køb er sendt til butikken, og svaret er ikke kommet endnu. */
  purchasing: boolean;
  /** Butikken venter på godkendelse (Ask to Buy) eller betaling. */
  pending: boolean;
};

const _useBillingStore = create<BillingState>(() => ({ purchasing: false, pending: false }));
export const useBillingStore = createSelectors(_useBillingStore);

export function setPurchasing(purchasing: boolean) {
  _useBillingStore.setState({ purchasing });
}

/** Intet køb venter længere på godkendelse eller betaling. */
export function clearPending() {
  _useBillingStore.setState({ pending: false });
}

/** Afslut et igangværende køb. Sand, hvis brugeren ventede på det (så svaret skal vises). */
export function endPurchase(): boolean {
  const was = _useBillingStore.getState().purchasing;
  _useBillingStore.setState({ purchasing: false });
  return was;
}

/** Vis en fejl fra butikken eller serveren. Afbrudte køb vises ikke. */
export function showBillingError(error: unknown) {
  const key = billingErrorKey(error);
  if (!key)
    return;
  if (key === 'billing.status_pending') {
    _useBillingStore.setState({ pending: true });
    showMessage({ message: translate(key), type: 'info' });
    return;
  }
  showMessage({ message: translate(key), type: 'danger' });
}

/**
 * Et køb fra butikkens lytter: nyt, ventende, afbrudt ved sidste opstart eller en fornyelse.
 * Verificeres hos serveren, afsluttes og opdaterer planen. Beskeder vises kun, når brugeren
 * venter på svaret (købte lige nu eller havde et ventende køb), ikke ved stille fornyelser.
 */
export async function onPurchaseUpdated(purchase: Purchase, platform: StorePlatform, skus: string[]) {
  if (!skus.includes(purchase.productId))
    return;
  const { purchasing, pending } = _useBillingStore.getState();
  const awaited = purchasing || pending;
  const result = await verifyAndFinish(purchase, platform);
  setPurchasing(false);
  // Samme køb behandles allerede et andet sted, som også melder udfaldet.
  if (result.status === 'skipped')
    return;
  if (result.status === 'pending') {
    _useBillingStore.setState({ pending: true });
    if (purchasing)
      showMessage({ message: translate('billing.status_pending'), type: 'info' });
    return;
  }
  if (result.status === 'error') {
    if (awaited)
      showBillingError(result.error);
    return;
  }
  _useBillingStore.setState({ pending: false });
  await invalidateAfterPurchase();
  if (awaited)
    showMessage({ message: translate('billing.purchase_done'), type: 'success' });
}

/** Fejl fra et køb, brugeren lige har startet. Både lytteren og `requestPurchase` kan melde den. */
export function onPurchaseError(error: unknown) {
  if (endPurchase())
    showBillingError(error);
}
