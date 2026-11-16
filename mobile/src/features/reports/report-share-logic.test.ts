import i18n from '~/lib/i18n';
import {
  canCreateLink,
  defaultShareName,
  linkSubtitle,
  periodLabel,
  SHARE_NAME_MAX,
  shareMessage,
  trimmedShareName,
} from './report-share-logic';

/**
 * Deling af en tidsrapport: navnet på et nyt link, og hvad et eksisterende
 * link fortæller. Begge er **påstande om perioden**, så de skal kunne læses
 * af og verificeres — en rapport der siger «oktober 2026» og en der viser
 * september, er to sandheder om samme skærm.
 */

type ShareLink = Parameters<typeof linkSubtitle>[0];

function link(over: Partial<ShareLink> = {}): ShareLink {
  return {
    id: 'l1',
    token: 'tok-1',
    name: 'Oktober — Acme',
    lockedDates: true,
    viewCount: 0,
    url: 'https://app.timetrack.dk/r/abc',
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    lastViewedAt: null,
    ...over,
  };
}

beforeEach(async () => {
  // Skærmen er dansk, og den tekst der dømmes, er dansk.
  await i18n.changeLanguage('da');
});

describe('navnet på et nyt link', () => {
  it('accepterer et navn, men ikke et der kun er mellemrum', () => {
    expect(canCreateLink('Oktober — Acme')).toBe(true);
    expect(canCreateLink('   ')).toBe(false);
    expect(canCreateLink('')).toBe(false);
  });

  /**
   * Serveren tæller tegn i det rå navn (`z.string().max(120)`). Uden trim ville
   * «   » passere en længdeprøvning på det u trimmede navn og blive afvist med
   * en rå zod-fejl — altså et felt der ser gyldigt ud og så fejler ved tryk.
   */
  it('tæller det trimmede navn, så « » ikke kan nå serverens grænse', () => {
    const padded = `  ${'x'.repeat(SHARE_NAME_MAX)}  `;
    expect(trimmedShareName(padded)).toHaveLength(SHARE_NAME_MAX);
    expect(canCreateLink(padded)).toBe(true);
    expect(canCreateLink(`  ${'x'.repeat(SHARE_NAME_MAX + 1)}  `)).toBe(false);
  });
});

describe('perioden i navnet', () => {
  /**
   * Én kalendermåned bliver «oktober 2026» — det er det navn en kunde genkender.
   * Datoerne kommer fra `getReportData`, så de er samme periode som rapporten.
   */
  it('skriver én måned som «oktober 2026»', () => {
    expect(periodLabel({ start: '2026-10-01', end: '2026-10-31' })).toBe('Oktober 2026');
    // Samme måned i et andet år må ikke låne året fra `end`.
    expect(periodLabel({ start: '2025-03-01', end: '2025-03-31' })).toBe('Marts 2025');
  });

  it('skriver en periode på tværs af måneder med år på begge datoer', () => {
    expect(periodLabel({ start: '2026-09-28', end: '2026-10-04' })).toBe('28. sep. 2026 – 4. okt. 2026');
  });

  /**
   * `formatDateShort` skjuler året for indeværende år. I en periode på tværs af
   * år gjorde det «29. dec. 2025 – 4. jan.» — der læses som om januar lå
   * **før** december. Begge datoer får deres år i denne form.
   */
  it('læser rigtigt for en periode der krydser nytår', () => {
    const label = periodLabel({ start: '2025-12-29', end: '2026-01-04' });
    expect(label).toBe('29. dec. 2025 – 4. jan. 2026');
  });

  it('siger «ukendt periode» frem for «Invalid Date» ved en ugyldig dato', () => {
    expect(periodLabel({ start: 'x', end: '2026-10-31' })).toBe('Ukendt periode');
    expect(periodLabel({ start: '2026-10-31', end: '' })).toBe('Ukendt periode');
  });

  /**
   * `new Date('2026-02-31')` ruller stille hen til 3. marts, så en umulig dato
   * ellers ville få navnet på en **anden** periode end rapporten viser.
   * Kalenderens egne dele siger «ugyldig», og det er svaret vi bruger.
   */
  it('ruller ikke en umulig dato hen til næste måned', () => {
    expect(periodLabel({ start: '2026-02-31', end: '2026-02-31' })).toBe('Ukendt periode');
    expect(periodLabel({ start: '2026-04-31', end: '2026-04-30' })).toBe('Ukendt periode');
  });

  it('sætter perioden foran et fast navn', () => {
    expect(defaultShareName({ start: '2026-10-01', end: '2026-10-31' })).toBe('Tidsrapport Oktober 2026');
  });
});

describe('beskeden der sendes til share-arket', () => {
  /**
   * Én streng bruges både ved oprettelse og ved «Del igen». Uden et fælles sted
   * kunne den ene vej sende navnet og den anden kun URL'en.
   */
  it('indeholder både navnet og URL\'en', () => {
    expect(shareMessage(link())).toBe('Oktober — Acme\nhttps://app.timetrack.dk/r/abc');
  });

  it('kan ikke dele et ældre link, hvis URL kun fandtes ved oprettelsen (hashet token)', () => {
    // Typen er `string | null` fra web #727; castet holder testen gyldig mod ældre web-typer.
    const hashed = { ...link(), url: null, token: null } as unknown as ShareLink;
    expect(shareMessage(hashed)).toBeNull();
    expect(linkSubtitle(hashed)).toContain('kun deles lige efter oprettelse');
  });
});

describe('undertitlen på et eksisterende link', () => {
  it('siger om perioden er låst eller rullende — de betyder forskellige ting', () => {
    expect(linkSubtitle(link({ lockedDates: true }))).toContain('Låste datoer');
    expect(linkSubtitle(link({ lockedDates: false }))).toContain('Rullende periode');
  });

  it('tæller visninger i ental og flertal', () => {
    expect(linkSubtitle(link({ viewCount: 0 }))).toContain('0 visninger');
    expect(linkSubtitle(link({ viewCount: 1 }))).toContain('1 visning');
    expect(linkSubtitle(link({ viewCount: 7 }))).toContain('7 visninger');
  });
});
