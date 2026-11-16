import { formatHours, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';

/** Svar fra `time.previewRate` — kun de felter, appen bruger. */
export type RatePreviewData = {
  hourlyRate: number;
  totalValue: number;
  rateSource: 'project' | 'client' | 'global' | null;
  rateSourceName: string | null;
};

/** Serverens `hours: z.number().min(0.01)` — under det svarer kaldet 400. */
const MIN_PREVIEW_HOURS = 0.01;

/** De timer, serveren vil forespørge en takst for. */
export function previewableHours(hours: number | null | undefined): number | null {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < MIN_PREVIEW_HOURS)
    return null;
  return hours;
}

/**
 * Klippekort er forudbetalte timer, og saldiet er autoritativt på serveren.
 * En timepris under sådan en post ville være en løgn om, hvad den koster.
 */
export function shouldPreviewRate(state: { hours: number | null; prepaidPackageId: string | null }): boolean {
  return state.prepaidPackageId === null && previewableHours(state.hours) !== null;
}

/** Uden takst er der intet at forudse: "0 kr." under et felt er støj, ikke information. */
export function hasRate(preview: RatePreviewData | null | undefined): preview is RatePreviewData {
  return !!preview && Number.isFinite(preview.hourlyRate) && preview.hourlyRate > 0;
}

/**
 * "2 t × 750 kr. = 1.500 kr."
 *
 * Totalen er serverens, ikke en ny beregning: den har afrundet til 2 decimaler,
 * og `rate × timer` i binære tal giver fx 85,00000000000001.
 */
export function ratePreviewLine(hours: number, preview: RatePreviewData): string {
  return translate('entries.form.rate_preview', {
    hours: formatHours(hours),
    rate: formatMoney(preview.hourlyRate),
    total: formatMoney(preview.totalValue),
  });
}

/** Hvor taksten kommer fra. Serverens navn er allerede dansk hårdkodet ("Din standardtakst"). */
export function ratePreviewSource(preview: RatePreviewData): string | null {
  return preview.rateSource && preview.rateSourceName ? preview.rateSourceName : null;
}
