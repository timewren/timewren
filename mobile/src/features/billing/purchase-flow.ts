import type { Purchase } from 'expo-iap';
import type { ReplacedPurchase, StoreOffer } from './billing-logic';
import type { StorePlatform, StoreSubscription } from './store-billing-api';
import { endConnection, finishTransaction, getAvailablePurchases, initConnection, restorePurchases } from 'expo-iap';
import { captureError } from '~/lib/monitoring';
import { isPendingPurchase, liveStoreSource, verifyInput } from './billing-logic';
import { storeBillingApi } from './store-billing-api';

/**
 * Købsflowet mod butikken og serveren. Reglen er fast: en transaktion afsluttes
 * (`finishTransaction`) FØRST, når serveren har verificeret den. På Android kvitterer
 * serveren selv Google-købet, så dér afslutter appen intet. Fejler verificeringen,
 * bliver transaktionen liggende hos butikken og prøves igen ved næste opstart.
 */

let connection: Promise<boolean> | null = null;

/** Én forbindelse til butikken for hele appen. En fejlet forbindelse prøves igen næste gang. */
export function ensureConnection(): Promise<boolean> {
  if (!connection) {
    connection = initConnection().then(
      (connected) => {
        // Uden forbindelse prøves der igen ved næste kald, ikke først ved genstart.
        if (!connected)
          connection = null;
        return connected;
      },
      (error: unknown) => {
        connection = null;
        throw error;
      },
    );
  }
  return connection;
}

/** Ved log ud: luk forbindelsen, så næste konto starter forfra. */
export async function closeConnection(): Promise<void> {
  if (!connection)
    return;
  connection = null;
  await endConnection().catch(() => {});
}

export type HandleResult
  = | { status: 'verified'; current: StoreSubscription }
    | { status: 'pending' }
    | { status: 'skipped' }
    | { status: 'error'; error: unknown };

const inFlight = new Set<string>();

function verify(purchase: Purchase, platform: StorePlatform): Promise<StoreSubscription> {
  const input = verifyInput(purchase, platform);
  if (!input)
    throw new Error('Købet mangler en transaktion fra butikken');
  return input.platform === 'ios'
    ? storeBillingApi.verifyApple.mutate({ signedTransaction: input.signedTransaction })
    : storeBillingApi.verifyGoogle.mutate({ productId: input.productId, purchaseToken: input.purchaseToken });
}

function isAcknowledged(purchase: Purchase): boolean {
  return 'isAcknowledgedAndroid' in purchase && purchase.isAcknowledgedAndroid === true;
}

/** Serverens svar viser, at netop dette Google Play-køb nu er kontoens abonnement. */
function serverHasPurchase(current: StoreSubscription, purchase: Purchase): boolean {
  return liveStoreSource(current) === 'google' && current.productId === purchase.productId;
}

/**
 * Verificér ét køb hos serveren og afslut det derefter hos butikken.
 * Ventende køb (Ask to Buy, ventende betaling på Android) røres ikke: de kommer igen,
 * når de er godkendt. På Android sendes de igen fra `recoverUnfinished`, så længe de ikke
 * er kvitteret.
 */
export async function verifyAndFinish(purchase: Purchase, platform: StorePlatform): Promise<HandleResult> {
  if (isPendingPurchase(purchase))
    return { status: 'pending' };
  // Samme køb kan komme fra både lytteren og en gendannelse på samme tid.
  const key = purchase.purchaseToken ?? purchase.id;
  if (inFlight.has(key))
    return { status: 'skipped' };
  inFlight.add(key);
  try {
    let current: StoreSubscription;
    try {
      current = await verify(purchase, platform);
    }
    catch (error) {
      return { status: 'error', error };
    }
    // Android: serveren kvitterer (acknowledge) selv købet, når den har skrevet det, og lader
    // med vilje være, når den ikke vil have det (fx et løbende web-abonnement), så Google
    // refunderer. Appen kvitterer derfor aldrig selv. Melder Google stadig købet afventende,
    // selvom telefonen ser det som gennemført, skriver serveren intet og svarer blot med
    // kontoens plan. Købet forbliver så ukvitteret og sendes igen ved næste opstart eller når
    // appen kommer frem.
    if (platform === 'android')
      return serverHasPurchase(current, purchase) || isAcknowledged(purchase) ? { status: 'verified', current } : { status: 'pending' };
    try {
      await finishTransaction({ purchase, isConsumable: false });
    }
    catch (error) {
      // Serveren har købet, så brugeren har sin plan. Transaktionen afsluttes ved næste opstart.
      captureError(error);
    }
    return { status: 'verified', current };
  }
  finally {
    inFlight.delete(key);
  }
}

export type RestoreResult = {
  /** Antal af appens køb, butikken kendte til. */
  found: number;
  verified: number;
  pending: number;
  /** Første fejl fra serveren, hvis nogen. */
  error?: unknown;
  current?: StoreSubscription;
};

async function verifyAll(purchases: Purchase[], platform: StorePlatform): Promise<RestoreResult> {
  const result: RestoreResult = { found: purchases.length, verified: 0, pending: 0 };
  // Én ad gangen: serveren skal ikke se den samme konto skifte plan i parallelle kald.
  for (const purchase of purchases) {
    const handled = await verifyAndFinish(purchase, platform);
    if (handled.status === 'verified') {
      result.verified += 1;
      result.current = handled.current;
    }
    else if (handled.status === 'pending') {
      result.pending += 1;
    }
    else if (handled.status === 'error' && result.error === undefined) {
      result.error = handled.error;
    }
  }
  return result;
}

async function ownPurchases(skus: string[]): Promise<Purchase[]> {
  const purchases = await getAvailablePurchases();
  return purchases.filter(p => skus.includes(p.productId));
}

/** "Gendan køb": synkronisér med butikken og lad serveren verificere hvert køb igen. */
export async function restore(skus: string[], platform: StorePlatform): Promise<RestoreResult> {
  await ensureConnection();
  await restorePurchases();
  return verifyAll(await ownPurchases(skus), platform);
}

/**
 * Ved opstart: køb, der blev afbrudt før verificering. På Android er det køb, der ikke er
 * kvitteret (acknowledged); dem refunderer Google efter 3 dage. På iOS sender StoreKit selv
 * uafsluttede transaktioner til købslytteren, så her er intet at gøre.
 */
export async function recoverUnfinished(skus: string[], platform: StorePlatform): Promise<RestoreResult | null> {
  if (platform !== 'android')
    return null;
  const unfinished = (await ownPurchases(skus)).filter(p => 'isAcknowledgedAndroid' in p && p.isAcknowledgedAndroid === false);
  return unfinished.length > 0 ? verifyAll(unfinished, platform) : null;
}

/**
 * Android: et aktivt Google Play-abonnement på en anden plan eller periode skal skiftes ud
 * ved købet, ellers betaler brugeren for to. iOS klarer det selv i abonnementsgruppen.
 */
export async function replaceablePurchase(skus: string[], platform: StorePlatform, offer: StoreOffer): Promise<ReplacedPurchase | undefined> {
  if (platform !== 'android')
    return undefined;
  const active = (await ownPurchases(skus)).find(p => !isPendingPurchase(p) && p.purchaseToken);
  if (!active?.purchaseToken)
    return undefined;
  // Samme produkt og basisplan, eller basisplanen er ukendt: ingen udskiftning. Google Play
  // svarer så selv "allerede ejet" i stedet for at skifte abonnementet ud med sig selv.
  if (active.productId === offer.productId && (!active.currentPlanId || active.currentPlanId === offer.basePlanId))
    return undefined;
  return { productId: active.productId, purchaseToken: active.purchaseToken };
}
