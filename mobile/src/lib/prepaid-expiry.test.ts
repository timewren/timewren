// Paritet med web-helperen (mahope/timetrack#738). `@/*` peger på
// ../src — samme checkout som type-check bruger i CI.
import {
  isPrepaidExpired as webIsPrepaidExpired,
  prepaidDaysUntilExpiry as webPrepaidDaysUntilExpiry,
  prepaidExpiryDateStr as webPrepaidExpiryDateStr,
} from '@/lib/prepaid/expiry';
import {
  isPrepaidExpired,
  prepaidDaysUntilExpiry,
  prepaidExpiryDateStr,
  prepaidExpiryDisplayDate,
  toCopenhagenDateStr,
} from './prepaid-expiry';

// Udløbsdato gemt som UTC-midnat (serverens konvention).
const SOMMER = '2026-07-15T00:00:00.000Z';
const VINTER = '2026-01-15T00:00:00.000Z';

describe('prepaid-expiry: kortet gælder hele udløbsdagen i dansk tid', () => {
  it.each([
    { label: 'sommertid kl. 00:30 på udløbsdagen', expiry: SOMMER, now: '2026-07-14T22:30:00Z', expired: false, days: 0 },
    { label: 'sommertid kl. 23:30 på udløbsdagen', expiry: SOMMER, now: '2026-07-15T21:30:00Z', expired: false, days: 0 },
    { label: 'sommertid dagen efter kl. 00:01', expiry: SOMMER, now: '2026-07-15T22:01:00Z', expired: true, days: -1 },
    { label: 'vintertid kl. 00:30 på udløbsdagen', expiry: VINTER, now: '2026-01-14T23:30:00Z', expired: false, days: 0 },
    { label: 'vintertid kl. 23:30 på udløbsdagen', expiry: VINTER, now: '2026-01-15T22:30:00Z', expired: false, days: 0 },
    { label: 'vintertid dagen efter kl. 00:01', expiry: VINTER, now: '2026-01-15T23:01:00Z', expired: true, days: -1 },
    { label: 'dagen før', expiry: SOMMER, now: '2026-07-14T10:00:00Z', expired: false, days: 1 },
  ])('$label', ({ expiry, now, expired, days }) => {
    expect(isPrepaidExpired(expiry, new Date(now))).toBe(expired);
    expect(prepaidDaysUntilExpiry(expiry, new Date(now))).toBe(days);
  });

  it('ældre rækker gemt som dansk midnat lander på samme dato', () => {
    expect(prepaidExpiryDateStr('2026-07-14T22:00:00.000Z')).toBe('2026-07-15');
    expect(prepaidExpiryDateStr('2026-01-14T23:00:00.000Z')).toBe('2026-01-15');
    expect(prepaidExpiryDateStr(new Date(SOMMER))).toBe('2026-07-15');
  });

  it('skiftedagene mellem sommer- og vintertid', () => {
    // 29/3-2026: sommertid starter kl. 02:00 dansk (01:00Z)
    expect(toCopenhagenDateStr(new Date('2026-03-28T22:59:00Z'))).toBe('2026-03-28');
    expect(toCopenhagenDateStr(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
    expect(toCopenhagenDateStr(new Date('2026-03-29T21:59:00Z'))).toBe('2026-03-29');
    expect(toCopenhagenDateStr(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
    // 25/10-2026: vintertid starter kl. 03:00 dansk (01:00Z)
    expect(isPrepaidExpired('2026-10-25T00:00:00.000Z', new Date('2026-10-25T22:59:00Z'))).toBe(false);
    expect(isPrepaidExpired('2026-10-25T00:00:00.000Z', new Date('2026-10-25T23:00:00Z'))).toBe(true);
  });

  it('intet udløb og ugyldige værdier', () => {
    expect(isPrepaidExpired(null)).toBe(false);
    expect(prepaidDaysUntilExpiry(undefined)).toBeNull();
    expect(prepaidDaysUntilExpiry('ugyldig')).toBeNull();
    expect(prepaidExpiryDisplayDate(null)).toBeNull();
  });

  it('visningsdato er den danske dato uanset tidszone', () => {
    const d = prepaidExpiryDisplayDate('2026-07-14T22:00:00.000Z');
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2026, 6, 15]);
  });
});

describe('paritet: app == web (src/lib/prepaid/expiry.ts)', () => {
  const expiries = [
    SOMMER,
    VINTER,
    '2026-03-29T00:00:00.000Z',
    '2026-03-28T23:00:00.000Z',
    '2026-10-25T00:00:00.000Z',
    '2026-10-24T22:00:00.000Z',
    '2026-12-31T00:00:00.000Z',
    '2026-07-15T13:37:00.000Z',
    null,
  ];
  // Hver halve time fra midt i marts til start november 2026 (begge skift).
  const instants: Date[] = [];
  for (let t = Date.parse('2026-03-20T00:15:00Z'); t < Date.parse('2026-11-05T00:00:00Z'); t += 30 * 60 * 1000)
    instants.push(new Date(t));
  // Plus vintertid omkring nytår.
  for (let t = Date.parse('2025-12-28T00:15:00Z'); t < Date.parse('2026-01-20T00:00:00Z'); t += 30 * 60 * 1000)
    instants.push(new Date(t));

  it('samme udløbsdato', () => {
    for (const e of expiries)
      expect(prepaidExpiryDateStr(e)).toBe(webPrepaidExpiryDateStr(e));
  });

  it('samme isPrepaidExpired og dagstælling på alle tidspunkter', () => {
    const mismatches: string[] = [];
    for (const e of expiries) {
      for (const now of instants) {
        if (isPrepaidExpired(e, now) !== webIsPrepaidExpired(e, now)
          || prepaidDaysUntilExpiry(e, now) !== webPrepaidDaysUntilExpiry(e, now)) {
          mismatches.push(`${e} @ ${now.toISOString()}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});
