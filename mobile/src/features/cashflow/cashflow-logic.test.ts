import type { CashflowForecast, ForecastWeek, VatNumbers } from './cashflow-logic';
import {
  deadlineCaptionKey,
  deadlineTone,
  forecastCoverage,
  forecastMax,
  hasForecast,
  hasVatFigures,
  isVatDeadline,
  safeAmount,
  weekAmountText,
  weekBarFraction,
} from './cashflow-logic';

function week(over: Partial<ForecastWeek> = {}): ForecastWeek {
  return {
    weekNumber: 40,
    from: '2026-09-28T00:00:00.000Z',
    to: '2026-10-04T23:59:59.000Z',
    expectedAmount: 0,
    overdueAmount: 0,
    breakdown: { invoices: [], prepaidRenewals: [] },
    ...over,
  };
}

function forecast(over: Partial<CashflowForecast> = {}): CashflowForecast {
  return { weeks: [week()], totalExpected: 0, totalOverdue: 0, ...over };
}

function vat(over: Partial<VatNumbers> = {}): VatNumbers {
  return {
    isVatExempt: false,
    periodKind: 'quarterly',
    ytdInvoicedExVat: 0,
    ytdVat: 0,
    currentPeriod: { label: 'Okt.–dec. 2026', from: '2026-10-01', to: '2026-12-31', invoicedExVat: 0, vat: 0 },
    nextDeadline: { label: '1. feb. 2027', daysUntil: 125, periodLabel: 'Okt.–dec. 2026' },
    recommendedSavings: 0,
    ...over,
  };
}

describe('isVatDeadline', () => {
  it('genkender alle moms-frister på web\'s id-præfiks', () => {
    expect(isVatDeadline('vat-q1-2027')).toBe(true);
    expect(isVatDeadline('vat-h2-2026')).toBe(true);
    expect(isVatDeadline('vat-monthly-2026-10')).toBe(true);
  });

  it('lader B-skat og selvangivelse være i fred — de har ingen momsbeløb', () => {
    expect(isVatDeadline('b-skat-mar-2027')).toBe(false);
    expect(isVatDeadline('selvangivelse-2027')).toBe(false);
    expect(isVatDeadline('vatp-2027')).toBe(false);
  });

  it('svarer nej på en manglende id i stedet for at kaste', () => {
    expect(isVatDeadline(undefined)).toBe(false);
    expect(isVatDeadline(null)).toBe(false);
    expect(isVatDeadline('')).toBe(false);
  });
});

describe('hasVatFigures', () => {
  it('kræver en sendt faktura — ellers er der intet at estimere', () => {
    expect(hasVatFigures(vat())).toBe(false);
    expect(hasVatFigures(null)).toBe(false);
    expect(hasVatFigures(undefined)).toBe(false);
  });

  it('tæller også kun beløb fra i år — en gammel faktura giver ingen ny periode', () => {
    expect(hasVatFigures(vat({ ytdInvoicedExVat: 1000 }))).toBe(true);
  });

  it('ser en faktura i den aktuelle periode', () => {
    const current = vat({ currentPeriod: { label: 'x', from: 'a', to: 'b', invoicedExVat: 500, vat: 125 } });
    expect(hasVatFigures(current)).toBe(true);
  });
});

describe('deadlineTone', () => {
  it('er rød i dag og indtil en uge før fristen', () => {
    expect(deadlineTone(-3)).toBe('danger');
    expect(deadlineTone(0)).toBe('danger');
    expect(deadlineTone(7)).toBe('danger');
  });

  it('er gul op til en måned før fristen', () => {
    expect(deadlineTone(8)).toBe('warning');
    expect(deadlineTone(30)).toBe('warning');
  });

  it('er neutral længere væk, og aldrig rød på et manglende tal', () => {
    expect(deadlineTone(31)).toBe('default');
    expect(deadlineTone(125)).toBe('default');
    expect(deadlineTone(null)).toBe('default');
    expect(deadlineTone(Number.NaN)).toBe('default');
  });
});

describe('deadlineCaptionKey', () => {
  it('siger det danske i stedet for "om 0 dage"', () => {
    expect(deadlineCaptionKey(0)).toBe('cashflow.deadline_today');
    expect(deadlineCaptionKey(1)).toBe('cashflow.deadline_one');
    expect(deadlineCaptionKey(2)).toBe('cashflow.deadline_other');
  });

  it('må ikke kalde en overskreden frist "om N dage"', () => {
    expect(deadlineCaptionKey(-1)).toBe('cashflow.deadline_overdue');
  });

  it('lader et manglende tal stå som ukendt — ikke som "i dag"', () => {
    expect(deadlineCaptionKey(null)).toBe('cashflow.deadline_unknown');
    expect(deadlineCaptionKey(Number.NaN)).toBe('cashflow.deadline_unknown');
  });
});

describe('forecastMax / weekBarFraction', () => {
  it('skalerer bjælkerne efter den bedste uge', () => {
    const weeks = [week({ expectedAmount: 4000 }), week({ expectedAmount: 10000 }), week({ expectedAmount: 0 })];
    const max = forecastMax(weeks);
    expect(max).toBe(10000);
    expect(weekBarFraction(2500, max)).toBe(0.25);
    expect(weekBarFraction(0, max)).toBe(0);
  });

  it('fylder aldrig over 100 % på et beløb over skalaen', () => {
    expect(weekBarFraction(20000, 10000)).toBe(1);
    expect(weekBarFraction(-500, 10000)).toBe(0);
  });

  it('deler aldrig med nul på en prognose uden tal', () => {
    expect(forecastMax([])).toBe(1);
    expect(forecastMax(null)).toBe(1);
    expect(weekBarFraction(500, 0)).toBe(0);
    expect(weekBarFraction(500, Number.NaN)).toBe(0);
  });
});

describe('weekAmountText', () => {
  it('er en tankestreg i en tom uge, ikke "0 kr."', () => {
    expect(weekAmountText(0)).toBe('—');
    expect(weekAmountText(null)).toBe('—');
    expect(weekAmountText(Number.NaN)).toBe('—');
  });

  it('viser serverens beløb i dansk valuta', () => {
    expect(weekAmountText(12345)).toBe('12.345 kr.');
    expect(weekAmountText(0.5)).toBe('0,50 kr.');
  });
});

describe('hasForecast', () => {
  it('kræver en forventet indbetaling — en liste uden tal er ingen prognose', () => {
    expect(hasForecast(forecast())).toBe(false);
    expect(hasForecast(null)).toBe(false);
  });

  it('ser en uges forventede penge', () => {
    expect(hasForecast(forecast({ totalExpected: 8000 }))).toBe(true);
  });
});

describe('forecastCoverage', () => {
  /**
   * Serverens fire mandag–søndag-vinduer fra mandag 28. september. Den bygger
   * dem i dansk lokal tid (`startOfDay` / `setHours(23,59,59,999)`), og superjson
   * sender dem som UTC-instanter — altså 22:00 UTC for en dansk midnat og
   * 21:59 UTC for en dansk sidste øjeblik.
   */
  const fourWeeks = [
    week({ weekNumber: 40, from: '2026-09-27T22:00:00.000Z', to: '2026-10-04T21:59:59.999Z' }),
    week({ weekNumber: 41, from: '2026-10-04T22:00:00.000Z', to: '2026-10-11T21:59:59.999Z' }),
    week({ weekNumber: 42, from: '2026-10-11T22:00:00.000Z', to: '2026-10-18T21:59:59.999Z' }),
    week({ weekNumber: 43, from: '2026-10-18T22:00:00.000Z', to: '2026-10-25T21:59:59.999Z' }),
  ];

  it('tæller de uger serveren sender — tallet er ikke en tekst', () => {
    expect(forecastCoverage(fourWeeks).weekCount).toBe(4);
    expect(forecastCoverage(fourWeeks.slice(0, 1)).weekCount).toBe(1);
  });

  it('viser den daterække der dækkes, ikke 30 dage fra en vilkårlig ugedag', () => {
    // 30 dage fra onsdag 30. september er 30. oktober, men sidste uge lukker
    // 25. oktober — de fem dage taber serverens `findWeek` stille.
    expect(forecastCoverage(fourWeeks).range).toBe('28. sep. – 25. okt.');
    expect(forecastCoverage(fourWeeks).range).not.toContain('30. okt');
  });

  it('skriver én dato, når vinduet kun er én dag', () => {
    const single = [week({ from: '2026-09-30T22:00:00.000Z', to: '2026-10-01T21:59:59.999Z' })];
    expect(forecastCoverage(single).range).toBe('1. okt.');
  });

  it('regner en uges prognose som mindst denne uge, aldrig som 0', () => {
    // `hasForecast` kræver et beløb, så en tom `weeks`-liste kan kun være et
    // forsvundet svar — "0 uger" ville være en påstand om tallet.
    expect(forecastCoverage([]).weekCount).toBe(1);
    expect(forecastCoverage(null)).toEqual({ weekCount: 1, range: '' });
  });

  it('springer daterækken over, når serveren ikke gav læsbare datoer', () => {
    const broken = [week({ from: 'ikke-en-dato', to: 'heller-ikke' })];
    expect(forecastCoverage(broken)).toEqual({ weekCount: 1, range: '' });
  });
});

describe('safeAmount', () => {
  it('lader et ugyldigt tal blive 0 frem for "NaN kr."', () => {
    expect(safeAmount(Number.NaN)).toBe(0);
    expect(safeAmount(Infinity)).toBe(0);
    expect(safeAmount(null)).toBe(0);
    expect(safeAmount(1234.5)).toBe(1234.5);
  });
});
