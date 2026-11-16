import type { PlanFeature } from './plan-logic';
import * as React from 'react';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { canAddClient, canUse, clientLimit, isPrivateFeature, resolveTier } from './plan-logic';

/** Brugerens niveau og rettigheder. Alle freemium-beslutninger går gennem denne hook. */
export function usePlan() {
  const signedIn = useAuthStore.use.status() === 'signIn';
  return React.useMemo(() => {
    const tier = resolveTier(signedIn);
    return {
      tier,
      can: (feature: PlanFeature) => canUse(tier, feature),
      /** Skal funktionen vises med Privat-mærke? */
      isPrivate: (feature: PlanFeature) => isPrivateFeature(tier, feature),
      clientLimit: clientLimit(tier),
      canAddClient: (count: number) => canAddClient(tier, count),
    };
  }, [signedIn]);
}
