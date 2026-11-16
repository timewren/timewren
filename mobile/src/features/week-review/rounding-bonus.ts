import type { RouterOutputs } from '~/api/app-router';

/** Svar fra `time.getRoundingBonus` — måneds- og årstal for den afrundede ekstra indtjening. */
export type RoundingBonus = RouterOutputs['time']['getRoundingBonus'];

/** Kun de felder, kortet bruger. */
export type RoundingBonusData = Pick<RoundingBonus, 'thisMonth' | 'thisYear' | 'hasRoundingActive'>;

export type BonusTone = 'success' | 'danger' | 'default';

/**
 * Uden aktiv afrunding viser web en CTA. På en ugesummering ville den bare
 * fylde: brugeren har bedt om sin uge, ikke om en salgstale om tidsregistrering.
 */
export function isBonusRelevant(data: RoundingBonusData | null | undefined): boolean {
  return data?.hasRoundingActive === true;
}

/** Serveren summerer uden fortegn, så afrunding NED kommer som et negativt tal. */
export function bonusTone(amount: number): BonusTone {
  if (!Number.isFinite(amount) || amount === 0)
    return 'default';
  return amount > 0 ? 'success' : 'danger';
}

/** Et negativt tal må ikke stå med "ekstra indtjent" over sig. */
export function bonusCaptionKey(amount: number): 'week_review.bonus_earned' | 'week_review.bonus_lost' {
  return amount > 0 ? 'week_review.bonus_earned' : 'week_review.bonus_lost';
}

/** Serveren har allerede afrundet til hele kroner; dette tager kun imod et ugyldigt svar. */
export function roundedAmount(amount: number | null | undefined): number {
  return typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount) : 0;
}
