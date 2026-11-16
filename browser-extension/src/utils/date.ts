import { dateFormat, t } from "../i18n/core";
/**
 * Format a Date as YYYY-MM-DD using local timezone.
 * Never use .toISOString().split("T")[0] — it converts to UTC,
 * which shifts dates back one day in CET (UTC+1).
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date as YYYY-MM-DD in local timezone.
 */
export function getTodayStr(): string {
  return formatLocalDate(new Date());
}

const shortDate = () => dateFormat({ day: "numeric", month: "short" });

/**
 * Dato som kort dansk tekst efter BRAND.md: "12. okt.", "3. maj".
 * Tager "YYYY-MM-DD" (lokal dato) eller et Date.
 */
export function formatShortDate(date: string | Date): string {
  const d =
    typeof date === "string" ? new Date(`${date.slice(0, 10)}T12:00:00`) : date;
  if (Number.isNaN(d.getTime())) return typeof date === "string" ? date : "";
  return shortDate().format(d);
}

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Dagsoverskrift i historikken: "I dag", "I går", ugedagen i denne uge
 * (mandag til søndag) og ellers kort dato ("12. okt.").
 */
export function historyDateLabel(dateStr: string, now = new Date()): string {
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return formatLocalDate(d);
  };
  if (dateStr === day(0)) return t("format.today");
  if (dateStr === day(-1)) return t("format.yesterday");

  const sinceMonday = (now.getDay() + 6) % 7;
  if (dateStr >= day(-sinceMonday) && dateStr <= day(6 - sinceMonday)) {
    return t(
      `format.weekday.${WEEKDAY_KEYS[new Date(`${dateStr}T12:00:00`).getDay()]}`,
    );
  }
  return formatShortDate(dateStr);
}
