import type { RouterInputs, RouterOutputs } from '~/api/app-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '~/lib/api';
import { queryClient } from '~/lib/api/provider';

// ---------------------------------------------------------------------------
// LOKALE TYPER for tRPC-routeren `storeBilling`.
//
// Routeren ligger på web's gren feat/store-billing og er endnu ikke i web's main, som CI
// typechecker appen imod (`~/api/app-router`). Typerne her følger serverens faktiske form
// (storeBilling.ts og store-billing/state.ts, 23/10-2026). `StoreBillingServerCheck` nederst
// sammenligner dem med serverens rigtige typer, så snart AppRouter har `storeBilling`.
//
// Når web's main har routeren: slet typerne og `StoreBillingClient` herunder, brug
// `RouterOutputs['storeBilling']['config']` og kald `trpc.storeBilling.*` direkte.
// Query-nøglen er allerede tRPC's format, så `utils.storeBilling.invalidate()` rammer de
// samme queries.
// ---------------------------------------------------------------------------

export type StorePlatform = 'ios' | 'android';
export type StorePlanTier = 'privat' | 'solo';
export type StoreCycle = 'monthly' | 'yearly';

export type StoreProduct = {
  platform: StorePlatform;
  productId: string;
  basePlanId?: string;
  planTier: StorePlanTier;
  cycle: StoreCycle;
};

/**
 * Kontoens abonnement set fra serveren. `source` er `web` kun ved et løbende abonnement fra
 * websitet. `status` er TimeTracks status (`active`/`canceled`/`trialing`/`free`/`none`), ikke
 * butikkens. `productId` er butikkens produkt-id: på iOS `dk.timetrack.app.privat.monthly`, på
 * Android kun `privat`/`solo` uden basisplan.
 */
export type StoreSubscription = {
  source: 'apple' | 'google' | 'web' | 'none';
  planTier: string | null;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  productId: string | null;
};

/** Hvorfor kontoen ikke kan købe i appen. `null`, når `canPurchase` er true. */
export type PurchaseBlockedReason = 'disabled' | 'not_owner' | 'multi_member' | 'web_subscription' | 'other_organization';

export type StoreBillingConfig = {
  enabled: boolean;
  accountToken: string;
  products: StoreProduct[];
  current: StoreSubscription;
  /** Serveren tager imod et køb fra kontoen. Er den false, vises ingen købsknapper. */
  canPurchase: boolean;
  purchaseBlockedReason: PurchaseBlockedReason | null;
};

type StoreBillingClient = {
  storeBilling: {
    config: { query: () => Promise<StoreBillingConfig> };
    verifyApple: { mutate: (input: { signedTransaction: string }) => Promise<StoreSubscription> };
    verifyGoogle: { mutate: (input: { productId: string; purchaseToken: string }) => Promise<StoreSubscription> };
  };
};

export const storeBillingApi = (trpcClient as unknown as StoreBillingClient).storeBilling;

type ServerOutputs = RouterOutputs extends { storeBilling: infer O } ? O : never;
type ServerInputs = RouterInputs extends { storeBilling: infer I } ? I : never;
type Assignable<A, B> = [A] extends [B] ? true : false;
type Expect<T extends true> = T;

/**
 * Typefejl her betyder, at de lokale typer ikke længere passer til serverens. Uden
 * `storeBilling` i AppRouter (web's main i dag) er tjekket tomt og altid sandt.
 */
export type StoreBillingServerCheck = Expect<
  [ServerOutputs] extends [never]
    ? true
    : Assignable<ServerOutputs, {
      config: StoreBillingConfig;
      verifyApple: StoreSubscription;
      verifyGoogle: StoreSubscription;
    }> extends true
      ? Assignable<
        { verifyApple: { signedTransaction: string }; verifyGoogle: { productId: string; purchaseToken: string } },
        Pick<ServerInputs, 'verifyApple' | 'verifyGoogle'>
      >
      : false
>;

/** Samme nøgleformat som tRPC's egne queries (`[[router, procedure], { type }]`). */
export const STORE_BILLING_CONFIG_KEY = [['storeBilling', 'config'], { type: 'query' }] as const;

/** Butikskøb er slået til, og kontoen har ikke et abonnement fra websitet. */
export function useStoreBillingConfig(active = true) {
  return useQuery({
    queryKey: STORE_BILLING_CONFIG_KEY,
    queryFn: () => storeBillingApi.config.query(),
    enabled: active,
    retry: 1,
  });
}

/** Efter et køb eller en gendannelse: plan, abonnement og rettigheder hentes igen. */
export function invalidateAfterPurchase(): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: [['storeBilling']] }),
    queryClient.invalidateQueries({ queryKey: [['subscription']] }),
    queryClient.invalidateQueries({ queryKey: [['mobile']] }),
  ]);
}
