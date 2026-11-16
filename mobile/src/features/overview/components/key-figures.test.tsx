import * as React from 'react';
import i18n from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';
import { KeyFigures } from './key-figures';

const mockProfit = jest.fn();
const mockMonthlyRevenue = jest.fn();
const mockUnbilled = jest.fn();
const mockProjectCount = jest.fn();

jest.mock('~/lib/api', () => ({
  // `SectionState` bruger `errorMessage` fra samme modul. Den hentes fra
  // `trpc.ts` og ikke fra `~/lib/api`: barrelen trækker `provider.tsx` med sig,
  // og den importerer `@dev-plugins/react-query`, som er ESM og ikke er
  // transformeret i jest.
  errorMessage: (error: unknown) => jest.requireActual('~/lib/api/trpc').errorMessage(error),
  trpc: {
    time: {
      getProfitability: { useQuery: () => mockProfit() },
      monthlyRevenue: { useQuery: () => mockMonthlyRevenue() },
      unbilledStats: { useQuery: () => mockUnbilled() },
    },
    projects: { count: { useQuery: () => mockProjectCount() } },
  },
}));

jest.mock('~/features/capabilities/use-capabilities', () => ({
  useCapabilities: () => ({ isEnterprise: false, isEnabled: () => true }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

/** Et kald der lykkes med `data`. */
function ok(data: unknown) {
  return { data, isLoading: false, isError: false, error: null, refetch: jest.fn() };
}

/** Et kald der fejler. `data` er bevidst `undefined` — serveren svarede ikke. */
function fejler() {
  return { data: undefined, isLoading: false, isError: true, error: new Error('Serveren svarer 500'), refetch: jest.fn() };
}

/** Et kald der er i gang: ingen data, ingen fejl. */
function laver() {
  return { data: undefined, isLoading: true, isError: false, error: null, refetch: jest.fn() };
}

/**
 * Den ægte oversigtssum: 7,5 t hvoraf 2,5 t fakturerbart, til 800 kr. pr. time.
 * De afledte tal (billableShare → 33 %, estimateRevenue → 2.000 kr.) er dem
 * porten skal holde ude, når et kald fejler — de ligner rigtige data.
 */
const RIGTIG = { totalHours: 7.5, billableHours: 2.5, agreedRate: 800 };

/**
 * `StatTile` pakker etiket, værdi og hint i et view med
 * `accessibilityElementsHidden`, fordi kortet er ét stop. RNTL springer skjulte
 * elementer over ved opslag, så UDEN denne skjulte alle tal være usynlige for
 * læseren — og hver `queryByText('0 …')` ville være grøn fordi den intet fandt.
 * Det var den fælde første udkast af denne test faldt i: tre grønne
 * «der står ingen falske tal»-påstande, der ikke kunne fejle.
 */
const SKJULT = { includeHiddenElements: true } as const;

function findTekst(tekst: string) {
  return screen.queryByText(tekst, SKJULT);
}

/** Hvad kortet siger til skærmlæseren — det er det en blind bruger hører. */
function findLabel(mønster: RegExp) {
  return screen.queryByLabelText(mønster, SKJULT);
}

function renderKeyFigures(period: 'week' | 'month' | 'year' = 'month') {
  render(<KeyFigures period={period} />);
}

beforeEach(async () => {
  // Enhedens sprog i testen er en, men brugeren læser dansk
  await i18n.changeLanguage('da');
  mockProfit.mockReturnValue(ok(RIGTIG));
  mockMonthlyRevenue.mockReturnValue(ok(12_000));
  mockUnbilled.mockReturnValue(ok({ value: 4_000, hours: 6, count: 3 }));
  mockProjectCount.mockReturnValue(ok(5));
});

/** Evalueres sent: modul-hoisted `i18n.t` fangede engelsk, før `changeLanguage`. */
function fejlVærdi() {
  return i18n.t('common.error_value');
}

describe('nøgletallene på overblikket', () => {
  it('viser de rigtige tal, når alle kalde lykkes', () => {
    renderKeyFigures();

    expect(screen.getByText('7,5 t', SKJULT)).toBeTruthy();
    expect(screen.getByText('2,5 t', SKJULT)).toBeTruthy();
    expect(screen.getByText('12.000 kr.', SKJULT)).toBeTruthy();
    expect(screen.getByText('4.000 kr.', SKJULT)).toBeTruthy();
    expect(findLabel(/^Ufaktureret/)).toBeTruthy();
    expect(screen.getByLabelText('Ufaktureret, 4.000 kr., 6 t · 3 registreringer')).toBeTruthy();
    expect(findTekst(fejlVærdi())).toBeNull();
  });

  /**
   * R5 (30/9) rettede ni regioner, og `stat-tile-error.test.ts` dømmer det ved at
   * læse kilderne: kalder skal have `error=` eller sidde under en `ErrorState`.
   * Det er den rigtige regel — men den ser ikke *hvad der males*. Her fejler
   * hele profit-kallet, og `SectionState` skal erstatte alle fem kort med ÉN
   * fejl. Uden `isError` på `SectionState` ville skærmen vise `0 t` for timer
   * og `0 kr.` for omsætning: tal der ligner en rigtig måned, hvor brugeren
   * ingen har indtastet.
   */
  it('viser ingen tal, når kallet bag alle nøgletallene fejler', () => {
    mockProfit.mockReturnValue(fejler());

    renderKeyFigures();

    expect(screen.getByText(i18n.t('common.error_generic'))).toBeTruthy();
    // Ikke én eneste null — det er den dyreste løgn i appen
    expect(findTekst('0 t')).toBeNull();
    expect(findTekst('0 kr.')).toBeNull();
    expect(findTekst('7,5 t')).toBeNull();
    expect(findTekst('12.000 kr.')).toBeNull();
    expect(findLabel(/^Timer,/)).toBeNull();
  });
});

/**
 * `unbilled` læses seks steder i samme komponent: beløb, timer, antal, tone,
 * indlæsning og fejl. Kildeporten dømmer dem én ad gang, så den kan ikke se at
 * kun nogle af dem er dækket af fejlen — og så står både `0 kr.` og
 * `0 t · 0 registreringer` under et kort der ellers ligner rigtigt. Det er
 * præcis den fejlform revieweren 29/9 skrev ned: «Ingen af dem ser, at ét kald
 * læses to steder.»
 */
describe('ét kald læst flere steder', () => {
  it('skjuler beløb OG hint, når ufaktureret-tallet fejler', () => {
    mockUnbilled.mockReturnValue(fejler());

    renderKeyFigures();

    expect(findTekst('0 kr.')).toBeNull();
    expect(findTekst('0 t · 0 registreringer')).toBeNull();
    // Skærmlæseren hører fejlen, ikke nullen
    expect(screen.getByLabelText(`Ufaktureret, ${fejlVærdi()}`)).toBeTruthy();
  });

  it('lader de øvrige kort stå med deres egne tal — én fejl sletter ikke hele skærmen', () => {
    mockUnbilled.mockReturnValue(fejler());

    renderKeyFigures();

    expect(screen.getByText('7,5 t', SKJULT)).toBeTruthy();
    expect(screen.getByText('12.000 kr.', SKJULT)).toBeTruthy();
  });

  it('viser hverken 0 eller hinten, når projekttallet fejler', () => {
    mockProjectCount.mockReturnValue(fejler());

    renderKeyFigures();

    expect(findTekst('5')).toBeNull();
    expect(findTekst('0')).toBeNull();
    expect(screen.getByLabelText(`Aktive projekter, ${fejlVærdi()}`)).toBeTruthy();
  });
});

/**
 * På en måned kommer omsætningen fra sit eget kald, og `estimateRevenue` er
 * kun en *tilfældighed* fra timepris og fakturerbare timer. Kortet bærer derfor
 * intet "anslået"-mærke på en måned, så et fejlet måneds-kald må ikke falde
 * tilbage på estimatet — det er en påstand om penge uden kilde. Kilden siger
 * det samme i en kommentar, og her bliver kommentaren til en kørende dom:
 * fjernes `error={monthlyRevenue.isError && …}`, læser brugeren `2.000 kr.` som
 * sin virkelige omsætning.
 */
describe('omsætningen på en måned', () => {
  it('sager, at tallet ikke kom, i stedet for at vise estimatet som var det rigtige', () => {
    mockMonthlyRevenue.mockReturnValue(fejler());

    renderKeyFigures('month');

    // estimateRevenue(2.5, 800) = 2.000 kr. — må ikke stå som omsætning
    expect(findTekst('2.000 kr.')).toBeNull();
    expect(findTekst(i18n.t('overview.revenue_estimated'))).toBeNull();
    expect(screen.getByLabelText(`Omsætning, ${fejlVærdi()}`)).toBeTruthy();
  });

  it('mærker gerne estimatet på en uge, hvor det er hvad kortet viser', () => {
    mockMonthlyRevenue.mockReturnValue(fejler());

    renderKeyFigures('week');

    // Ugen bruger estimatet med et mærke, så det er ikke en løgn
    expect(screen.getByText('2.000 kr.', SKJULT)).toBeTruthy();
    expect(screen.getByText(i18n.t('overview.revenue_estimated'), SKJULT)).toBeTruthy();
  });

  /**
   * Samme fejl som ovenfor, men for en anden grund: kallet er ikke *fejlet*,
   * det er endnu ikke svaret. `estimateRevenue` faldt ind som erstatning, fordi
   * `monthlyRevenue.data` stadig var `null` — så brugeren læste sit estimat som
   * månedens omsætning, uden mærke, fordi en måned ikke bærer "anslået".
   * Derfor skal kortet stå i sinSkeleton, indtil serveren har svaret.
   */
  it('lader ikke estimatet stå som månedens omsætning, mens kallet er på vej', () => {
    mockMonthlyRevenue.mockReturnValue(laver());

    renderKeyFigures('month');

    expect(findTekst('2.000 kr.')).toBeNull();
    expect(findLabel(/^Omsætning,/)).toBeNull();
    // Kortet siger kun sit navn — ingen læst værdi, ingen "anslået"
    expect(screen.getByLabelText('Omsætning')).toBeTruthy();
  });
});
