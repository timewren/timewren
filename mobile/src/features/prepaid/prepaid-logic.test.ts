import {
  addMonthsISO,
  daysUntil,
  expiryTone,
  isISODate,
  parseDecimal,
  prepaidSegment,
  prepaidStatus,
  sortByBalance,
} from './prepaid-logic';

const NOW = new Date('2026-09-06T10:00:00Z'); // 12:00 dansk sommertid

describe('prepaid-logic', () => {
  it('daysUntil', () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil('2026-09-16T00:00:00.000Z', NOW)).toBe(10);
    expect(daysUntil('2026-09-01T00:00:00.000Z', NOW)).toBe(-5);
    expect(daysUntil('2026-09-06T00:00:00.000Z', NOW)).toBe(0);
    expect(daysUntil('ugyldig', NOW)).toBeNull();
  });

  it('expiryTone', () => {
    expect(expiryTone(null)).toBe('default');
    expect(expiryTone(0)).toBe('warning');
    expect(expiryTone(-1)).toBe('danger');
    expect(expiryTone(-3)).toBe('danger');
    expect(expiryTone(29)).toBe('warning');
    expect(expiryTone(30)).toBe('default');
  });

  it('prepaidStatus: sund saldo', () => {
    const s = prepaidStatus({ totalHours: '10', remainingHours: '8', expiryDate: null }, NOW);
    expect(s.fraction).toBe(0.8);
    expect(s.usedHours).toBe(2);
    expect(s.isLowBalance).toBe(false);
    expect(s.balanceTone).toBe('violet');
    expect(s.isExpired).toBe(false);
  });

  it('prepaidStatus: lav saldo og udløber snart', () => {
    const s = prepaidStatus({ totalHours: 10, remainingHours: 2, expiryDate: '2026-09-20T00:00:00' }, NOW);
    expect(s.isLowBalance).toBe(true);
    expect(s.balanceTone).toBe('warning');
    expect(s.isExpiringSoon).toBe(true);
    expect(s.expiryTone).toBe('warning');
  });

  it('prepaidStatus: opbrugt og udløbet', () => {
    const s = prepaidStatus({ totalHours: 10, remainingHours: 0, expiryDate: '2026-01-01T00:00:00' }, NOW);
    expect(s.isDepleted).toBe(true);
    expect(s.isLowBalance).toBe(false);
    expect(s.balanceTone).toBe('danger');
    expect(s.isExpired).toBe(true);
    expect(s.expiryTone).toBe('danger');
    expect(s.fraction).toBe(0);
  });

  it('prepaidStatus: gælder hele udløbsdagen (#738)', () => {
    const s = prepaidStatus({ totalHours: 10, remainingHours: 5, expiryDate: '2026-09-06T00:00:00.000Z' }, NOW);
    expect(s.isExpired).toBe(false);
    expect(s.daysUntilExpiry).toBe(0);
    expect(s.isExpiringSoon).toBe(true);
    expect(s.expiryTone).toBe('warning');
    const dagenEfter = prepaidStatus({ totalHours: 10, remainingHours: 5, expiryDate: '2026-09-06T00:00:00.000Z' }, new Date('2026-09-06T22:01:00Z'));
    expect(dagenEfter.isExpired).toBe(true);
  });

  it('prepaidSegment', () => {
    expect(prepaidSegment({ totalHours: 1, remainingHours: 1, expiryDate: null, isArchived: true }, NOW)).toBe('archived');
    expect(prepaidSegment({ totalHours: 1, remainingHours: 1, expiryDate: '2026-01-01' }, NOW)).toBe('expired');
    expect(prepaidSegment({ totalHours: 1, remainingHours: 1, expiryDate: null, isActive: false }, NOW)).toBe('expired');
    expect(prepaidSegment({ totalHours: 1, remainingHours: 1, expiryDate: '2027-01-01', isActive: true }, NOW)).toBe('active');
    expect(prepaidSegment({ totalHours: 1, remainingHours: 1, expiryDate: '2026-09-06T00:00:00.000Z' }, NOW)).toBe('active');
  });

  it('sortByBalance: laveste andel først', () => {
    const list = [
      { id: 'a', totalHours: 10, remainingHours: 9, expiryDate: null },
      { id: 'b', totalHours: 10, remainingHours: 1, expiryDate: null },
      { id: 'c', totalHours: 20, remainingHours: 10, expiryDate: null },
    ];
    expect(sortByBalance(list).map(p => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('addMonthsISO + isISODate', () => {
    expect(addMonthsISO(3, new Date('2026-09-06T12:00:00'))).toBe('2026-12-06');
    expect(addMonthsISO(12, new Date('2026-09-06T12:00:00'))).toBe('2027-09-06');
    expect(isISODate('2026-12-06')).toBe(true);
    expect(isISODate('06-12-2026')).toBe(false);
    expect(isISODate('')).toBe(false);
  });

  it('parseDecimal', () => {
    expect(parseDecimal('7,5')).toBe(7.5);
    expect(parseDecimal('7.5')).toBe(7.5);
    expect(parseDecimal(' 8 ')).toBe(8);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });
});
