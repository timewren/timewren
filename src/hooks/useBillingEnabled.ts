"use client";

import { trpc } from "@/providers/trpc-provider";

/**
 * Om betaling og planer gælder (#962). `enabled` er false på en selvhostet
 * instans uden betalingsudbyder: så skjules planvisning, opgraderingsknapper,
 * prisvægge og trial-bannere. `isLoading` er true indtil serveren har svaret,
 * så UI'et ikke blinker en prisvæg for et øjeblik.
 *
 * `provider` er hostens betaling: "alunta" (TimeTrack), "stripe" (TimeWren
 * Cloud i EUR, lib/billing/timewren-stripe.ts) eller null (TimeWren uden
 * betaling: kontoen er på Gratis, og opgradering vises som "kommer snart").
 * `checkoutAvailable` er provider !== null.
 */
export function useBillingEnabled(): {
  enabled: boolean;
  checkoutAvailable: boolean;
  provider: "alunta" | "stripe" | null;
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
    provider: data ? data.provider : "alunta",
    isLoading,
  };
}
