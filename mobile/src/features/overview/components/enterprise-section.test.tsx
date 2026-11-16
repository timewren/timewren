import * as React from 'react';
import i18n from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';
import { EnterpriseSection } from './enterprise-section';

const mockFlex = jest.fn();
const mockVacation = jest.fn();
const mockOvertime = jest.fn();
const mockTimesheet = jest.fn();

jest.mock('~/lib/api', () => ({
  // `SectionState` bruger `errorMessage` fra samme modul. Den hentes fra
  // `trpc.ts` og ikke fra `~/lib/api`: barrelen trækker `provider.tsx` med sig,
  // og den importerer `@dev-plugins/react-query`, som er ESM og ikke er
  // transformeret i jest.
  errorMessage: (error: unknown) => jest.requireActual('~/lib/api/trpc').errorMessage(error),
  trpc: {
    enterprise: {
      getBalance: { useQuery: () => mockFlex() },
      getVacationBalance: { useQuery: () => mockVacation() },
      getMyOvertime: { useQuery: () => mockOvertime() },
      getTimesheetWeek: { useQuery: () => mockTimesheet() },
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

/**
 * `StatTile` pakker etiket, værdi og hint i et view med
 * `accessibilityElementsHidden`, fordi kortet er ét stop. RNTL springer skjulte
 * elementer over ved opslag, så UDEN denne skjulte alle tal være usynlige for
 * læseren — og hver `queryByText('0 t')` ville være grøn fordi den intet fandt.
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
  mockFlex.mockReturnValue(ok({ balance: 12 }));
  mockVacation.mockReturnValue(ok([{ remaining: 10, periodLabel: '2026' }]));
  mockOvertime.mockReturnValue(ok({ balance: -3, entries: [] }));
  mockTimesheet.mockReturnValue(ok({ weekStatus: 'approved', weeklyHours: 37 }));
});

describe('ansættelses-sektionen på overblikket', () => {
  it('viser de rigtige tal, når alle fire kalde svarer', () => {
    render(<EnterpriseSection />);

    // Flexsaldoen får et plus ved positiv saldo, så tallet er "+12 t"
    expect(findTekst('+12 t')).toBeTruthy();
    expect(findTekst('10 dage')).toBeTruthy();
    expect(findTekst('-3 t')).toBeTruthy();
    expect(findTekst('Godkendt')).toBeTruthy();
    expect(findTekst('37 t')).toBeTruthy();
  });

  /**
   * `SectionState` venter på flex og ferie, men de to nederste kort er hvert
   * deres kald. Uden `loading` stod de med `0 t` for overtid — en saldo der
   * ligner rigtige data — og med `Kladde` for timesedlen, fordi
   * `timesheetStatus(undefined)` svarer `draft`. Det er en *påstand* om
   * brugerens egen uge, lænet op på et svar der ikke kom.
   */
  it('viser ingen 0 timer og ingen status, mens de to kald er på vej', () => {
    mockOvertime.mockReturnValue(laver());
    mockTimesheet.mockReturnValue(laver());

    render(<EnterpriseSection />);

    // Flex og ferie kom fra deres kald og må stå
    expect(findTekst('+12 t')).toBeTruthy();
    expect(findTekst('10 dage')).toBeTruthy();
    expect(findTekst('0 t')).toBeNull();
    expect(findTekst('Kladde')).toBeNull();
    expect(findTekst('-3 t')).toBeNull();
    expect(findTekst('Godkendt')).toBeNull();
    expect(findLabel(/^Overtid,/)).toBeNull();
    expect(findLabel(/^Timeseddel,/)).toBeNull();
    // Skærmlæseren hører kun kortenes navne, mens værdierne er på vej
    expect(screen.getByLabelText('Overtid')).toBeTruthy();
    expect(screen.getByLabelText('Timeseddel')).toBeTruthy();
  });

  it('viser overtid og timeseddel, så snart deres kalde svarer', () => {
    mockOvertime.mockReturnValue(laver());
    mockTimesheet.mockReturnValue(laver());

    render(<EnterpriseSection />);

    expect(findLabel(/^Overtid,/)).toBeNull();

    mockOvertime.mockReturnValue(ok({ balance: -3, entries: [] }));
    mockTimesheet.mockReturnValue(ok({ weekStatus: 'approved', weeklyHours: 37 }));

    screen.rerender(<EnterpriseSection />);

    expect(findTekst('-3 t')).toBeTruthy();
    expect(findTekst('Godkendt')).toBeTruthy();
  });
});
