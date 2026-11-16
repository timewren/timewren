"use client";

import { useCallback, useEffect } from "react";
import { useModules } from "@/hooks/useModules";
import { usePermission } from "@/hooks/usePermission";
import type { NudgeKind, NudgeSurface } from "@/lib/adoption/nudges";
import { trpc } from "@/providers/trpc-provider";

/**
 * Må brugeren se faktura-/klippekort-nudges? Når modulet er slået til, og når
 * brugerens rolle må oprette fakturaer/klippekort. Planen afgør det ikke.
 */
export function useNudgeEligibility() {
  const { isEnabled, isPlaceholder } = useModules();
  const invoices = usePermission("invoices");
  const klippekort = usePermission("klippekort");
  const business = !isPlaceholder;
  return {
    invoicing: business && isEnabled("invoicing") && invoices.canWrite,
    klippekort: business && isEnabled("klippekort") && klippekort.canWrite,
  };
}

/**
 * Måling: "vist" sendes højst én gang pr. browser-session pr. nudge/kunde/
 * flade, så et genbesøg ikke puster tallet op. "Klikket" sendes ved hvert klik.
 */
export function useNudgeTracking(
  nudge: NudgeKind,
  surface: NudgeSurface,
  clientId: string | undefined,
) {
  const { mutate } = trpc.nudges.track.useMutation();

  useEffect(() => {
    if (!clientId) return;
    const key = `tt-nudge-shown:${nudge}:${surface}:${clientId}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Ingen sessionStorage (privat vindue o.l.) — mål alligevel
    }
    mutate({ nudge, surface, clientId, action: "shown" });
  }, [nudge, surface, clientId, mutate]);

  return useCallback(() => {
    if (clientId) mutate({ nudge, surface, clientId, action: "clicked" });
  }, [nudge, surface, clientId, mutate]);
}
