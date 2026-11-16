import {
  formatDateLong,
  formatDateShort,
  formatDuration,
  formatHours,
  formatHoursClock,
  formatMoney,
  formatTime,
  formatWeek,
  initials,
  toCopenhagenISODate,
  toISODate,
} from './format';

describe('format', () => {
  it('formatHours', () => {
    expect(formatHours(7.5)).toBe('7,5 t');
    expect(formatHours(8)).toBe('8 t');
    expect(formatHours('0.25')).toBe('0,25 t');
    expect(formatHours(null)).toBe('0 t');
    expect(formatHours(1.999)).toBe('2 t');
    expect(formatHours(2, { unit: false })).toBe('2');
  });

  it('formatHoursClock', () => {
    expect(formatHoursClock(7.5)).toBe('7:30');
    expect(formatHoursClock(0.25)).toBe('0:15');
  });

  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(3725)).toBe('01:02:05');
    expect(formatDuration(-5)).toBe('00:00:00');
  });

  it('formatMoney', () => {
    expect(formatMoney(1234.5)).toBe('1.234,50 kr.');
    expect(formatMoney(1000)).toBe('1.000 kr.');
    expect(formatMoney('12.3')).toBe('12,30 kr.');
    expect(formatMoney(undefined)).toBe('0 kr.');
  });

  it('toISODate', () => {
    expect(toISODate(new Date(2026, 8, 6, 13, 0))).toBe('2026-09-06');
  });

  it('initials', () => {
    expect(initials('Mads Holst Jensen')).toBe('MJ');
    expect(initials('Mads')).toBe('MA');
    expect(initials('')).toBe('?');
  });

  // Review-fund 30/9: `date-fns` kaster `RangeError: Invalid time value` på en
  // `Invalid Date`. Et dybt link med `?weekStart=2026-13-45` ramte netop det i
  // skærmens `subtitle` — altså under render, uden for `ErrorState`s greb — så
  // hele logbogen hvidblændede. En dato vi ikke kan læse skal vise det, ikke
  // tage skærmen med.
  it('formaterer en dato, der ikke findes, som ukendt i stedet for at kaste', () => {
    expect(formatDateShort('2026-13-45')).toBe('—');
    expect(formatDateLong(new Date(Number.NaN))).toBe('—');
    expect(formatTime('ingen dato')).toBe('—');
    expect(formatWeek('2026-13-45')).toBe('—');
    expect(formatDateShort('2026-09-21')).not.toBe('—');
  });
});

describe('toCopenhagenISODate', () => {
  it('giver den danske kalenderdag, ikke telefonens', () => {
    // 22:30Z 1/10 = 00:30 dansk tid 2/10 (sommertid).
    expect(toCopenhagenISODate(new Date('2026-10-01T22:30:00.000Z'))).toBe('2026-10-02');
    // 20:00 i New York 1/10 = 02:00 dansk tid 2/10.
    expect(toCopenhagenISODate('2026-10-02T00:00:00.000Z')).toBe('2026-10-02');
    expect(toCopenhagenISODate(new Date('2026-10-01T21:59:00.000Z'))).toBe('2026-10-01');
  });

  it('håndterer vintertid', () => {
    expect(toCopenhagenISODate(new Date('2026-12-31T23:30:00.000Z'))).toBe('2027-01-01');
  });
});
