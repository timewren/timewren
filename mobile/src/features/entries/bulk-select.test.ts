import type { TimeEntry } from './use-entries';
import { billedStateOf, marksBilled, toggleSelection } from './bulk-select';

/**
 * Udvalgstilstandens to sandheder: hvad de valgte poster har for status, og
 * hvad trykket på knappen så gør. Den anden er den vigtigere — en knap der
 * siger "Fjern markering" over en blandet mængde er en løgn om de poster der
 * ikke er fakturerede.
 */

function post(id: string, isBilled: boolean | null) {
  return { id, isBilled } as unknown as TimeEntry;
}

describe('billedStateOf', () => {
  it('kender ingen valgte poster', () => {
    expect(billedStateOf([])).toBe('empty');
  });

  it('kalder en mængde uden fakturerede «none»', () => {
    expect(billedStateOf([post('a', false), post('b', null)])).toBe('none');
  });

  it('kalder en fuldt faktureret mængde «all»', () => {
    expect(billedStateOf([post('a', true), post('b', true)])).toBe('all');
  });

  it('kalder tre poster hvor én er faktureret «mixed»', () => {
    expect(billedStateOf([post('a', true), post('b', false), post('c', false)])).toBe('mixed');
  });

  it('tæller `null` som ikke-faktureret, altså ikke som «all»', () => {
    // Kolonnen er nullable i web's schema, så `null` er netop ikke-faktureret.
    // Tælles den med, ville to poster hvor den ene er `null` få «all», og
    // knappen ville tilbyde at fjerne en markering, der aldrig var der.
    expect(billedStateOf([post('a', true), post('b', null)])).toBe('mixed');
  });
});

describe('marksBilled', () => {
  it('sætter markering på «none» og «mixed»', () => {
    expect(marksBilled('none')).toBe(true);
    expect(marksBilled('mixed')).toBe(true);
  });

  it('fjerner markering kun når alle er fakturerede', () => {
    expect(marksBilled('all')).toBe(false);
  });

  it('gør ingenting uden valgte poster', () => {
    expect(marksBilled('empty')).toBe(true);
  });
});

describe('toggleSelection', () => {
  it('lægger en ukendt post til', () => {
    expect([...toggleSelection(new Set(), 'a')]).toEqual(['a']);
  });

  it('fjerner en post der allerede er valgt', () => {
    expect([...toggleSelection(new Set(['a']), 'a')]).toEqual([]);
  });

  it('rører ikke den mængde, den fik', () => {
    const before = new Set(['a']);
    toggleSelection(before, 'b');
    expect([...before]).toEqual(['a']);
  });
});
