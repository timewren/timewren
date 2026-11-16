import {
  clockFromDate,
  endFromStart,
  formatClock,
  formatHoursInput,
  hoursBetween,
  parseClock,
  parseHoursInput,
  rangeToISO,
} from './duration';

describe('duration', () => {
  it('parseHoursInput: decimal med komma og punktum', () => {
    expect(parseHoursInput('1,5')).toBe(1.5);
    expect(parseHoursInput('1.5')).toBe(1.5);
    expect(parseHoursInput('2')).toBe(2);
    expect(parseHoursInput(' 0,25 ')).toBe(0.25);
    expect(parseHoursInput('')).toBe(0);
  });

  it('parseHoursInput: klokke- og minutformater', () => {
    expect(parseHoursInput('1:30')).toBe(1.5);
    expect(parseHoursInput('0:15')).toBe(0.25);
    expect(parseHoursInput('90m')).toBe(1.5);
    expect(parseHoursInput('1t30')).toBe(1.5);
    expect(parseHoursInput('1h')).toBe(1);
    expect(parseHoursInput('2t 15m')).toBe(2.25);
  });

  it('parseHoursInput: ugyldigt → null', () => {
    expect(parseHoursInput('abc')).toBeNull();
    expect(parseHoursInput('1:75')).toBeNull();
    expect(parseHoursInput('25')).toBeNull();
    expect(parseHoursInput('-1')).toBeNull();
    expect(parseHoursInput('1,333')).toBe(1.33);
  });

  it('formatHoursInput bruger decimalkomma', () => {
    expect(formatHoursInput(1.5)).toBe('1,5');
    expect(formatHoursInput(2)).toBe('2');
    expect(formatHoursInput(0.333)).toBe('0,33');
    expect(formatHoursInput(Number.NaN)).toBe('');
  });

  it('parseClock / formatClock', () => {
    expect(parseClock('09:05')).toEqual({ h: 9, m: 5 });
    expect(parseClock('9:5')).toEqual({ h: 9, m: 5 });
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('12:60')).toBeNull();
    expect(parseClock('nope')).toBeNull();
    expect(formatClock(9, 5)).toBe('09:05');
  });

  it('hoursBetween inkl. over midnat', () => {
    expect(hoursBetween('09:00', '10:30')).toBe(1.5);
    expect(hoursBetween('23:00', '01:00')).toBe(2);
    expect(hoursBetween('09:00', '09:00')).toBe(24);
    expect(hoursBetween('x', '09:00')).toBeNull();
  });

  it('endFromStart', () => {
    expect(endFromStart('09:00', 1.5)).toBe('10:30');
    expect(endFromStart('23:30', 1)).toBe('00:30');
    expect(endFromStart('bad', 1)).toBeNull();
  });

  it('rangeToISO giver ISO i lokal tid og ruller over midnat', () => {
    const r = rangeToISO('2026-09-06', '09:00', '10:30');
    expect(r).not.toBeNull();
    const start = new Date(r!.startTime);
    const end = new Date(r!.endTime);
    expect(start.getHours()).toBe(9);
    expect(end.getHours()).toBe(10);
    expect(end.getMinutes()).toBe(30);
    expect(end.getTime() - start.getTime()).toBe(90 * 60 * 1000);

    const night = rangeToISO('2026-09-06', '23:00', '01:00');
    expect(new Date(night!.endTime).getTime() - new Date(night!.startTime).getTime()).toBe(2 * 3600 * 1000);
    expect(rangeToISO('2026-09-06', '', '10:00')).toBeNull();
  });

  it('clockFromDate', () => {
    expect(clockFromDate(new Date(2026, 8, 6, 14, 7))).toBe('14:07');
    expect(clockFromDate(null)).toBe('');
    expect(clockFromDate('ikke en dato')).toBe('');
  });
});
