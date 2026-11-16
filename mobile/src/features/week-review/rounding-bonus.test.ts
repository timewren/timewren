import type { RoundingBonusData } from './rounding-bonus';
import {
  bonusCaptionKey,
  bonusTone,
  isBonusRelevant,
  roundedAmount,
} from './rounding-bonus';

function bonus(over: Partial<RoundingBonusData> = {}): RoundingBonusData {
  return { thisMonth: 214, thisYear: 1840, hasRoundingActive: true, ...over };
}

describe('isBonusRelevant', () => {
  it('viser tallet når afrunding faktisk er slået til', () => {
    expect(isBonusRelevant(bonus())).toBe(true);
  });

  it('viser intet når ingen har afrunding — web skubber en CTA, en stille skærm er bedre', () => {
    expect(isBonusRelevant(bonus({ hasRoundingActive: false }))).toBe(false);
  });

  it('viser intet før serveren har svaret', () => {
    expect(isBonusRelevant(undefined)).toBe(false);
    expect(isBonusRelevant(null)).toBe(false);
  });
});

describe('bonusTone', () => {
  it('grøn for det, afrunding op har tjent', () => {
    expect(bonusTone(214)).toBe('success');
  });

  it('rød for afrunding NED — sådan et tal er en udgift, ikke en gevinst', () => {
    // Serveren summerer uden fortegn, så "Ned (fakturé mindre)" kommer som minus.
    expect(bonusTone(-214)).toBe('danger');
  });

  it('neutral uden en forskel at vise', () => {
    expect(bonusTone(0)).toBe('default');
    expect(bonusTone(Number.NaN)).toBe('default');
  });
});

describe('bonusCaptionKey', () => {
  it('må ikke sige "indtjent" om et negativt tal', () => {
    expect(bonusCaptionKey(214)).toBe('week_review.bonus_earned');
    expect(bonusCaptionKey(0)).toBe('week_review.bonus_lost');
    expect(bonusCaptionKey(-214)).toBe('week_review.bonus_lost');
  });
});

describe('roundedAmount', () => {
  it('beholder serverens hele kroner — den har allerede afrundet', () => {
    expect(roundedAmount(214.49)).toBe(214);
    expect(roundedAmount(-214.51)).toBe(-215);
  });

  it('lader et ugyldigt tal blive 0 frem for "NaN kr."', () => {
    expect(roundedAmount(Number.NaN)).toBe(0);
    expect(roundedAmount(undefined)).toBe(0);
  });
});
