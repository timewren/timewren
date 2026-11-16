import type { ClientListItem } from './client-logic';
import i18n, { translate } from '~/lib/i18n';
import { blankToUndefined, CLIENT_COLOR_CHOICES, CLIENT_COLORS, compareClients, filterClients, isHexColor } from './client-logic';

function c(partial: Partial<ClientListItem> & { id: string; name: string }): ClientListItem {
  return {
    isArchived: false,
    stats: { totalHours: 0, projectCount: 0, unbilledHours: 0, lastActivityDate: null },
    ...partial,
  };
}

const LIST = [
  c({ id: '1', name: 'Ørsted', stats: { totalHours: 10, projectCount: 1, unbilledHours: 0, lastActivityDate: '2026-09-01' } }),
  c({ id: '2', name: 'Alfa', company: 'Alfa ApS', stats: { totalHours: 50, projectCount: 3, unbilledHours: 2, lastActivityDate: '2026-08-01' } }),
  c({ id: '3', name: 'Beta', isArchived: true, stats: { totalHours: 5, projectCount: 0, unbilledHours: 0, lastActivityDate: null } }),
  c({ id: '4', name: 'Gamma', email: 'kontakt@gamma.dk', stats: { totalHours: 0, projectCount: 0, unbilledHours: 0, lastActivityDate: null } }),
];

describe('client-logic', () => {
  it('filtrerer aktive vs. arkiverede', () => {
    expect(filterClients(LIST, { query: '', archived: false, sort: 'name' }).map(x => x.id)).toEqual(['2', '4', '1']);
    expect(filterClients(LIST, { query: '', archived: true, sort: 'name' }).map(x => x.id)).toEqual(['3']);
  });

  it('søger i navn, firma og e-mail', () => {
    expect(filterClients(LIST, { query: 'aps', archived: false, sort: 'name' }).map(x => x.id)).toEqual(['2']);
    expect(filterClients(LIST, { query: 'GAMMA.dk', archived: false, sort: 'name' }).map(x => x.id)).toEqual(['4']);
    expect(filterClients(LIST, { query: 'ørs', archived: false, sort: 'name' }).map(x => x.id)).toEqual(['1']);
  });

  it('sorterer efter timer og seneste aktivitet', () => {
    expect(filterClients(LIST, { query: '', archived: false, sort: 'hours' }).map(x => x.id)).toEqual(['2', '1', '4']);
    expect(filterClients(LIST, { query: '', archived: false, sort: 'activity' }).map(x => x.id)).toEqual(['1', '2', '4']);
  });

  it('compareClients falder tilbage på navn', () => {
    const a = c({ id: 'a', name: 'A' });
    const b = c({ id: 'b', name: 'B' });
    expect(compareClients(a, b, 'hours')).toBeLessThan(0);
  });

  it('isHexColor + blankToUndefined', () => {
    expect(isHexColor('#2563EB')).toBe(true);
    expect(isHexColor('blue')).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(blankToUndefined('  ')).toBeUndefined();
    expect(blankToUndefined(' x ')).toBe('x');
  });
});

describe('kundefarver', () => {
  it('har et dansk navn til hver farve, så skærmlæseren ikke læser en hex-kode', async () => {
    await i18n.changeLanguage('da');
    const names = CLIENT_COLOR_CHOICES.map(c => translate(c.tx));
    expect(names).not.toContain('#2563EB');
    // En manglende oversættelse giver nøglen tilbage — sådan afsløres den.
    expect(names.filter((n, i) => n === CLIENT_COLOR_CHOICES[i].tx)).toEqual([]);
    // To ens navne er ubrugelige: man kan ikke vælge den grønne frem for den anden.
    expect(new Set(names).size).toBe(CLIENT_COLOR_CHOICES.length);
    expect(CLIENT_COLOR_CHOICES.every(c => isHexColor(c.hex))).toBe(true);
    expect(CLIENT_COLORS).toEqual(CLIENT_COLOR_CHOICES.map(c => c.hex));
  });

  it('findes på engelsk også', async () => {
    await i18n.changeLanguage('en');
    const names = CLIENT_COLOR_CHOICES.map(c => translate(c.tx));
    expect(names.filter((n, i) => n === CLIENT_COLOR_CHOICES[i].tx)).toEqual([]);
    await i18n.changeLanguage('da');
  });
});
