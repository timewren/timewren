import type { AluntaSubscription } from "@/lib/alunta";
import {
  expectedSeatsForSubscription,
  isLiveAluntaStatus,
} from "@/lib/billing/seats";
import { includedSeatsForTier, isAluntaSeatsPlan } from "@/lib/config";

/**
 * Rene beslutningsregler for automatisk pladsudvidelse — uden DB/Alunta, så
 * de kan unit-testes og bruges fra tRPC (canInvite) uden sideeffekter.
 */

/** Kan denne tier/status overhovedet udvides automatisk? */
export function canAutoExpandTier(opts: {
  planTier: string | null | undefined;
  status: string | null | undefined;
  aluntaSubscriptionId: string | null | undefined;
}): boolean {
  return (
    (opts.planTier === "team" || opts.planTier === "business") &&
    isLiveAluntaStatus(opts.status) &&
    !!opts.aluntaSubscriptionId
  );
}

/**
 * Vælg det seats-add-on der skal hæves: det live add-on med højest quantity
 * (ved erstat-og-annullér ligger det nyeste øverst). null = intet add-on.
 */
export function pickSeatsSubToExpand(
  subs: AluntaSubscription[],
): AluntaSubscription | null {
  const live = subs.filter(
    (s) => isAluntaSeatsPlan(s.plan?.uuid) && isLiveAluntaStatus(s.status),
  );
  if (live.length === 0) return null;
  return live.reduce((best, s) =>
    (s.quantity ?? 0) > (best.quantity ?? 0) ? s : best,
  );
}

/** Nyt maxSeats efter udvidelse: inkluderede + ny add-on-quantity, clampet. */
export function seatsAfterExpand(tier: string, newQuantity: number): number {
  return expectedSeatsForSubscription({
    tier,
    baseMetaSeatCount: null,
    liveSeatsQuantities: [newQuantity],
  });
}

/**
 * Plan for at lade Alunta følge forbruget: quantity = brugte pladser ud over
 * de inkluderede (aldrig negativ); maxSeats = inkluderede + quantity (clampet
 * til tierens loft). Kunden betaler dermed kun for pladser der er i brug.
 */
export function seatsSyncPlan(opts: {
  tier: string;
  seatsUsed: number;
  currentQuantity: number;
  currentMaxSeats: number;
}): {
  targetQuantity: number;
  targetMaxSeats: number;
  changeQuantity: boolean;
  changeMaxSeats: boolean;
} {
  const included = includedSeatsForTier(opts.tier);
  const targetQuantity = Math.max(0, opts.seatsUsed - included);
  const targetMaxSeats = seatsAfterExpand(opts.tier, targetQuantity);
  return {
    targetQuantity,
    targetMaxSeats,
    changeQuantity: targetQuantity !== opts.currentQuantity,
    changeMaxSeats: targetMaxSeats !== opts.currentMaxSeats,
  };
}
