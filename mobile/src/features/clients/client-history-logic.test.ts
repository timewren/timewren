import type { HistoryLog } from './client-history-logic';
import i18n from '~/lib/i18n';
import { formatValue, isEmptyHistory, isTruncated, readChanges, toHistory, toHistoryEntry } from './client-history-logic';

beforeEach(async () => {
  await i18n.changeLanguage('da');
});

/** Serverens `FieldChange[]`, som `clients.update` skriver via `detectChanges`. */
function change(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return { field: 'name', fieldLabel: 'Navn', before: null, after: 'Ny', ...partial };
}

function log(partial: Partial<HistoryLog> = {}): HistoryLog {
  return { id: 'log-1', action: 'update', changes: [], createdAt: '2026-10-01T12:32:00.000Z', user: { id: 'u1', name: 'Mads Holst Jensen' }, ...partial };
}

describe('formatValue', () => {
  it('viser «—» for null, fordi serverens detectChanges normaliserer undefined til null', () => {
    expect(formatValue('email', null)).toBe('—');
    expect(formatValue('email', undefined)).toBe('—');
  });

  it('viser en ryddet e-mail som «—» og ikke som «null» eller tom streng', () => {
    expect(formatValue('email', null)).toBe('—');
    expect(formatValue('email', '')).toBe('—');
    expect(formatValue('email', '   ')).toBe('—');
  });

  it('viser boolean-felter som Ja/Nej, fordi de er sande/falske — ikke som 1/0', () => {
    expect(formatValue('defaultBillable', true)).toBe('Ja');
    expect(formatValue('defaultBillable', false)).toBe('Nej');
  });

  it('viser et beløb som kroner, fordi defaultHourlyRate er et beløb', () => {
    expect(formatValue('defaultHourlyRate', '950.00')).toBe('950 kr.');
    expect(formatValue('defaultHourlyRate', 950)).toBe('950 kr.');
  });

  it('lader et tal der ikke er et beløb stå som tal med dansk decimaltegn', () => {
    expect(formatValue('postalCode', '8000')).toBe('8000');
    expect(formatValue('postalCode', 8000)).toBe('8.000');
  });

  it('viser en ISO-datostrag som dato, fordi serveren skriver den som streng', () => {
    // En fast dato i fortiden, så testen ikke afhænger af hvilken dag den kører.
    expect(formatValue('notes', '2026-01-15')).toBe('15. jan.');
  });

  it('maler aldrig [object Object] for en værdi uden læsbar form', () => {
    expect(formatValue('notes', { nested: true })).toBe('—');
    expect(formatValue('notes', ['a', 'b'])).toBe('—');
  });
});

/**
 * `changes` er `jsonb` og utypet i router-output. Serveren skriver en
 * `FieldChange[]`, men intet sikrer det — så porten skal dømme, at en fremtidig
 * form (fx `metadata`-objektet `tasks.ts` skriver) ikke maler `[object Object]`.
 */
describe('readChanges', () => {
  it('læser serverens FieldChange-array', () => {
    const changes = readChanges([change({ field: 'name', before: 'Acme', after: 'Acme A/S' })]);
    expect(changes).toEqual([{ field: 'name', label: 'Navn', before: 'Acme', after: 'Acme A/S' }]);
  });

  it('kaster væk alt der ikke er et array', () => {
    expect(readChanges({ status: { from: 'todo', to: 'done' } })).toEqual([]);
    expect(readChanges(null)).toEqual([]);
    expect(readChanges('navn')).toEqual([]);
  });

  it('kaster væk elementer uden feltnavn eller uden begge værdier', () => {
    expect(readChanges([change({ field: '' })])).toEqual([]);
    expect(readChanges([change({ field: 42 })])).toEqual([]);
    expect(readChanges([{ field: 'name', before: 'a' }])).toEqual([]);
    expect(readChanges([{ field: 'name', after: 'a' }])).toEqual([]);
    // Ét gyldigt element mellem fire ubrugelige: kun det overlever.
    expect(readChanges([null, 'x', 7, [], change()])).toHaveLength(1);
  });

  it('viser feltnavnet fra serveren for nøgler appen ikke kender', () => {
    const changes = readChanges([change({ field: 'paymentTermsDays', fieldLabel: 'Betalingsbetingelser', before: 14, after: 30 })]);
    expect(changes[0]?.label).toBe('Betalingsbetingelser');
  });

  it('falder tilbage på nøglen, når serveren heller ikke har et navn', () => {
    const changes = readChanges([change({ field: 'paymentTermsDays', fieldLabel: null, before: 14, after: 30 })]);
    expect(changes[0]?.label).toBe('paymentTermsDays');
  });

  it('beholder serverens rækkefølge, som følger clientFieldLabels', () => {
    const changes = readChanges([
      change({ field: 'name', before: 'a', after: 'b' }),
      change({ field: 'email', before: 'c', after: 'd' }),
    ]);
    expect(changes.map(c => c.field)).toEqual(['name', 'email']);
  });
});

/**
 * `createdAt` er et rigtigt tidspunkt (`timestamp("created_at")` med
 * `defaultNow()`) — ikke en dato-kolonne som `clients.lastActivityDate`, hvor
 * `formatAgo` engang læste UTC-midnat som et klokkeslæt.
 */
describe('toHistoryEntry', () => {
  it('viser både dagens dato og klokkeslættet', () => {
    const entry = toHistoryEntry(log({ createdAt: iDag() }));
    expect(entry.when).toMatch(/^I dag \d{2}:\d{2}$/);
  });

  it('siger «I går» for et tidspunkt i går — altså læser dagens kalenderdag', () => {
    const iGår = new Date();
    iGår.setDate(iGår.getDate() - 1);
    iGår.setHours(12, 32, 0, 0);
    expect(toHistoryEntry(log({ createdAt: iGår.toISOString() })).when).toMatch(/^I går \d{2}:\d{2}$/);
  });

  it('viser «—» når serveren ikke sendte et tidsstempel', () => {
    expect(toHistoryEntry(log({ createdAt: null })).when).toBe('—');
  });

  it('oversætter de fem handlinger serveren skriver for en kunde', () => {
    const dansk = (action: string) => i18n.t(toHistoryEntry(log({ action })).actionKey);
    expect(dansk('create')).toBe('Oprettet');
    expect(dansk('update')).toBe('Opdateret');
    expect(dansk('archive')).toBe('Arkiveret');
    expect(dansk('restore')).toBe('Gendannet');
    expect(dansk('delete')).toBe('Slettet');
  });

  it('viser den generiske etiket for en ukendt handling, ikke serverens rå nøgle', () => {
    const entry = toHistoryEntry(log({ action: 'bulk_resolution' }));
    expect(i18n.t(entry.actionKey)).toBe('Ændret');
    expect(i18n.t(entry.actionKey)).not.toMatch(/bulk_resolution/);
  });

  it('tager navnet fra den der udførte handlingen', () => {
    expect(toHistoryEntry(log({})).who).toBe('Mads Holst Jensen');
  });

  it('lader feltet være tomt, når serveren ikke gav et navn med', () => {
    expect(toHistoryEntry(log({ user: null })).who).toBe('');
    expect(toHistoryEntry(log({ user: { id: 'u1', name: '  ' } })).who).toBe('');
  });
});

describe('toHistory', () => {
  it('beholder serverens rækkefølge: nyeste først', () => {
    const entries = toHistory([log({ id: 'a' }), log({ id: 'b' })]);
    expect(entries.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('skal ikke have en fejltilstand til fælles med en tom liste', () => {
    expect(isEmptyHistory(toHistory([]))).toBe(true);
    expect(isEmptyHistory(toHistory([log({ id: 'a' })]))).toBe(false);
  });
});

/**
 * Serverens `limit` klipper listen. Uden en note viste en kunde med 60
 * hændelser de 20 seneste som om de var alle.
 */
describe('isTruncated', () => {
  it('siger ja når serveren fyldte grænsen', () => {
    expect(isTruncated(20, 20)).toBe(true);
    expect(isTruncated(25, 20)).toBe(true);
  });

  it('siger nej, så længe der er plads tilbage', () => {
    expect(isTruncated(19, 20)).toBe(false);
    expect(isTruncated(0, 20)).toBe(false);
  });
});

/**
 * Et tidspunkt på **dagens** dato. «I dag» er et spørgsmål om dagens kalenderdag,
 * så et fastsat klokkeslæt som `'2026-10-01T12:32:00.000Z'` var en tidbombe:
 * testen passede den dag den blev skrevet og fejlede dagen efter.
 */
function iDag(time: [number, number] = [12, 32]): string {
  const d = new Date();
  d.setHours(time[0], time[1], 0, 0);
  return d.toISOString();
}
