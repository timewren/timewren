import type { RatePreviewData } from './rate-preview';
import i18n from '~/lib/i18n';
import {
  hasRate,
  previewableHours,
  ratePreviewLine,
  ratePreviewSource,
  shouldPreviewRate,
} from './rate-preview';

beforeAll(async () => {
  // `translate` er memoized — sproget skal være dansk FØR det første kald,
  // ellers ligger den engelske tekst i cachen resten af filen.
  await i18n.changeLanguage('da');
});

function preview(over: Partial<RatePreviewData> = {}): RatePreviewData {
  return {
    hourlyRate: 750,
    totalValue: 1500,
    rateSource: 'project',
    rateSourceName: 'Nordisk Design',
    ...over,
  };
}

describe('previewableHours', () => {
  it('accepterer de timer, serveren vil have', () => {
    expect(previewableHours(2)).toBe(2);
    expect(previewableHours(0.25)).toBe(0.25);
    expect(previewableHours(0.01)).toBe(0.01);
  });

  it('afviser under serverens minimum (zod: min(0.01)) — kaldet ville svare 400', () => {
    expect(previewableHours(0)).toBeNull();
    expect(previewableHours(0.009)).toBeNull();
    expect(previewableHours(-1)).toBeNull();
  });

  it('afviser tomt og udefineret, så der ikke spørges om en pris uden timer', () => {
    expect(previewableHours(null)).toBeNull();
    expect(previewableHours(undefined)).toBeNull();
  });

  it('afviser NaN og uendeligt — en pris på dem ville være "NaN kr." i feltet', () => {
    expect(previewableHours(Number.NaN)).toBeNull();
    expect(previewableHours(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('shouldPreviewRate', () => {
  it('forudser prisen på en almindelig post', () => {
    expect(shouldPreviewRate({ hours: 2, prepaidPackageId: null })).toBe(true);
  });

  it('aldrig på klippekort — det er forudbetalt, en timepris ville være en løgn', () => {
    expect(shouldPreviewRate({ hours: 2, prepaidPackageId: 'pkg-1' })).toBe(false);
  });

  it('ikke før der er skrevet en gyldig varighed', () => {
    expect(shouldPreviewRate({ hours: null, prepaidPackageId: null })).toBe(false);
  });
});

describe('hasRate', () => {
  it('skjuler en post uden takst — "0 kr." under et felt er støj', () => {
    expect(hasRate(preview({ hourlyRate: 0 }))).toBe(false);
    expect(hasRate(null)).toBe(false);
    expect(hasRate(undefined)).toBe(false);
  });

  it('viser en post med takst', () => {
    expect(hasRate(preview())).toBe(true);
    expect(hasRate(preview({ hourlyRate: 1 }))).toBe(true);
  });

  it('afviser en opsummering, der ikke er et tal', () => {
    expect(hasRate(preview({ hourlyRate: Number.NaN }))).toBe(false);
  });
});

describe('ratePreviewLine', () => {
  it('viser timer × takst = total', () => {
    expect(ratePreviewLine(2, preview())).toBe('2 t × 750 kr. = 1.500 kr.');
  });

  it('tager totalen fra serveren, ikke en ny gang med igen', () => {
    // 0,1 t × 850 kr. er 85,00000000000001 i binære tal. Serveren har afrundet
    // til 2 decimaler; tallet under feltet skal være det samme som det, der
    // faktureres, ikke et lokalt regnestykke.
    const line = ratePreviewLine(0.1, preview({ hourlyRate: 850, totalValue: 85.05 }));
    expect(line).toContain('85,05 kr.');
  });

  it('følger det sprog, brugeren har valgt', async () => {
    const hours = 2;
    const lineDa = ratePreviewLine(hours, preview());
    await i18n.changeLanguage('en');
    expect(ratePreviewLine(hours, preview())).not.toBe(lineDa);
    expect(ratePreviewLine(hours, preview())).toBe('2 h × 750 kr. = 1.500 kr.');
    await i18n.changeLanguage('da');
  });
});

describe('ratePreviewSource', () => {
  it('viser hvor taksten kommer fra', () => {
    expect(ratePreviewSource(preview())).toBe('Nordisk Design');
    expect(ratePreviewSource(preview({ rateSource: 'global', rateSourceName: 'Din standardtakst' })))
      .toBe('Din standardtakst');
  });

  it('viser intet uden kilde, aldrig navnet på en kunde der ikke findes', () => {
    expect(ratePreviewSource(preview({ rateSource: null }))).toBeNull();
    expect(ratePreviewSource(preview({ rateSource: 'client', rateSourceName: null }))).toBeNull();
  });
});
