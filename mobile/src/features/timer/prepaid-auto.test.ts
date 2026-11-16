import { isPrepaidDeductionError, isPrepaidExpired, pickAutoDeductPackage } from './prepaid-auto';

jest.mock('~/lib/api/trpc', () => ({ trpcClient: {} }));

/**
 * Samme fixtures som web's `auto-select.test.ts` (#422 + FIFO fra #771): reglen
 * skal give samme kort på telefonen som på web og i extensionen.
 */
const NOW = new Date('2026-10-02T10:00:00.000Z');

function pkg(id: string, extra: Record<string, unknown> = {}) {
  return { id, autoDeduct: true, remainingHours: 5 as number | string, expiryDate: null as string | null, ...extra };
}

describe('pickAutoDeductPackage', () => {
  it('vælger intet uden kort', () => {
    expect(pickAutoDeductPackage([], NOW)).toBeNull();
    expect(pickAutoDeductPackage(undefined, NOW)).toBeNull();
  });

  it('springer kort uden auto-træk, uden saldo og inaktive over', () => {
    expect(pickAutoDeductPackage([
      pkg('slaaet-fra', { autoDeduct: false }),
      pkg('tom', { remainingHours: '0.00' }),
      pkg('inaktiv', { isActive: false }),
    ], NOW)).toBeNull();
  });

  it('vælger det kort, der udløber først; kort uden udløb kommer sidst', () => {
    const picked = pickAutoDeductPackage([
      pkg('uden'),
      pkg('senere', { expiryDate: '2026-12-31T00:00:00.000Z' }),
      pkg('snart', { expiryDate: '2026-10-15T00:00:00.000Z' }),
    ], NOW);
    expect(picked?.id).toBe('snart');
  });

  it('samme udløb: ældste købte først (FIFO)', () => {
    const picked = pickAutoDeductPackage([
      pkg('ny', { purchaseDate: '2026-08-01T00:00:00.000Z' }),
      pkg('gammel', { purchaseDate: '2026-06-01T00:00:00.000Z' }),
    ], NOW);
    expect(picked?.id).toBe('gammel');
  });

  it('uden købsdato: serverens nyeste-først-liste læses baglæns (ældste først)', () => {
    const picked = pickAutoDeductPackage([pkg('nyeste'), pkg('mellem'), pkg('aeldste')], NOW);
    expect(picked?.id).toBe('aeldste');
  });

  it('decimal-strenge som saldo forstås', () => {
    expect(pickAutoDeductPackage([pkg('a', { remainingHours: '1.50' })], NOW)?.id).toBe('a');
  });

  it('et kort, der udløber i dag, gælder hele dagen i dansk tid', () => {
    // Udløbsdato 2/10 gemt som UTC-midnat; kl. 23:30 dansk tid er det stadig gyldigt.
    const lateEvening = new Date('2026-10-02T21:30:00.000Z');
    expect(pickAutoDeductPackage([pkg('i-dag', { expiryDate: '2026-10-02T00:00:00.000Z' })], lateEvening)?.id).toBe('i-dag');
  });

  it('springer et udløbet kort over', () => {
    expect(pickAutoDeductPackage([pkg('i-gaar', { expiryDate: '2026-10-01T00:00:00.000Z' })], NOW)).toBeNull();
  });
});

describe('isPrepaidExpired', () => {
  it('kort uden udløb udløber aldrig', () => {
    expect(isPrepaidExpired(null, NOW)).toBe(false);
  });

  it('udløber ved dansk midnat efter udløbsdatoen — også ældre rækker gemt som dansk midnat', () => {
    // 22:00Z 1/10 = dansk midnat 2/10 → udløbsdatoen er 2/10.
    expect(isPrepaidExpired('2026-10-01T22:00:00.000Z', new Date('2026-10-02T21:59:00.000Z'))).toBe(false);
    expect(isPrepaidExpired('2026-10-01T22:00:00.000Z', new Date('2026-10-02T22:00:00.000Z'))).toBe(true);
  });
});

describe('isPrepaidDeductionError', () => {
  it('genkender serverens klippekort-afvisninger', () => {
    expect(isPrepaidDeductionError(new Error('Klippekortet er udløbet'))).toBe(true);
    expect(isPrepaidDeductionError(new Error('Ikke nok timer tilbage på klippekortet.'))).toBe(true);
    expect(isPrepaidDeductionError(new Error('Projektet er lukket'))).toBe(false);
    expect(isPrepaidDeductionError(null)).toBe(false);
  });
});
