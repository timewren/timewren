import type { WasteLog, WasteUser } from './waste-logic';
import {
  canGoForward,
  formatGapHours,
  isUnreadable,
  pauseCountKey,
  periodRange,
  rangeLabel,
  rankedUsers,
  toHours,
} from './waste-logic';

/** En tirsdag i september 2026. */
const TUE = new Date('2026-09-22T10:00:00');

function user(over: Partial<WasteUser> = {}): WasteUser {
  return { userId: 'u1', userName: 'Mads', gapMinutes: 0, gapCount: 0, untimedEntries: 0, days: [], ...over };
}

function log(over: Partial<WasteLog> = {}): WasteLog {
  return {
    minGapMinutes: 15,
    rows: [],
    byUser: [],
    byDay: [],
    totals: { gapMinutes: 0, gapCount: 0, untimedEntries: 0 },
    ...over,
  } as WasteLog;
}

describe('periodRange', () => {
  it('denne uge er mandag til søndag', () => {
    expect(periodRange('this_week', TUE)).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });

  it('forrige uge slutter dagen før denne mandag — ingen overlap', () => {
    expect(periodRange('last_week', TUE)).toEqual({ from: '2026-09-14', to: '2026-09-20' });
  });

  it('denne måned dækker hele kalendermåneden, også fra dag 1', () => {
    expect(periodRange('this_month', new Date('2026-09-01T08:00:00'))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('sidste måned er den foregående kalendermåned, ikke de seneste 30 dage', () => {
    // 31. januar 2026: "sidste måned" må ikke blive en del af februar.
    expect(periodRange('last_month', new Date('2026-01-31T08:00:00'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('canGoForward', () => {
  it('kun den aktuelle uge/måned er fremad, historikken er bagud', () => {
    expect(canGoForward('this_week')).toBe(true);
    expect(canGoForward('this_month')).toBe(true);
    expect(canGoForward('last_week')).toBe(false);
    expect(canGoForward('last_month')).toBe(false);
  });
});

describe('rangeLabel', () => {
  it('én måned viser dagen kun én gang', () => {
    expect(rangeLabel({ from: '2026-09-21', to: '2026-09-27' })).toBe('21. – 27. sep.');
  });

  it('et kryds mellem måneder viser begge måneder', () => {
    expect(rangeLabel({ from: '2026-08-31', to: '2026-09-06' })).toBe('31. aug. – 6. sep.');
  });
});

describe('toHours', () => {
  it('minutter bliver timer med to decimaler', () => {
    expect(toHours(95)).toBe(1.58);
    expect(toHours(120)).toBe(2);
  });

  it('negative og NaN bliver 0, aldrig negative timer', () => {
    expect(toHours(-30)).toBe(0);
    expect(toHours(Number.NaN)).toBe(0);
  });
});

describe('formatGapHours', () => {
  it('timer med én decimal, dansk komma', () => {
    expect(formatGapHours(95)).toBe('1,6 t');
    expect(formatGapHours(120)).toBe('2 t');
  });
});

describe('pauseCountKey', () => {
  it('én pause får egen dansk form, resten pluralis', () => {
    expect(pauseCountKey(1)).toBe('waste.pause_count_one');
    expect(pauseCountKey(0)).toBe('waste.pause_count_other');
    expect(pauseCountKey(7)).toBe('waste.pause_count_other');
  });
});

describe('rankedUsers', () => {
  it('mest spildtid først, navn som tiebreak — samme orden som serveren', () => {
    const list = log({
      byUser: [
        user({ userId: 'a', userName: 'Zeta', gapMinutes: 10 }),
        user({ userId: 'b', userName: 'Bo', gapMinutes: 10 }),
        user({ userId: 'c', userName: 'Ann', gapMinutes: 90 }),
      ],
    } as Partial<WasteLog>);
    expect(rankedUsers(list).map(u => u.userName)).toEqual(['Ann', 'Bo', 'Zeta']);
  });

  it('gør ikke om serverens liste i processen', () => {
    const original = [user({ userName: 'Zeta' }), user({ userName: 'Ann' })];
    const list = log({ byUser: original } as Partial<WasteLog>);
    expect(rankedUsers(list)).not.toBe(original);
    expect(original[0].userName).toBe('Zeta');
  });
});

describe('isUnreadable', () => {
  it('kun varighedsregistreringer: 0 huller er ikke et resultat, men en målefejl', () => {
    expect(isUnreadable(log({ totals: { gapMinutes: 0, gapCount: 0, untimedEntries: 12 } }))).toBe(true);
  });

  it('er der fundet huller, er tal troværdige', () => {
    expect(isUnreadable(log({ totals: { gapMinutes: 40, gapCount: 2, untimedEntries: 12 } }))).toBe(false);
  });

  it('en helt tom periode er bare tom, ikke ulæselig', () => {
    expect(isUnreadable(log())).toBe(false);
  });
});
