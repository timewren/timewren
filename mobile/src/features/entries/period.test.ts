import {
  dateKey,
  entriesOnDay,
  entryDateKey,
  fetchRange,
  hoursByDay,
  intensity,
  monthGrid,
  monthRange,
  parseDateKey,
  periodTitle,
  shiftPeriod,
  sumHours,
  weekDays,
  weekRange,
} from './period';

// Lørdag 5. september 2026 (lokal tid) — fast dato, aldrig "i dag"
const SAT = new Date(2026, 8, 5, 12, 0, 0);

describe('period', () => {
  it('weekRange starter mandag og slutter søndag', () => {
    const { start, end } = weekRange(SAT);
    expect(dateKey(start)).toBe('2026-08-31');
    expect(dateKey(end)).toBe('2026-09-06');
    expect(start.getDay()).toBe(1);
    expect(end.getDay()).toBe(0);
  });

  it('monthRange dækker hele måneden', () => {
    const { start, end } = monthRange(SAT);
    expect(dateKey(start)).toBe('2026-09-01');
    expect(dateKey(end)).toBe('2026-09-30');
  });

  it('fetchRange: dag og uge deler ugen, måned sin egen', () => {
    expect(fetchRange('day', SAT)).toEqual(fetchRange('week', SAT));
    expect(dateKey(fetchRange('month', SAT).start)).toBe('2026-09-01');
  });

  it('shiftPeriod flytter én periode', () => {
    expect(dateKey(shiftPeriod('day', SAT, 1))).toBe('2026-09-06');
    expect(dateKey(shiftPeriod('week', SAT, -1))).toBe('2026-08-29');
    expect(dateKey(shiftPeriod('month', SAT, 1))).toBe('2026-10-05');
    // 31. jan + 1 måned → 28. feb (date-fns klipper)
    expect(dateKey(shiftPeriod('month', new Date(2026, 0, 31), 1))).toBe('2026-02-28');
  });

  it('periodTitle på dansk', () => {
    expect(periodTitle('day', SAT)).toBe('Lørdag 5. september');
    expect(periodTitle('week', SAT)).toMatch(/^Uge 36 · 31\. aug\.–6\. sep\.$/);
    expect(periodTitle('week', new Date(2026, 8, 9))).toBe('Uge 37 · 7.–13. sep.');
    expect(periodTitle('month', SAT)).toBe('September 2026');
  });

  it('periodTitle markerer i dag', () => {
    expect(periodTitle('day', new Date())).toMatch(/^I dag · /);
  });

  it('parseDateKey er invers af dateKey', () => {
    expect(dateKey(parseDateKey('2026-09-06'))).toBe('2026-09-06');
  });

  it('entryDateKey bruger UTC-dato for midnats-poster og lokal dato ellers', () => {
    // Backendens `new Date('2026-09-06')` → UTC-midnat, uanset lokal tidszone
    expect(entryDateKey(new Date('2026-09-06'))).toBe('2026-09-06');
    expect(entryDateKey('2026-09-06T00:00:00.000Z')).toBe('2026-09-06');
    const local = new Date(2026, 8, 6, 23, 30);
    expect(entryDateKey(local)).toBe('2026-09-06');
  });

  it('hoursByDay og sumHours aggregerer strenge og tal', () => {
    const entries = [
      { date: new Date('2026-09-01'), hours: '1.5' },
      { date: new Date('2026-09-01'), hours: 2 },
      { date: new Date('2026-09-02'), hours: '0.25' },
      { date: new Date('2026-09-03'), hours: 'nan' },
    ];
    const map = hoursByDay(entries);
    expect(map.get('2026-09-01')).toBe(3.5);
    expect(map.get('2026-09-02')).toBe(0.25);
    expect(map.get('2026-09-03')).toBe(0);
    expect(sumHours(entries)).toBe(3.75);
  });

  it('entriesOnDay filtrerer på dagsnøgle', () => {
    const entries = [
      { id: 'a', date: new Date('2026-09-05'), hours: 1 },
      { id: 'b', date: new Date('2026-09-04'), hours: 1 },
    ];
    expect(entriesOnDay(entries, SAT).map(e => e.id)).toEqual(['a']);
  });

  it('weekDays giver 7 dage fra mandag', () => {
    const days = weekDays(SAT).map(dateKey);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-08-31');
    expect(days[6]).toBe('2026-09-06');
  });

  it('monthGrid: hele uger, mandag først, markerer måneden', () => {
    const grid = monthGrid(SAT);
    expect(grid).toHaveLength(5);
    expect(dateKey(grid[0]![0]!.date)).toBe('2026-08-31');
    expect(grid[0]![0]!.inMonth).toBe(false);
    expect(grid[0]![1]!.inMonth).toBe(true);
    expect(dateKey(grid[4]![6]!.date)).toBe('2026-10-04');
    for (const row of grid)
      expect(row).toHaveLength(7);
  });

  it('intensity trin', () => {
    expect(intensity(0)).toBe(0);
    expect(intensity(1)).toBe(1);
    expect(intensity(3)).toBe(2);
    expect(intensity(5)).toBe(3);
    expect(intensity(8)).toBe(4);
  });
});
