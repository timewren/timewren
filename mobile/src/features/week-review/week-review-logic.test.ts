import type { WeekDay } from './week-review-logic';
import {
  barFraction,
  currentWeekStart,
  dailyGoal,
  dayLabel,
  dayReference,
  sumHours,
  thinDays,
  weekFraction,
  weekRangeLabel,
} from './week-review-logic';

function day(hours: number, isGap = false, date = '2026-09-28'): WeekDay {
  return { date, hours, isGap };
}

describe('sumHours', () => {
  it(' summerer dagenes timer', () => {
    expect(sumHours([day(7.5), day(0), day(3.25), day(0), day(0), day(0), day(0)])).toBe(10.75);
  });

  it('runder til 2 decimaler, som serveren gør', () => {
    expect(sumHours([day(1.005), day(2.005)])).toBe(3.01);
  });

  it('tolerer NaN og ugyldige værdier uden at summen bliver NaN', () => {
    expect(sumHours([day(1), { date: 'x', hours: Number.NaN, isGap: false }])).toBe(1);
    expect(sumHours([])).toBe(0);
  });
});

describe('dailyGoal', () => {
  it('fordeler ugemålet på 5 arbejdsdage', () => {
    expect(dailyGoal(37)).toBe(7.4);
    expect(dailyGoal(20)).toBe(4);
  });

  it('intet ugemål giver ingen dagsmål — ikke 0, som ville se ud som et krav', () => {
    expect(dailyGoal(null)).toBeNull();
    expect(dailyGoal(undefined)).toBeNull();
    expect(dailyGoal(0)).toBeNull();
    expect(dailyGoal(-10)).toBeNull();
    expect(dailyGoal(Number.NaN)).toBeNull();
  });
});

describe('dayReference', () => {
  it('måler mod dagsmålet når der er et ugemål', () => {
    expect(dayReference(37, [day(2), day(9)])).toBe(7.4);
  });

  it('skalerer mod ugens bedste dag når der ikke er et ugemål', () => {
    expect(dayReference(null, [day(2), day(9), day(1)])).toBe(9);
  });

  it('har et gulv, så en tom uge ikke bliver en tom bjælke', () => {
    expect(dayReference(null, [day(0), day(0)])).toBe(4);
  });
});

describe('barFraction / weekFraction', () => {
  it('bjælken fyldes efter forbrug, aldrig over 100 %', () => {
    expect(barFraction(3.7, 7.4)).toBe(0.5);
    expect(barFraction(20, 7.4)).toBe(1);
    expect(barFraction(-1, 7.4)).toBe(0);
    expect(barFraction(1, 0)).toBe(0);
    expect(barFraction(Number.NaN, 7.4)).toBe(0);
  });

  it('ugens fremdrift er delt af ugemålet og forsvinder uden et', () => {
    expect(weekFraction(18.5, 37)).toBe(0.5);
    expect(weekFraction(40, 37)).toBe(1);
    expect(weekFraction(18.5, null)).toBe(0);
  });
});

describe('thinDays', () => {
  it('samler de markerede huller', () => {
    const days = [day(7, false, 'a'), day(1, true, 'b'), day(0, false, 'c')];
    expect(thinDays(days).map(d => d.date)).toEqual(['b']);
    expect(thinDays([])).toEqual([]);
  });
});

describe('currentWeekStart', () => {
  it('søndag hører til den foregående mandag', () => {
    expect(currentWeekStart(new Date(2026, 8, 27, 23, 59))).toBe('2026-09-21');
  });

  it('mandag ved midnat er sin egen uge', () => {
    expect(currentWeekStart(new Date(2026, 8, 28, 0, 0))).toBe('2026-09-28');
  });

  it('et nyt år ugestart på sidste december', () => {
    expect(currentWeekStart(new Date(2025, 11, 30, 12))).toBe('2025-12-29');
    expect(currentWeekStart(new Date(2025, 11, 31, 12))).toBe('2025-12-29');
    expect(currentWeekStart(new Date(2026, 0, 1, 12))).toBe('2025-12-29');
  });
});

describe('weekRangeLabel / dayLabel', () => {
  it('viser mandag til søndag', () => {
    expect(weekRangeLabel('2026-09-28')).toBe('28. sep. – 4. okt.');
  });

  it('tager år med på den ende der ikke er i årstal', () => {
    expect(weekRangeLabel('2025-12-29')).toBe('29. dec. 2025 – 4. jan.');
  });

  it('dagsnavnet følger datoen, ikke rækkefølgen i arrayet', () => {
    expect(dayLabel('2026-09-28')).toBe('Man');
    expect(dayLabel('2026-10-03')).toBe('Lør');
    expect(dayLabel('2026-10-04')).toBe('Søn');
  });
});
