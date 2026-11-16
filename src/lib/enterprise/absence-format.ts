/** Rene dato-formatere til fravær — uden DB/Resend-afhængigheder. */
import { toIntlLocale } from "@/i18n/format-locale";
import { resolveSharedLocale, sharedT } from "@/i18n/shared-text";

/** "2026-08-27" → "27. aug. 2026" (på dansk; ellers sprogets form) */
export function formatAbsenceDate(
  dateStr: string,
  locale?: string | null,
): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(
    toIntlLocale(resolveSharedLocale(locale)),
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    },
  );
}

/** Periode-tekst: "27. aug. 2026", "27. aug. – 29. aug. 2026" eller "fra 27. aug. 2026" (åben). */
export function formatAbsencePeriod(
  startDate: string,
  endDate: string | null | undefined,
  locale?: string | null,
): string {
  if (!endDate) {
    return sharedT(
      "sharedFormat",
      "openFrom",
      { date: formatAbsenceDate(startDate, locale) },
      locale,
    );
  }
  if (endDate === startDate) return formatAbsenceDate(startDate, locale);
  return `${formatAbsenceDate(startDate, locale)} – ${formatAbsenceDate(endDate, locale)}`;
}
