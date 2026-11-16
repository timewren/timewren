import * as React from 'react';
import i18n from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';
import { KlippekortSection } from './klippekort-section';

const mockPackages = jest.fn();
const mockExpiring = jest.fn();
const mockLow = jest.fn();

jest.mock('~/lib/api', () => ({
  // `SectionState` bruger `errorMessage` fra samme modul. Den hentes fra
  // `trpc.ts` og ikke fra `~/lib/api`: barrelen trækker `provider.tsx` med sig,
  // og den importerer `@dev-plugins/react-query`, som er ESM og ikke er
  // transformeret i jest.
  errorMessage: (error: unknown) => jest.requireActual('~/lib/api/trpc').errorMessage(error),
  trpc: {
    prepaid: {
      list: { useQuery: () => mockPackages() },
      getExpiring: { useQuery: () => mockExpiring() },
      getLowBalance: { useQuery: () => mockLow() },
    },
  },
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

function ok(data: unknown) {
  return { data, isLoading: false, isError: false, error: null, refetch: jest.fn() };
}

function laver() {
  return { data: undefined, isLoading: true, isError: false, error: null, refetch: jest.fn() };
}

/** To aktive pakker: 10 t og 4 t tilbage. */
const PAKKER = [{ remainingHours: '10' }, { remainingHours: '4' }];

/**
 * `StatTile` pakker etiket, værdi og hint i et view med
 * `accessibilityElementsHidden`, fordi kortet er ét stop. RNTL springer skjulte
 * elementer over ved opslag, så UDEN denne skjulte alle tal være usynlige for
 * læseren — og hver `queryByText('0')` ville være grøn fordi den intet fandt.
 */
const SKJULT = { includeHiddenElements: true } as const;

function findTekst(tekst: string) {
  return screen.queryByText(tekst, SKJULT);
}

/** Hvad kortet siger til skærmlæseren — det er det en blind bruger hører. */
function findLabel(mønster: RegExp) {
  return screen.queryByLabelText(mønster, SKJULT);
}

beforeEach(async () => {
  // Enhedens sprog i testen er en, men brugeren læser dansk
  await i18n.changeLanguage('da');
  mockPackages.mockReturnValue(ok(PAKKER));
  mockExpiring.mockReturnValue(ok([{ id: 'a' }]));
  mockLow.mockReturnValue(ok([{ id: 'b' }]));
});

describe('klippekort-sektionen på overblikket', () => {
  it('viser de rigtige tal, når alle tre kalde svarer', () => {
    render(<KlippekortSection />);

    expect(findTekst('14 t')).toBeTruthy();
    expect(findTekst('2 aktive pakker')).toBeTruthy();
    expect(findTekst('1 pakker inden 30 dage')).toBeTruthy();
    expect(findTekst('1 pakker under 5 t')).toBeTruthy();
  });

  /**
   * Sektionens `SectionState` venter kun på `packages`. De to advarselskort er
   * hvert deres kald, så mens de er på vej stod de med `0` — og en `0` her er
   * den farligste løgn på skærmen: den siger "ingenting udløber, intet er lavt"
   * om et svar, der ikke kom.
   */
  it('viser ingen 0 for de advarselskort, hvis kald er på vej', () => {
    mockExpiring.mockReturnValue(laver());
    mockLow.mockReturnValue(laver());

    render(<KlippekortSection />);

    // Saldoen kom fra sit kald og må stå
    expect(findTekst('14 t')).toBeTruthy();
    expect(findLabel(/^Udløber snart,/)).toBeNull();
    expect(findLabel(/^Lav saldo,/)).toBeNull();
    expect(findTekst('0 pakker inden 30 dage')).toBeNull();
    expect(findTekst('0 pakker under 5 t')).toBeNull();
    // Skærmlæseren hører kun kortets navn, mens værdien er på vej
    expect(screen.getByLabelText('Udløber snart')).toBeTruthy();
    expect(screen.getByLabelText('Lav saldo')).toBeTruthy();
  });

  it('viser advarselskortene, så snart deres kald svarer', () => {
    mockExpiring.mockReturnValue(laver());
    mockLow.mockReturnValue(ok([{ id: 'b' }]));

    render(<KlippekortSection />);

    expect(findLabel(/^Udløber snart,/)).toBeNull();
    expect(screen.getByLabelText('Lav saldo, 1, 1 pakker under 5 t')).toBeTruthy();
  });
});
