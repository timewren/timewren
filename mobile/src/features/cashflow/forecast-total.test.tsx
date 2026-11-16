import type { CashflowForecast } from './cashflow-logic';

import * as React from 'react';
import i18n from '~/lib/i18n';

import { cleanup, render, screen } from '~/lib/test-utils';
import { ForecastTotal } from './forecast-total';

afterEach(cleanup);

/**
 * Serverens fire mandag–søndag-vinduer fra mandag 28. september. Den bygger
 * dem i dansk lokal tid, og superjson sender dem som UTC-instanter — 22:00 UTC
 * for en dansk midnat, 21:59 UTC for en dansk sidste øjeblik.
 */
const FOUR_WEEKS: CashflowForecast['weeks'] = [
  ['2026-09-27T22:00:00.000Z', '2026-10-04T21:59:59.999Z'],
  ['2026-10-04T22:00:00.000Z', '2026-10-11T21:59:59.999Z'],
  ['2026-10-11T22:00:00.000Z', '2026-10-18T21:59:59.999Z'],
  ['2026-10-18T22:00:00.000Z', '2026-10-25T21:59:59.999Z'],
].map(([from, to], i) => ({
  weekNumber: 40 + i,
  from,
  to,
  expectedAmount: 0,
  overdueAmount: 0,
  breakdown: { invoices: [], prepaidRenewals: [] },
}));

function renderTotal(weeks: CashflowForecast['weeks']): CashflowForecast {
  const forecast: CashflowForecast = { weeks, totalExpected: 34500, totalOverdue: 0 };
  render(<ForecastTotal forecast={forecast} />);
  return forecast;
}

describe('forecastTotal', () => {
  beforeEach(() => {
    // Enhedens sprog i testen er en, men brugeren læser dansk
    void i18n.changeLanguage('da');
  });

  it('skriver de fire uger serveren sender, aldrig "30 dage"', () => {
    renderTotal(FOUR_WEEKS);
    expect(String(screen.getByTestId('cashflow-forecast-total').props.children)).toBe('34.500 kr.');
    expect(screen.getByText('Forventet næste 4 uger')).toBeTruthy();
    // 30 dage fra onsdag 30. september er 30. oktober, men serverens sidste
    // uge lukker 25. oktober — de fem dage taber `findWeek` stille.
    expect(screen.getByText('28. sep. – 25. okt.')).toBeTruthy();
    expect(screen.queryByText(/30 dage/)).toBeNull();
  });

  it('læser beløb, ugetal og daterække som ét stop for skærmlæseren', () => {
    renderTotal(FOUR_WEEKS);
    const spoken = String(screen.getByTestId('cashflow-forecast-summary').props.accessibilityLabel);
    expect(spoken).toBe('Forventet næste 4 uger, 28. sep. – 25. okt., 34.500 kr.');
  });

  it('taler om resten af ugen, når serveren kun har sendt én uge', () => {
    renderTotal(FOUR_WEEKS.slice(0, 1));
    expect(screen.getByText('Forventet resten af uge')).toBeTruthy();
    expect(screen.getByText('28. sep. – 4. okt.')).toBeTruthy();
  });
});
