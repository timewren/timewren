import { packageFraction, pickLowest } from './prepaid-logic';

function pkg(id: string, total: string, remaining: string) {
  return { id, totalHours: total, remainingHours: remaining } as never;
}

describe('prepaid-logic', () => {
  it('beregner saldo-andel og klipper til 0–1', () => {
    expect(packageFraction({ totalHours: '10', remainingHours: '2.5' })).toBe(0.25);
    expect(packageFraction({ totalHours: '10', remainingHours: '-1' })).toBe(0);
    expect(packageFraction({ totalHours: '0', remainingHours: '3' })).toBe(0);
    expect(packageFraction({ totalHours: '10', remainingHours: '12' })).toBe(1);
  });

  it('vælger de tre kort med lavest saldo', () => {
    const lowest = pickLowest([pkg('a', '10', '9'), pkg('b', '10', '1'), pkg('c', '10', '5'), pkg('d', '10', '3')]);
    expect(lowest.map((p: { id: string }) => p.id)).toEqual(['b', 'd', 'c']);
  });
});
