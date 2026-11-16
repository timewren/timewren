"use client";

import { derivePlanGate, type PlanGate } from "@/lib/billing/plan-gate";
import { trpc } from "@/providers/trpc-provider";

/**
 * Plan-gate til dashboard-UI'et (Gratis/Privat vs. betalte planer). Bruger de
 * samme queries som dashboard-layoutet, så svaret normalt kommer fra cachen.
 * Serveren håndhæver grænserne — dette styrer kun hvad UI'et tilbyder.
 */
export function usePlanGate(): PlanGate {
  const { data: details, isError } = trpc.subscription.getDetails.useQuery();
  const { data: profile } = trpc.user.getProfile.useQuery();
  // Fejlet hentning = ingen UI-gate (serveren afviser stadig), så knapperne
  // ikke forsvinder permanent pga. en netværksfejl.
  return derivePlanGate(isError ? null : details, {
    isAdmin: profile?.role === "admin",
  });
}
