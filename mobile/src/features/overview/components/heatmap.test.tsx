import * as React from 'react';
import i18n from '~/lib/i18n';

import { cleanup, render, screen } from '~/lib/test-utils';
import { Heatmap } from './heatmap';

const mockQuery = jest.fn();

jest.mock('~/lib/api', () => ({
  // tRPC-procedurens navn, ikke en hook
  trpc: { time: { productivityHeatmap: { useQuery: () => mockQuery() } } },
}));

afterEach(cleanup);

type HeatDay = { date: string; hours: number };

function renderHeatmap(heatmapData: HeatDay[] = []) {
  mockQuery.mockReturnValue({
    data: { heatmapData, currentStreak: 2, weeklyAverage: 30 },
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  });
  render(<Heatmap />);
}

function weekLabels(): string[] {
  return screen.getAllByTestId(/^heatmap-week-/).map(el => String(el.props.accessibilityLabel));
}

describe('heatmap', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Onsdag 9. september 2026 — den indeværende uge er 7.–13. september
    jest.setSystemTime(new Date(2026, 8, 9, 12));
    // Enhedens sprog i testen er en, men brugeren læser dansk
    void i18n.changeLanguage('da');
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('læser hver uge som ét stop med datoer, dage og timer', () => {
    renderHeatmap([
      { date: '2026-09-07', hours: 7.5 },
      { date: '2026-09-08', hours: 2 },
      { date: '2026-09-09', hours: 6 },
    ]);
    // 35 celler var 35 fokusstop — nu er der ét pr. uge
    expect(screen.getAllByTestId(/^heatmap-week-/)).toHaveLength(5);
    expect(weekLabels().at(-1)).toBe('7. sep. – 13. sep., 3 dage, 15,5 t');
  });

  it('tæller kun dage der er nået', () => {
    renderHeatmap([
      { date: '2026-09-09', hours: 4 },
      { date: '2026-09-10', hours: 8 },
    ]);
    expect(weekLabels().at(-1)).toBe('7. sep. – 13. sep., 1 dag, 4 t');
  });

  it('sager, når en uge ikke har registreret tid', () => {
    renderHeatmap([{ date: '2026-09-07', hours: 6 }]);
    expect(weekLabels().at(0)).toBe('10. aug. – 16. aug., Ingen registreret tid');
  });

  it('gør cellerne til dele af ugen, ikke deres egne stop', () => {
    renderHeatmap([{ date: '2026-09-07', hours: 6 }]);
    const cell = screen.getByTestId('heatmap-cell-2026-09-07', { includeHiddenElements: true });
    expect(cell).toHaveProp('accessible', false);
    // Ellers svæver der 35 "2026-09-07: 6 t"-stop oveni uge-labelerne
    expect(cell.props.accessibilityLabel).toBeUndefined();
  });

  it('læser dageinddelingen én gang', () => {
    renderHeatmap();
    expect(screen.getByTestId('heatmap-axis')).toHaveProp('accessibilityLabel', 'Mandag til søndag');
    // De syv bogstaver er en del af aksen, ikke syv stop
    expect(screen.getByTestId('heatmap-axis-indhold', { includeHiddenElements: true })).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
  });
});
