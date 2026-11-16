"use client";

import { trpc } from "@/providers/trpc-provider";

/**
 * Om betaling og planer gælder (#962). `enabled` er false på en selvhostet
 * instans uden betalingsudbyder: så skjules planvisning, opgraderingsknapper,
 * prisvægge og trial-bannere. `isLoading` er true indtil serveren har svaret,
 * så UI'et ikke blinker en prisvæg for et øjeblik.
 *
 * `checkoutAvailable` er false på TimeWren-hosts, hvor betaling kommer senere
 * (lib/billing/brand-billing.ts): kontoen er på Gratis, plan-trinnet i
 * onboardingen springes over, og opgradering vises som "kommer snart".
 */
export function useBillingEnabled(): {
  enabled: boolean;
  checkoutAvailable: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = trpc.subscription.billingEnabled.useQuery(
    undefined,
    { staleTime: Number.POSITIVE_INFINITY },
  );
  // Ukendt (indlæser/fejl) = som Cloud i dag, så intet skjules ved en fejl
  return {
    enabled: data?.enabled ?? true,
    checkoutAvailable: data?.checkoutAvailable ?? true,
    isLoading,
  };
}
