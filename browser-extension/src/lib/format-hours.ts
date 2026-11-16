import { numberFormat, t } from "../i18n/core";

/**
 * Timer som tekst efter BRAND.md (Tal, priser og tid): mellemrum før
 * enheden og komma som decimaltegn ("7,5 t"), under en time i minutter
 * ("45 min"). Højst to decimaler, og nuller til sidst udelades ("8 t",
 * "1,25 t"), som klippekortets formatTimer i web-appen.
 */
const nf = () => numberFormat({ maximumFractionDigits: 2 });

export function formatHoursShort(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0)
    return t("format.hours", { value: 0 });
  if (hours < 1) return t("format.minutes", { count: Math.round(hours * 60) });
  return t("format.hours", { value: nf().format(hours) });
}

/** Timepris som "850 kr./t" (BRAND.md: "kr." med punktum, aldrig "kr/t"). */
export function formatHourlyRate(rate: number): string {
  return t("format.rate", { value: nf().format(rate) });
}
