/**
 * Freemium-rettigheder samlet ét sted (spec: specs/freemium-og-polish.md).
 *
 * - free: uden konto — alt det basale, op til 3 kunder, ingen sync.
 * - private: kommende "Privat" (~29 kr./md.) — sync, ubegrænsede kunder, årsoversigt, eksport.
 * - business: konto på solo/team/enterprise — styres af web's abonnement og capabilities.
 *
 * Indtil Privat kan købes (IAP), er Privat-funktioner åbne i gratis som "gratis i beta",
 * undtagen ubegrænsede kunder og sync, som er selve grænsen for gratis.
 */

export type PlanTier = 'free' | 'private' | 'business';

export type PlanFeature = 'yearStats' | 'export' | 'unlimitedClients' | 'sync';

export const FREE_CLIENT_LIMIT = 3;

/** Slås fra, når Privat kan købes i appen — så bliver beta-funktionerne låste i gratis. */
export const PRIVATE_BETA_OPEN = true;

/** Privat-funktioner der er åbne i gratis under beta. */
const BETA_FEATURES: ReadonlySet<PlanFeature> = new Set(['yearStats', 'export']);

/** Funktioner der hører til Privat (vises med Privat-mærke i gratis). */
export const PRIVATE_FEATURES: readonly PlanFeature[] = ['sync', 'unlimitedClients', 'yearStats', 'export'];

export function resolveTier(signedIn: boolean): PlanTier {
  return signedIn ? 'business' : 'free';
}

export function canUse(tier: PlanTier, feature: PlanFeature, betaOpen = PRIVATE_BETA_OPEN): boolean {
  if (tier !== 'free')
    return true;
  return betaOpen && BETA_FEATURES.has(feature);
}

/** Vises funktionen som en Privat-funktion (mærke) for denne bruger? */
export function isPrivateFeature(tier: PlanTier, feature: PlanFeature): boolean {
  return tier === 'free' && PRIVATE_FEATURES.includes(feature);
}

export function clientLimit(tier: PlanTier): number {
  return canUse(tier, 'unlimitedClients') ? Number.POSITIVE_INFINITY : FREE_CLIENT_LIMIT;
}

export function canAddClient(tier: PlanTier, currentCount: number): boolean {
  return currentCount < clientLimit(tier);
}
