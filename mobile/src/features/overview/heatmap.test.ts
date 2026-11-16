import { buildHeatmapWeeks, heatLevel, heatWeekSummary } from './heatmap';

describe('heatLevel', () => {
  it('0 uden timer eller uden maksimum', () => {
    expect(heatLevel(0, 8)).toBe(0);
    expect(heatLevel(3, 0)).toBe(0);
  });
  it('fire trin fordelt på kvartiler', () => {
    expect(heatLevel(2, 8)).toBe(1);
    expect(heatLevel(4, 8)).toBe(2);
    expect(heatLevel(6, 8)).toBe(3);
    expect(heatLevel(8, 8)).toBe(4);
  });
});

describe('buildHeatmapWeeks', () => {
  // Onsdag 9. september 2026
  const now = new Date(2026, 8, 9, 12);

  it('bygger 5 uger à 7 dage der slutter i indeværende uge', () => {
    const grid = buildHeatmapWeeks([], now);
    expect(grid).toHaveLength(5);
    expect(grid.every(w => w.length === 7)).toBe(true);
    expect(grid[0]![0]!.date).toBe('2026-08-10');
    expect(grid[4]![0]!.date).toBe('2026-09-07');
    expect(grid[4]![6]!.date).toBe('2026-09-13');
  });

  it('mapper timer ind på rette dag og markerer fremtid', () => {
    const grid = buildHeatmapWeeks([
      { date: '2026-09-08', hours: 8 },
      { date: '2026-09-09', hours: 2 },
      { date: '2026-01-01', hours: 99 }, // uden for vinduet
    ], now);
    const week = grid[4]!;
    expect(week[1]!.hours).toBe(8);
    expect(week[1]!.level).toBe(4);
    expect(week[2]!.level).toBe(1);
    expect(week[2]!.isFuture).toBe(false);
    expect(week[3]!.isFuture).toBe(true);
    expect(week[3]!.level).toBe(0);
  });

  it('respekterer antal uger', () => {
    expect(buildHeatmapWeeks([], now, 2)).toHaveLength(2);
  });
});

describe('heatWeekSummary', () => {
  // Onsdag 9. september 2026 — den indeværende uge er 7.–13. september
  const now = new Date(2026, 8, 9, 12);

  function weekWith(days: { date: string; hours: number }[], index = 4) {
    return buildHeatmapWeeks(days, now)[index]!;
  }

  it('tæller dage og timer i ugen', () => {
    const summary = heatWeekSummary(weekWith([
      { date: '2026-09-07', hours: 7.5 },
      { date: '2026-09-08', hours: 2 },
      { date: '2026-09-09', hours: 6 },
    ]));
    expect(summary.days).toBe(3);
    expect(summary.hours).toBe(15.5);
    expect(summary.range).toBe('7. sep. – 13. sep.');
  });

  it('tæller ikke dage der endnu ikke er nået', () => {
    // 10.–13. september er fremtid, når "nu" er 9. september
    const summary = heatWeekSummary(weekWith([
      { date: '2026-09-09', hours: 4 },
      { date: '2026-09-10', hours: 8 },
      { date: '2026-09-11', hours: 8 },
    ]));
    expect(summary.days).toBe(1);
    expect(summary.hours).toBe(4);
  });

  it('skriver én dato, når ugen kun dækker en dag', () => {
    expect(heatWeekSummary(buildHeatmapWeeks([], now, 1)[0]!.slice(0, 1)).range).toBe('7. sep.');
  });

  it('tolererer en uge uden læsbare datoer og urøde tal', () => {
    const summary = heatWeekSummary([
      { date: '2026-13-45', hours: Number.NaN, level: 0, isFuture: false },
      { date: '', hours: -3, level: 0, isFuture: false },
    ]);
    expect(summary).toEqual({ days: 0, hours: 0, range: '' });
    expect(heatWeekSummary([]).range).toBe('');
  });

  it('runder summeringen, så flydende tal ikke læses som 15.500000000000002', () => {
    const summary = heatWeekSummary(weekWith([
      { date: '2026-09-07', hours: 0.1 },
      { date: '2026-09-08', hours: 0.2 },
    ]));
    expect(summary.hours).toBe(0.3);
  });
});
