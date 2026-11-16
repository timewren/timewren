import type { DayCell, OverviewMember } from './logbook-logic';
import {
  activeDates,
  canGoForward,
  clockRange,
  dayShort,
  formatGap,
  gapLabels,
  gapMinutes,
  hasPreciseTimes,
  hasTimeline,
  isWeekStart,
  memberHours,
  weekDates,
  weekStartAt,
} from './logbook-logic';

/** En tirsdag i september 2026. */
const TUE = new Date('2026-09-22T10:00:00');

function cell(over: Partial<DayCell> = {}): DayCell {
  return {
    firstStart: null,
    lastEnd: null,
    totalHours: 0,
    entriesCount: 0,
    timedCount: 0,
    ...over,
  };
}

function member(days: OverviewMember['days']): OverviewMember {
  return { userId: 'u1', name: 'Mads', days };
}

describe('weekStartAt', () => {
  it('giver mandagen i den aktuelle uge', () => {
    expect(weekStartAt(0, TUE)).toBe('2026-09-21');
  });

  it('går præcis en uge tilbage og frem, også over en ugegrænse', () => {
    // 2026-09-28 er en mandag; -1 uge er den 21. (Europas efterårsskifte
    // ligger i oktober, så den her uge har 7 dage.)
    expect(weekStartAt(-1, new Date('2026-09-28T08:00:00'))).toBe('2026-09-21');
    expect(weekStartAt(1, new Date('2026-09-28T08:00:00'))).toBe('2026-10-05');
  });

  it('søndag hører til den uge den startede i, ikke til næste', () => {
    expect(weekStartAt(0, new Date('2026-09-27T23:30:00'))).toBe('2026-09-21');
  });
});

describe('canGoForward', () => {
  it('logbogen er historisk: ingen fremad fra den aktuelle uge', () => {
    expect(canGoForward(0)).toBe(false);
    expect(canGoForward(-1)).toBe(true);
  });
});

describe('isWeekStart', () => {
  it('accepterer kun serverens egen datoformat', () => {
    expect(isWeekStart('2026-09-21')).toBe(true);
    expect(isWeekStart('2026-9-21')).toBe(false);
    expect(isWeekStart('21.09.2026')).toBe(false);
    expect(isWeekStart('')).toBe(false);
    expect(isWeekStart(undefined)).toBe(false);
  });

  it('accepterer kun en dato, der findes i kalenderen', () => {
    // Review-fund 30/9: regex'en alene lod `2026-13-45` og `2026-02-30`
    // slippe igennem fra et dybt link, og skærmen formatterede dem så — hvilket
    // kaster `RangeError` under render, uden for `ErrorState`s greb.
    expect(isWeekStart('2026-13-45')).toBe(false);
    expect(isWeekStart('2026-02-30')).toBe(false);
    expect(isWeekStart('2026-02-29')).toBe(false); // 2026 er ikke et skudår
    expect(isWeekStart('2024-02-29')).toBe(true); // 2024 er
  });
});

describe('weekDates', () => {
  it('giver alle syv dage i rækkefølge fra mandag', () => {
    expect(weekDates('2026-09-21')).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
  });

  it('falder tilbage på den aktuelle uge for en dato, der ikke findes', () => {
    // `date-fns` kaster `RangeError` på en `Invalid Date`, så en umulig dato
    // må aldrig nå `format` — heller ikke ad den omvej.
    const now = new Date('2026-09-23T08:00:00');
    jest.useFakeTimers().setSystemTime(now);
    try {
      expect(weekDates('2026-02-30')).toEqual(weekDates('2026-09-21'));
    }
    finally {
      jest.useRealTimers();
    }
  });
});

describe('dayShort', () => {
  it('følger kalenderens ugedagsnavn, ikke kolonnens rækkefølge', () => {
    expect(dayShort('2026-09-21')).toBe('Man');
    expect(dayShort('2026-09-26')).toBe('Lør');
    expect(dayShort('2026-09-27')).toBe('Søn');
  });

  it('kaster ikke på en dato, der ikke findes', () => {
    expect(dayShort('2026-13-45')).toBe('—');
  });
});

describe('clockRange', () => {
  it('viser første start og sidste slut', () => {
    // 06:00Z og 14:30Z er 08:00 og 16:30 i Danmark. Tidszonen er låst i
    // `pnpm test` (scripts/jest-timezone.js), ellers svarer testen efter
    // maskinens TZ — og CI kører på UTC.
    const c = cell({ firstStart: '2026-09-21T06:00:00.000Z', lastEnd: '2026-09-21T14:30:00.000Z' });
    expect(clockRange(c)).toBe('08:00 – 16:30');
  });

  it('sig-er intet uden begge tidspunkter — vi må ikke gætte', () => {
    expect(clockRange(cell())).toBeNull();
    expect(clockRange(undefined)).toBeNull();
    expect(clockRange(cell({ firstStart: '2026-09-21T06:00:00.000Z' }))).toBeNull();
    expect(clockRange(cell({ lastEnd: '2026-09-21T14:30:00.000Z' }))).toBeNull();
  });
});

describe('hasPreciseTimes', () => {
  it('kun sandt når alle dagens registreringer havde tidspunkter', () => {
    expect(hasPreciseTimes(cell({ entriesCount: 2, timedCount: 2 }))).toBe(true);
    expect(hasPreciseTimes(cell({ entriesCount: 2, timedCount: 1 }))).toBe(false);
    expect(hasPreciseTimes(cell({ entriesCount: 0, timedCount: 0 }))).toBe(false);
    expect(hasPreciseTimes(undefined)).toBe(false);
  });
});

describe('memberHours', () => {
  it('summerer ugen og runder som serveren gør', () => {
    const m = member({
      '2026-09-21': cell({ totalHours: 7.5 }),
      '2026-09-22': cell({ totalHours: 2.333 }),
    });
    expect(memberHours(m)).toBe(9.83);
  });

  it('ignorerer NaN i stedet for at summere til NaN', () => {
    const m = member({ '2026-09-21': cell({ totalHours: Number.NaN }), '2026-09-22': cell({ totalHours: 1 }) });
    expect(memberHours(m)).toBe(1);
  });
});

describe('activeDates', () => {
  it('kun dage med mindst én registrering, i kalenderorden', () => {
    const m = member({
      '2026-09-22': cell({ entriesCount: 1 }),
      '2026-09-21': cell({ entriesCount: 3 }),
      '2026-09-23': cell({ entriesCount: 0 }),
    });
    expect(activeDates(m, '2026-09-21')).toEqual(['2026-09-21', '2026-09-22']);
  });
});

describe('gapMinutes', () => {
  const before = { start: '2026-09-21T06:00:00.000Z', end: '2026-09-21T08:00:00.000Z' } as NonNullable<Parameters<typeof gapMinutes>[0]>;
  const after = { start: '2026-09-21T08:35:00.000Z', end: '2026-09-21T10:00:00.000Z' } as NonNullable<Parameters<typeof gapMinutes>[0]>;

  it('måller hullet mellem to intervaller', () => {
    expect(gapMinutes(before, after)).toBe(35);
  });

  it('overlappende intervaller giver 0, ikke et negativt hul', () => {
    const overlap = { start: '2026-09-21T07:00:00.000Z', end: '2026-09-21T09:00:00.000Z' } as NonNullable<Parameters<typeof gapMinutes>[0]>;
    expect(gapMinutes(before, overlap)).toBe(0);
  });

  it('kan ikke måle uden begge sider', () => {
    expect(gapMinutes(before, undefined)).toBeNull();
    expect(gapMinutes({ ...before, end: null } as never, after)).toBeNull();
  });
});

describe('formatGap / formatWorked', () => {
  it('timer og minutter, og rent minutter under en time', () => {
    expect(formatGap(95)).toBe('1 t 35 min.');
    expect(formatGap(120)).toBe('2 t');
    expect(formatGap(45)).toBe('45 min.');
  });

  it('negativ eller NaN vises som 0, aldrig som "-5 min."', () => {
    expect(formatGap(-5)).toBe('0 min.');
    expect(formatGap(Number.NaN)).toBe('0 min.');
  });
});

describe('hasTimeline', () => {
  const day = (intervals: { start: string | null; end: string | null }[]) =>
    ({ date: '2026-09-21', intervals, gaps: [], gapDetails: [], totalHours: 0, summary: { gapMinutes: 0, spanMinutes: 0, workedMinutes: 0, untimedEntries: 0, syntheticEntries: 0 } }) as never;

  it('kræver et interval med både start og slut', () => {
    expect(hasTimeline(day([{ start: 'a', end: 'b' }]))).toBe(true);
    expect(hasTimeline(day([{ start: 'a', end: null }]))).toBe(false);
    expect(hasTimeline(day([]))).toBe(false);
  });
});

describe('gapLabels', () => {
  it('navngiver hullet med den opgave der følger og den der kom før', () => {
    const day = {
      gapDetails: [{ afterIndex: 0, beforeIndex: 1, minutes: 20 }],
      intervals: [
        { projectName: 'Kunde A', clientName: null },
        { projectName: 'Kunde B', clientName: null },
      ],
    } as never;
    expect(gapLabels(day)).toEqual([{ minutes: 20, label: 'Kunde A → Kunde B' }]);
  });

  it('falder tilbage til kundenavnet, og til en streg når ingen af dem findes', () => {
    const day = {
      gapDetails: [{ afterIndex: 0, beforeIndex: 1, minutes: 5 }],
      intervals: [{ projectName: null, clientName: 'Acme' }, { projectName: null, clientName: null }],
    } as never;
    expect(gapLabels(day)[0].label).toBe('Acme');
    const unknown = { gapDetails: [{ afterIndex: 0, beforeIndex: 1, minutes: 5 }], intervals: [{}, {}] } as never;
    expect(gapLabels(unknown)[0].label).toBe('—');
  });
});
