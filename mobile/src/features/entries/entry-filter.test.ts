import { ALL_BILLABLE, ALL_BILLED, ALL_PROJECTS, applyBillableFilter, applyLocalFilters, entriesQueryInput, filterHidesAll, hasActiveFilter, matchesBillable, matchesBilled, NO_FILTER } from './entry-filter';
import { weekRange } from './period';

const RANGE = weekRange(new Date(2026, 9, 1));

const PROJEKT = { projectId: 'p1', billable: 'all', billed: 'all' } as const;

describe('entriesQueryInput', () => {
  it('sender intet filter uden et valgt projekt', () => {
    expect(entriesQueryInput(RANGE, NO_FILTER).projectId).toBeUndefined();
    // Samme som kaldes uden filter-argument — skærmens starttilstand.
    expect(entriesQueryInput(RANGE).projectId).toBeUndefined();
  });

  it('sender det valgte projekt med', () => {
    const input = entriesQueryInput(RANGE, PROJEKT);
    expect(input.projectId).toBe('p1');
    // Resten af intervallet må ikke ændre sig, så filteret kun indsnævrer.
    expect(input.startDate).toBe('2026-09-28');
    expect(input.endDate).toBe('2026-10-04');
    expect(input.onlyOwn).toBe(true);
  });

  it('behandler "Alle projekter" som intet filter', () => {
    // Vælgeren sender sentinel-strengen; serveren ville få et tomt uuid-filter.
    expect(entriesQueryInput(RANGE, { ...PROJEKT, projectId: ALL_PROJECTS }).projectId).toBeUndefined();
  });

  it('giver forskellig query-nøgle med og uden projektfilter', () => {
    // Ellers deler de to tilstande TanStacks cache, og et filter virker først
    // efter en manuel genindlæsning.
    const all = entriesQueryInput(RANGE, NO_FILTER);
    const one = entriesQueryInput(RANGE, PROJEKT);
    expect(JSON.stringify(one)).not.toBe(JSON.stringify(all));
  });

  it('lader fakturerbar-filteret ude af kaldet', () => {
    // Bevidst lokalt filter: skifter query-nøglen, ville hvert filtervalg
    // starte et nyt kald og tømme listen, selv om serveren har samme data.
    const nøgle = (billable: 'all' | 'billable' | 'non-billable') =>
      JSON.stringify(entriesQueryInput(RANGE, { projectId: ALL_PROJECTS, billable, billed: ALL_BILLED }));
    expect(nøgle('billable')).toBe(nøgle(ALL_BILLABLE));
    expect(nøgle('non-billable')).toBe(nøgle(ALL_BILLABLE));
  });
});

describe('matchesBillable', () => {
  it('"alle" slipper alt igennem — også det der mangler', () => {
    for (const v of [true, false, null, undefined] as const)
      expect(matchesBillable(v, 'all')).toBe(true);
  });

  it('kun false er ikke-fakturerbar, præcis som badgen i rækken dømmer det', () => {
    expect(matchesBillable(true, 'non-billable')).toBe(false);
    expect(matchesBillable(false, 'non-billable')).toBe(true);
  });

  it('tæller en post uden værdi som fakturerbar, fordi rækken viser den UDEN badge', () => {
    // Kernen i det lokale filter: kolonnen er nullable i web's schema
    // (`boolean("is_billable").default(true)` uden `.notNull()`), og SQL
    // `is_billable = true` matcher ikke NULL. Havde vi sendt `true` med,
    // ville disse poster forsvinde under "Kun fakturerbare" lige under en
    // række, der viser dem som fakturerbare.
    expect(matchesBillable(null, 'billable')).toBe(true);
    expect(matchesBillable(undefined, 'billable')).toBe(true);
    expect(matchesBillable(null, 'non-billable')).toBe(false);
  });

  it('placerer hver post i præcis én af de to visninger', () => {
    // Ellers ville en post enten forsvinde fra begge filtre eller ligge i begge,
    // så de to valg ikke er et filter men en udskillelse.
    for (const v of [true, false, null, undefined] as const) {
      expect(matchesBillable(v, 'billable') !== matchesBillable(v, 'non-billable')).toBe(true);
      expect(matchesBillable(v, 'billable') || matchesBillable(v, 'non-billable')).toBe(true);
    }
  });
});

describe('applyBillableFilter', () => {
  const liste = [
    { id: 'e1', isBillable: true },
    { id: 'e2', isBillable: false },
    { id: 'e3', isBillable: null },
  ];

  it('beholder de fakturerbare og dem uden værdi', () => {
    expect(applyBillableFilter(liste, 'billable').map(e => e.id)).toEqual(['e1', 'e3']);
  });

  it('beholder kun de markerede ikke-fakturerbare', () => {
    expect(applyBillableFilter(liste, 'non-billable').map(e => e.id)).toEqual(['e2']);
  });

  it('giver en kopi i "alle"-tilstand, så memoen ikke muterer kilden', () => {
    const ud = applyBillableFilter(liste, 'all');
    expect(ud).toEqual(liste);
    expect(ud).not.toBe(liste);
  });
});

describe('hasActiveFilter', () => {
  it('er falsk i starttilstanden', () => {
    expect(hasActiveFilter(NO_FILTER)).toBe(false);
  });

  it('ser hvert filter for sig — også alene et projekt', () => {
    expect(hasActiveFilter({ ...NO_FILTER, projectId: 'p1' })).toBe(true);
    expect(hasActiveFilter({ ...NO_FILTER, billable: 'non-billable' })).toBe(true);
    expect(hasActiveFilter({ ...NO_FILTER, billed: 'billed' })).toBe(true);
  });
});

/**
 * Fakturerings-filteret er lokalt af SAMME grund som fakturerbarhed:
 * `is_billed` er `boolean("is_billed").default(false)` uden `.notNull()` i web's
 * `schema.ts`, så SQL `is_billed = false` matcher ikke NULL. Serveren har et
 * `isBilled`-filter i `time.list`, men bruges det, forsvinder en post med NULL
 * under «Kun ikke-fakturerede» — lige under en række, der viser den som
 * ikke-faktureret.
 */
describe('matchesBilled', () => {
  it('"alle" slipper alt igennem — også det der mangler', () => {
    for (const v of [true, false, null, undefined] as const)
      expect(matchesBilled(v, 'all')).toBe(true);
  });

  it('kun true er faktureret', () => {
    expect(matchesBilled(true, 'billed')).toBe(true);
    expect(matchesBilled(false, 'billed')).toBe(false);
    expect(matchesBilled(null, 'billed')).toBe(false);
    expect(matchesBilled(undefined, 'billed')).toBe(false);
  });

  it('tæller en post uden værdi som ikke-faktureret, fordi rækken viser den UDEN badge', () => {
    expect(matchesBilled(null, 'unbilled')).toBe(true);
    expect(matchesBilled(undefined, 'unbilled')).toBe(true);
    expect(matchesBilled(true, 'unbilled')).toBe(false);
  });

  it('placerer hver post i præcis én af de to visninger', () => {
    for (const v of [true, false, null, undefined] as const) {
      expect(matchesBilled(v, 'billed') !== matchesBilled(v, 'unbilled')).toBe(true);
      expect(matchesBilled(v, 'billed') || matchesBilled(v, 'unbilled')).toBe(true);
    }
  });
});

describe('applyLocalFilters', () => {
  const liste = [
    { id: 'e1', isBillable: true, isBilled: true },
    { id: 'e2', isBillable: true, isBilled: false },
    { id: 'e3', isBillable: false, isBilled: false },
    { id: 'e4', isBillable: true, isBilled: null },
  ];

  it('gennemlader alt i starttilstanden', () => {
    expect(applyLocalFilters(liste, NO_FILTER).map(e => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('finder kun de fakturerede', () => {
    expect(applyLocalFilters(liste, { ...NO_FILTER, billed: 'billed' }).map(e => e.id)).toEqual(['e1']);
  });

  it('beholder også poster uden værdi under "ikke-fakturerede"', () => {
    expect(applyLocalFilters(liste, { ...NO_FILTER, billed: 'unbilled' }).map(e => e.id)).toEqual(['e2', 'e3', 'e4']);
  });

  it('snitter de to filtre — en intern og faktureret post kan ikke findes', () => {
    // Ellers ville de to filtre være en udskillelse: en post der er både
    // intern og faktureret ville forsvinde fra begge valg.
    const filtre = applyLocalFilters(liste, { ...NO_FILTER, billable: 'billable', billed: 'unbilled' });
    expect(filtre.map(e => e.id)).toEqual(['e2', 'e4']);
    expect(filtre.every(e => matchesBillable(e.isBillable, 'billable') && matchesBilled(e.isBilled, 'unbilled'))).toBe(true);
  });

  it('lader begge filtre ude af query-inputtet', () => {
    // Bevidst lokalt: skifter query-nøglen, ville hvert filtervalg starte et
    // nyt kald og tømme listen, selv om serveren har samme data.
    const nøgle = JSON.stringify(entriesQueryInput(RANGE, { projectId: ALL_PROJECTS, billable: 'billable', billed: 'billed' }));
    expect(nøgle).toBe(JSON.stringify(entriesQueryInput(RANGE, NO_FILTER)));
  });
});

describe('filterHidesAll', () => {
  it('lader den normale tom-tilstand stå, når intet filter er valgt', () => {
    // Ellers ville en tom dag med intet filter bede brugeren rydde et filter,
    // der ikke findes, og skjule "Registrér tid".
    expect(filterHidesAll({ active: false, visible: 0, pending: 0 })).toBe(false);
  });

  it('siger det når et filter skjuler alle poster', () => {
    expect(filterHidesAll({ active: true, visible: 0, pending: 0 })).toBe(true);
  });

  it('holder tilbage når der stadig er noget at vise', () => {
    expect(filterHidesAll({ active: true, visible: 1, pending: 0 })).toBe(false);
    // Dagsvisningen viser ventende oprettelser i rækken, så de tæller med.
    expect(filterHidesAll({ active: true, visible: 0, pending: 1 })).toBe(false);
  });
});
