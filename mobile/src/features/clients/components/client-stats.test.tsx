import * as React from 'react';
import i18n from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';
import { ClientStats } from './client-stats';

/**
 * `StatTile` pakker etiket, værdi og hint i et view med
 * `accessibilityElementsHidden`, fordi kortet er ét stop. RNTL springer skjulte
 * elementer over ved opslag, så UDEN denne skjulte alle tal være usynlige for
 * læseren — og hver `queryByText('0 t')` ville være grøn fordi den intet fandt.
 */
const SKJULT = { includeHiddenElements: true } as const;

const KUNDE = { id: 'c1', name: 'Rungsted', defaultHourlyRate: '850' } as unknown as React.ComponentProps<typeof ClientStats>['client'];

const TAL = {
  totalHours: 12.5,
  unbilledHours: 3,
  unbilledAmount: 2550,
} as unknown as React.ComponentProps<typeof ClientStats>['stats'];

beforeEach(async () => {
  // Enhedens sprog i testen er en, men brugeren læser dansk
  await i18n.changeLanguage('da');
});

afterEach(cleanup);

function renderStats(props: Partial<React.ComponentProps<typeof ClientStats>> = {}) {
  render(<ClientStats client={KUNDE} stats={TAL} isLoading={false} isError={false} onRetry={jest.fn()} {...props} />);
}

describe('nøgletallene på kunden', () => {
  it('viser de rigtige tal, når kallet svarer', () => {
    renderStats();

    expect(screen.getByText('12,5 t', SKJULT)).toBeTruthy();
    expect(screen.getByText('3 t', SKJULT)).toBeTruthy();
    expect(screen.getByText('2.550 kr.', SKJULT)).toBeTruthy();
    expect(screen.getByText('850 kr.', SKJULT)).toBeTruthy();
  });

  /**
   * R5 rettede det *fejlede* kald på denne skærm. Men `stats` er også
   * `undefined` mens det første kald er i gang, og `?? 0` giver de samme tal
   * uden nogen fejl: en kunde med 12,5 t så ud til at have 0 t, indtil
   * svaret kom. På en skærm der bruges til fakturering er det et tal, brugeren
   * ikke kan bruge — og skærmlæseren læser det højt.
   */
  it('viser ingen nul, mens kallet er i gang', () => {
    renderStats({ stats: undefined, isLoading: true });

    expect(screen.queryByText('12,5 t', SKJULT)).toBeNull();
    expect(screen.queryByText('3 t', SKJULT)).toBeNull();
    expect(screen.queryByText('2.550 kr.', SKJULT)).toBeNull();
    // Ikke ét eneste falsk nul fra det kald, der ikke har svaret endnu
    expect(screen.queryByText('0 t', SKJULT)).toBeNull();
    expect(screen.queryByText('0 kr.', SKJULT)).toBeNull();
    expect(screen.queryByLabelText(/0 t/, SKJULT)).toBeNull();
    expect(screen.queryByLabelText(/\b0 kr\./, SKJULT)).toBeNull();
    // Timesatsen kommer fra kunden, ikke fra kallet, så den skal stadig stå
    expect(screen.getByText('850 kr.', SKJULT)).toBeTruthy();
  });

  it('siger hvad der gik galt, når kallet fejler', () => {
    renderStats({ stats: undefined, isError: true, errorMessage: 'Serveren svarer 500' });

    expect(screen.getByText('Serveren svarer 500')).toBeTruthy();
    expect(screen.queryByText('0 t', SKJULT)).toBeNull();
    expect(screen.queryByText('850 kr.', SKJULT)).toBeNull();
  });
});
