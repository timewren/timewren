import {
  barPercent,
  billableHours,
  buildReportConfig,
  groupEntries,
  hasMemberData,
  periodToFilters,
} from './report-logic';

const NOW = new Date(2026, 8, 6, 12); // søndag 6. sep. 2026

function entry(over: Partial<Parameters<typeof groupEntries>[0][number]> = {}) {
  return {
    hours: '1',
    _rounded: 1,
    _value: 800,
    isBilled: false,
    billableRate: '800',
    client: null,
    project: null,
    member: null,
    ...over,
  };
}

describe('report-logic', () => {
  it('denne uge → custom mandag–søndag', () => {
    expect(periodToFilters({ period: 'thisWeek' }, NOW)).toEqual({
      dateRange: 'custom',
      customStart: '2026-08-31',
      customEnd: '2026-09-06',
    });
  });

  it('backend-perioder sendes uændret', () => {
    expect(periodToFilters({ period: 'thisMonth' }, NOW)).toEqual({ dateRange: 'thisMonth' });
    expect(periodToFilters({ period: 'thisQuarter' }, NOW)).toEqual({ dateRange: 'thisQuarter' });
  });

  it('egen periode kræver gyldige datoer i rækkefølge', () => {
    expect(periodToFilters({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-31' }, NOW))
      .toEqual({ dateRange: 'custom', customStart: '2026-01-01', customEnd: '2026-01-31' });
    expect(periodToFilters({ period: 'custom', customStart: '2026-02-01', customEnd: '2026-01-31' }, NOW)).toBeNull();
    expect(periodToFilters({ period: 'custom', customStart: 'x' }, NOW)).toBeNull();
    expect(buildReportConfig({ period: 'custom' }, NOW)).toBeNull();
  });

  it('buildReportConfig giver et komplet config-objekt', () => {
    const cfg = buildReportConfig({ period: 'thisYear' }, NOW);
    expect(cfg?.filters?.dateRange).toBe('thisYear');
    expect(cfg?.grouping).toBe('none');
    expect(cfg?.columns.length).toBeGreaterThan(0);
  });

  it('grupperer pr. kunde (via projekt når posten ingen kunde har)', () => {
    const acme = { id: 'c1', name: 'Acme' };
    const bars = groupEntries([
      entry({ client: acme, _rounded: 2, _value: 1600 }),
      entry({ project: { id: 'p1', name: 'Web', client: acme }, _rounded: 1, _value: 800 }),
      entry({ _rounded: 0.5, _value: 0 }),
    ], 'client', '(Ingen kunde)');
    expect(bars).toEqual([
      { key: 'c1', label: 'Acme', hours: 3, revenue: 2400 },
      { key: '_none', label: '(Ingen kunde)', hours: 0.5, revenue: 0 },
    ]);
  });

  it('grupperer pr. medlem og opdager team-data', () => {
    const es = [entry({ member: { userId: 'u1', name: 'Mette' } }), entry()];
    expect(hasMemberData(es)).toBe(true);
    expect(hasMemberData([entry()])).toBe(false);
    expect(groupEntries(es, 'member', 'Ukendt').map(b => b.label)).toEqual(['Mette', 'Ukendt']);
  });

  it('barPercent', () => {
    expect(barPercent(50, 100)).toBe(50);
    expect(barPercent(100, 100)).toBe(100);
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(10, 0)).toBe(0);
    expect(barPercent(1, 3)).toBe(33);
  });

  it('fakturerbare timer = sats > 0', () => {
    expect(billableHours([entry({ _rounded: 2 }), entry({ billableRate: null, _rounded: 5 }), entry({ billableRate: '0', _rounded: 1 })])).toBe(2);
  });
});
