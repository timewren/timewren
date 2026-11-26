import i18n from '~/lib/i18n';
import {
  dayLabel,
  dayTotals,
  deltaTone,
  expectedDelta,
  formatDelta,
  getWeekStart,
  isoWeekNumber,
  isWeekEditable,
  parseHoursInput,
  shiftWeek,
  weekDays,
  weekStatusKey,
  weekStatusTone,
  weekTotal,
} from './week';

describe('week helpers', () => {
  it('getWeekStart giver mandag', () => {
    expect(getWeekStart(new Date(2026, 8, 6))).toBe('2026-08-31'); // søndag → forrige mandag
    expect(getWeekStart(new Date(2026, 8, 7))).toBe('2026-09-07'); // mandag
    expect(getWeekStart('2026-09-09')).toBe('2026-09-07');
  });

  it('shiftWeek og weekDays', () => {
    expect(shiftWeek('2026-09-07', 1)).toBe('2026-09-14');
    expect(shiftWeek('2026-09-07', -1)).toBe('2026-08-31');
    expect(weekDays('2026-09-07')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(isoWeekNumber('2026-09-07')).toBe(37);
  });

  it('parseHoursInput med decimalkomma og klokke', () => {
    expect(parseHoursInput('7,4')).toBe(7.4);
    expect(parseHoursInput('7.5')).toBe(7.5);
    expect(parseHoursInput('1:30')).toBe(1.5);
    expect(parseHoursInput('')).toBeNull();
    expect(parseHoursInput('abc')).toBeNull();
    expect(parseHoursInput('-1')).toBeNull();
    expect(parseHoursInput('30')).toBe(24);
    expect(parseHoursInput('0')).toBe(0);
    expect(parseHoursInput(',5')).toBe(0.5);
  });

  it('status → tone/nøgle/redigerbar', () => {
    expect(weekStatusTone(null)).toBe('default');
    expect(weekStatusTone('submitted')).toBe('warning');
    expect(weekStatusTone('approved')).toBe('success');
    expect(weekStatusTone('rejected')).toBe('danger');
    expect(weekStatusTone('reopened')).toBe('default');
    expect(weekStatusKey(null)).toBe('draft');
    expect(weekStatusKey('rejected')).toBe('rejected');
    expect(isWeekEditable(null)).toBe(true);
    expect(isWeekEditable('rejected')).toBe(true);
    expect(isWeekEditable('reopened')).toBe(true);
    expect(isWeekEditable('submitted')).toBe(false);
    expect(isWeekEditable('approved')).toBe(false);
    expect(isWeekEditable(null, true)).toBe(false);
  });

  it('dagstotaler og ugetotal', () => {
    const days = ['2026-09-07', '2026-09-08'];
    const rows: Array<{ days: Record<string, { total: number }> }> = [
      { days: { '2026-09-07': { total: 4 }, '2026-09-08': { total: 3.5 } } },
      { days: { '2026-09-07': { total: 2.25 } } },
    ];
    const absence = [{ days: { '2026-09-08': { hours: 3.7 } } }];
    const totals = dayTotals(days, rows, absence);
    expect(totals['2026-09-07']).toEqual({ work: 6.25, absence: 0, total: 6.25 });
    expect(totals['2026-09-08']).toEqual({ work: 3.5, absence: 3.7, total: 7.2 });
    expect(weekTotal(totals)).toBe(9.75);
  });

  it('delta mod norm', () => {
    expect(expectedDelta(38.5, 37)).toBe(1.5);
    // Jest kører på engelsk: dansk talformat, men engelsk enhed som formatHours.
    expect(formatDelta(1.5)).toBe('+1,5 h');
    expect(formatDelta(-2)).toBe('−2 h');
    expect(formatDelta(0)).toBe('0 h');
    expect(deltaTone(38.5, 37)).toBe('warning');
    expect(deltaTone(37, 37)).toBe('success');
    expect(deltaTone(30, 37)).toBe('default');
    expect(deltaTone(5, 0)).toBe('default');
  });

  it('delta på tysk bruger tysk enhed, også ved nul', async () => {
    try {
      await i18n.changeLanguage('de');
      expect(formatDelta(0)).toBe('0 Std.');
      expect(formatDelta(1.5)).toBe('+1,5 Std.');
    }
    finally {
      await i18n.changeLanguage('da');
    }
  });
});

describe('dayLabel', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('da');
  });

  const base = { today: '2026-09-09', holiday: false };

  it('siger højt når normen er nået', () => {
    expect(dayLabel({ ...base, day: '2026-09-09', total: { work: 7.5, absence: 0, total: 7.5 }, norm: 7.5 }))
      .toBe('Onsdag 9. september, I dag, 7,5 t, af 7,5 t, norm nået');
  });

  it('siger højt når normen mangler — farven på prikken må ikke være det eneste signal', () => {
    expect(dayLabel({ ...base, day: '2026-09-10', total: { work: 3, absence: 0, total: 3 }, norm: 7.5 }))
      .toBe('Torsdag 10. september, 3 t, af 7,5 t, under norm');
  });

  it('sig timer uden norm (lokal visning) og timer på en helligdag', () => {
    expect(dayLabel({ ...base, day: '2026-09-08', total: { work: 4, absence: 0, total: 4 }, norm: 0 }))
      .toBe('Tirsdag 8. september, 4 t, ikke arbejdsdag');
    expect(dayLabel({ ...base, day: '2026-09-11', total: { work: 0, absence: 0, total: 0 }, norm: 0, holiday: true }))
      .toBe('Fredag 11. september, ingen registrerede timer, Helligdag');
  });
});
