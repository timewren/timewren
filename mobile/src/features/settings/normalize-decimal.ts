import { intlLocale } from '~/lib/locale';

/** Tal-felt som streng til backenden; tom eller ugyldig streng betyder "ikke sat". Komma accepteres som decimal. */
export function normalizeDecimal(value: string): string | undefined {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed === '')
    return undefined;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) && n >= 0 ? String(n) : undefined;
}

/** Backend-decimal ("37.0", "450.00") → dansk visning i inputfelt ("37", "450"). Tom ved null. */
export function displayDecimal(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '')
    return '';
  const n = Number(value);
  if (!Number.isFinite(n))
    return String(value);
  return n.toLocaleString(intlLocale(), { maximumFractionDigits: 2, useGrouping: false });
}
