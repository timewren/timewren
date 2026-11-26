import i18n from '~/lib/i18n';
import {
  absenceStatusTone,
  allowsOpenPeriod,
  calendarWeeks,
  countAbsenceDays,
  dayInRange,
  dayMarkLabel,
  formatAbsenceRange,
  formatDays,
  pickCurrentBalance,
  rangeOverlaps,
} from './absence-logic';

describe('countAbsenceDays', () => {
  it('springer weekender over', () => {
    // Man 7/9 – søn 13/9 2026
    expect(countAbsenceDays({ startDate: '2026-09-07', endDate: '2026-09-13' })).toBe(5);
  });

  it('springer helligdage over', () => {
    expect(countAbsenceDays({
      startDate: '2026-12-21',
      endDate: '2026-12-25',
      holidayDates: ['2026-12-24', '2026-12-25'],
    })).toBe(3);
  });

  it('halve dage tæller 0,5', () => {
    expect(countAbsenceDays({ startDate: '2026-09-07', endDate: '2026-09-09', halfDayStart: true })).toBe(2.5);
    expect(countAbsenceDays({ startDate: '2026-09-07', endDate: '2026-09-09', halfDayEnd: true })).toBe(2.5);
    expect(countAbsenceDays({ startDate: '2026-09-07', endDate: '2026-09-09', halfDayStart: true, halfDayEnd: true })).toBe(2);
  });

  it('én dag med halv dag = 0,5 (ikke 0)', () => {
    expect(countAbsenceDays({ startDate: '2026-09-07', endDate: '2026-09-07', halfDayStart: true, halfDayEnd: true })).toBe(0.5);
  });

  it('respekterer arbejdsdage', () => {
    expect(countAbsenceDays({ startDate: '2026-09-07', endDate: '2026-09-13', workingDays: ['1', '3', '5'] })).toBe(3);
  });

  it('0 ved ugyldig periode', () => {
    expect(countAbsenceDays({ startDate: '2026-09-10', endDate: '2026-09-07' })).toBe(0);
    expect(countAbsenceDays({ startDate: '', endDate: '2026-09-07' })).toBe(0);
  });
});

describe('status og formatering', () => {
  it('status → tone', () => {
    expect(absenceStatusTone('approved')).toBe('success');
    expect(absenceStatusTone('pending')).toBe('warning');
    expect(absenceStatusTone('rejected')).toBe('danger');
    expect(absenceStatusTone('cancelled')).toBe('default');
  });

  it('åben periode kun for sygdom/orlov', () => {
    expect(allowsOpenPeriod('sickness')).toBe(true);
    expect(allowsOpenPeriod('leave')).toBe(true);
    expect(allowsOpenPeriod('vacation')).toBe(false);
    expect(allowsOpenPeriod(null)).toBe(false);
  });

  it('formatDays', () => {
    // Jest kører på engelsk: dansk talformat, engelske ord.
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays('2.50')).toBe('2,5 days');
    expect(formatDays(null)).toBe('0 days');
  });

  it('formatDays følger sproget', async () => {
    try {
      await i18n.changeLanguage('de');
      expect(formatDays(1)).toBe('1 Tag');
      expect(formatDays('2.50')).toBe('2,5 Tage');
      await i18n.changeLanguage('es');
      expect(formatDays(3)).toBe('3 días');
      await i18n.changeLanguage('da');
      expect(formatDays(1)).toBe('1 dag');
      expect(formatDays('2.50')).toBe('2,5 dage');
    }
    finally {
      await i18n.changeLanguage('da');
    }
  });

  it('formatAbsenceRange', () => {
    const fmt = (d: string) => d;
    expect(formatAbsenceRange({ startDate: 'a', endDate: null }, fmt)).toBe('Fra a');
    expect(formatAbsenceRange({ startDate: 'a', endDate: 'a' }, fmt)).toBe('a');
    expect(formatAbsenceRange({ startDate: 'a', endDate: 'b' }, fmt)).toBe('a – b');
  });
});

describe('perioder og kalender', () => {
  const today = '2026-09-06';

  it('dayInRange med åben periode løber til i dag', () => {
    expect(dayInRange('2026-09-05', { startDate: '2026-09-01', endDate: null }, today)).toBe(true);
    expect(dayInRange('2026-09-07', { startDate: '2026-09-01', endDate: null }, today)).toBe(false);
    expect(dayInRange('2026-09-07', { startDate: '2026-09-01', endDate: '2026-09-10' }, today)).toBe(true);
  });

  it('rangeOverlaps', () => {
    const window = { from: '2026-09-03', to: '2026-09-30' };
    expect(rangeOverlaps({ startDate: '2026-09-01', endDate: '2026-09-03' }, window, today)).toBe(true);
    expect(rangeOverlaps({ startDate: '2026-09-01', endDate: '2026-09-02' }, window, today)).toBe(false);
  });

  it('calendarWeeks starter mandag og giver 4×7', () => {
    const weeks = calendarWeeks(new Date(2026, 8, 6)); // søndag 6/9
    expect(weeks).toHaveLength(4);
    expect(weeks[0]).toHaveLength(7);
    expect(weeks[0]![0]).toBe('2026-08-31');
    expect(weeks[3]![6]).toBe('2026-09-27');
  });

  it('pickCurrentBalance vælger perioden der dækker i dag, ellers nyeste', () => {
    const list = [
      { periodStart: '2026-09-01', periodEnd: '2027-08-31' },
      { periodStart: '2025-09-01', periodEnd: '2026-08-31' },
    ];
    expect(pickCurrentBalance(list, today)?.periodStart).toBe('2026-09-01');
    expect(pickCurrentBalance(list, '2026-08-15')?.periodStart).toBe('2025-09-01');
    expect(pickCurrentBalance(list, '2020-01-01')?.periodStart).toBe('2026-09-01');
    expect(pickCurrentBalance([], today)).toBeUndefined();
  });
});

describe('dayMarkLabel', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('da');
  });

  it('læser typen og statussen, ikke farven', () => {
    expect(dayMarkLabel({ day: '2026-09-09', mark: { name: 'Ferie', pending: true }, holiday: false, today: '2026-09-09' }))
      .toBe('Onsdag 9. september, I dag, Ferie, Afventer');
    expect(dayMarkLabel({ day: '2026-09-10', mark: { name: 'Ferie', pending: false }, holiday: false, today: '2026-09-09' }))
      .toBe('Torsdag 10. september, Ferie, Godkendt');
  });

  it('lukkedag uden type læses som lukket, og en helligdag kommer med', () => {
    expect(dayMarkLabel({ day: '2026-12-24', mark: { name: 'Lukket', pending: false }, holiday: true, today: '2026-09-09' }))
      .toBe('Torsdag 24. december, Lukket, Godkendt, Helligdag');
  });

  it('en helt almindelig dag er kun sin dato', () => {
    expect(dayMarkLabel({ day: '2026-09-11', mark: null, holiday: false, today: '2026-09-09' })).toBe('Fredag 11. september');
  });
});
