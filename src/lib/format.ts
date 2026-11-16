import { toIntlLocale } from "@/i18n/format-locale";
import { resolveSharedLocale, sharedT } from "@/i18n/shared-text";

/**
 * Centralized formatting utilities for TimeTrack
 * Ensures consistent display of time, currency, and other values.
 *
 * Funktioner med `locale` bruger det sprog, der gives, ellers det omgivende
 * (tRPC-kaldets eller browserens html-lang), ellers dansk.
 */

type LocaleArg = string | null | undefined;

function intl(locale?: LocaleArg): string {
  return toIntlLocale(resolveSharedLocale(locale));
}

/**
 * Shared Intl.NumberFormat instance for Danish decimal formatting.
 * Reuse this instead of creating `new Intl.NumberFormat("da-DK", ...)` inline.
 *
 * Formats a number with Danish thousand-separators, 0-2 decimal places.
 * Does NOT include a currency symbol — append " kr", " kr/t", etc. yourself.
 */
export const dkkFormatter = {
  format: (value: number, locale?: LocaleArg): string =>
    new Intl.NumberFormat(intl(locale), {
      style: "decimal",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value),
};

/**
 * Shared Intl.NumberFormat for Danish currency (DKK) with the built-in
 * currency symbol.  Use when you need the full "1.234 kr." output.
 */
export const dkkCurrencyFormatter = {
  format: (value: number, locale?: LocaleArg): string =>
    new Intl.NumberFormat(intl(locale), {
      style: "currency",
      currency: "DKK",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value),
};

/**
 * Convert a Date to a local YYYY-MM-DD string.
 * Use this instead of `.toISOString().split("T")[0]` which converts to UTC
 * and shifts dates by -1 day in timezones ahead of UTC (e.g., CET).
 */
export function toLocalDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a "YYYY-MM-DD" string into a Date at local midnight.
 * Use this instead of `new Date("YYYY-MM-DD")` which parses as UTC midnight
 * and can shift dates by -1 day when the runtime timezone is ahead of UTC.
 */
export function parseLocalDateStr(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format decimal hours to HH:MM format
 * @param hours - Decimal hours (e.g., 2.5 = 2 hours 30 minutes)
 * @param options - Formatting options
 * @returns Formatted time string (e.g., "02:30" or "2:30")
 */
export function formatTime(
  hours: number | string | null | undefined,
  options: {
    padHours?: boolean;
    showSeconds?: boolean;
    suffix?: string;
  } = {},
): string {
  const { padHours = false, showSeconds = false, suffix = "" } = options;

  if (hours === null || hours === undefined || hours === "") {
    return padHours ? "00:00" : "0:00";
  }

  const numHours = typeof hours === "string" ? parseFloat(hours) : hours;

  if (Number.isNaN(numHours)) {
    return padHours ? "00:00" : "0:00";
  }

  const totalMinutes = Math.round(numHours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  const hoursStr = padHours ? h.toString().padStart(2, "0") : h.toString();
  const minutesStr = m.toString().padStart(2, "0");

  if (showSeconds) {
    return `${hoursStr}:${minutesStr}:00${suffix}`;
  }

  return `${hoursStr}:${minutesStr}${suffix}`;
}

/**
 * Format decimal hours to a human-readable string in the active language
 * @param hours - Decimal hours
 * @returns Human-readable string (e.g., "2 timer 30 min" or "45 min")
 */
export function formatTimeHuman(
  hours: number | string | null | undefined,
  locale?: LocaleArg,
): string {
  if (hours === null || hours === undefined || hours === "") {
    return sharedT("sharedFormat", "timeMin", { m: 0 }, locale);
  }

  const numHours = typeof hours === "string" ? parseFloat(hours) : hours;

  if (Number.isNaN(numHours)) {
    return sharedT("sharedFormat", "timeMin", { m: 0 }, locale);
  }

  const totalMinutes = Math.round(numHours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  if (h === 0) {
    return sharedT("sharedFormat", "timeMin", { m }, locale);
  }

  if (m === 0) {
    return h === 1
      ? sharedT("sharedFormat", "timeHour", undefined, locale)
      : sharedT("sharedFormat", "timeHours", { h }, locale);
  }

  return h === 1
    ? sharedT("sharedFormat", "timeHourMin", { m }, locale)
    : sharedT("sharedFormat", "timeHoursMin", { h, m }, locale);
}

/**
 * Format decimal hours to short format with "t" suffix
 * @param hours - Decimal hours
 * @returns Short format (e.g., "2:30t")
 */
export function formatTimeShort(
  hours: number | string | null | undefined,
  locale?: LocaleArg,
): string {
  return formatTime(hours, {
    suffix: sharedT("sharedFormat", "shortHourSuffix", undefined, locale),
  });
}

/**
 * Round a monetary amount to 2 decimals (nearest øre). Use this after any
 * multiplication/accumulation that produces fractional DKK before writing
 * to the DB or displaying to the user.
 *
 * Example: `roundMoney(0.1 + 0.2)` → `0.3` (not `0.30000000000000004`).
 */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Sum a list of monetary amounts (numbers or string decimals) and round
 * the result to 2 decimals. Safe against per-entry parseFloat drift.
 */
export function sumMoney(
  amounts: Array<number | string | null | undefined>,
): number {
  let total = 0;
  for (const a of amounts) {
    if (a === null || a === undefined || a === "") continue;
    const n = typeof a === "string" ? parseFloat(a) : a;
    if (!Number.isNaN(n)) total += n;
  }
  return roundMoney(total);
}

/**
 * Format currency in Danish format
 * @param amount - Amount in DKK
 * @param options - Formatting options
 * @returns Formatted currency string
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  options: {
    decimals?: number;
    suffix?: string;
    showZero?: boolean;
    locale?: LocaleArg;
  } = {},
): string {
  const {
    decimals = 0,
    suffix = sharedT(
      "sharedFormat",
      "currencySuffix",
      undefined,
      options.locale,
    ),
    showZero = true,
  } = options;

  if (amount === null || amount === undefined || amount === "") {
    return showZero ? `0${suffix}` : "";
  }

  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;

  if (Number.isNaN(numAmount)) {
    return showZero ? `0${suffix}` : "";
  }

  // Format with Danish locale (uses period as thousand separator)
  const formatted = numAmount.toLocaleString(intl(options.locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${formatted}${suffix}`;
}

/**
 * Format hourly rate
 * @param rate - Hourly rate in DKK
 * @returns Formatted rate (e.g., "850 kr/t")
 */
export function formatHourlyRate(
  rate: number | string | null | undefined,
  locale?: LocaleArg,
): string {
  return formatCurrency(rate, {
    suffix: sharedT("sharedFormat", "hourlyRateSuffix", undefined, locale),
    locale,
  });
}

/**
 * Format percentage
 * @param value - Percentage value (0-100)
 * @param decimals - Number of decimal places
 * @returns Formatted percentage (e.g., "75%")
 */
export function formatPercentage(
  value: number | string | null | undefined,
  decimals: number = 0,
): string {
  if (value === null || value === undefined || value === "") {
    return "0%";
  }

  const numValue = typeof value === "string" ? parseFloat(value) : value;

  if (Number.isNaN(numValue)) {
    return "0%";
  }

  return `${numValue.toFixed(decimals)}%`;
}

/**
 * Format date in Danish format
 * @param date - Date to format
 * @param options - Formatting options
 * @returns Formatted date string
 */
export function formatDate(
  date: Date | string | null | undefined,
  options: {
    includeTime?: boolean;
    shortMonth?: boolean;
    locale?: LocaleArg;
  } = {},
): string {
  const { includeTime = false, shortMonth = false } = options;

  if (!date) {
    return "";
  }

  const d = typeof date === "string" ? new Date(date) : date;

  if (Number.isNaN(d.getTime())) {
    return "";
  }

  const dateOptions: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: shortMonth ? "short" : "long",
    year: "numeric",
  };

  if (includeTime) {
    dateOptions.hour = "2-digit";
    dateOptions.minute = "2-digit";
  }

  return d.toLocaleDateString(intl(options.locale), dateOptions);
}

/**
 * Parse time string (HH:MM) to decimal hours
 * @param timeString - Time string in HH:MM format
 * @returns Decimal hours
 */
export function parseTimeToHours(timeString: string): number {
  if (!timeString?.includes(":")) {
    const num = parseFloat(timeString);
    return Number.isNaN(num) ? 0 : num;
  }

  const [hoursStr, minutesStr] = timeString.split(":");
  const hours = parseInt(hoursStr, 10) || 0;
  const minutes = parseInt(minutesStr, 10) || 0;

  return hours + minutes / 60;
}

/**
 * Formatér et hul mellem to registreringer som dansk pause-tekst:
 * "6 min pause", "1 t pause", "1 t 20 min pause".
 * Delt mellem Logbogen, Teamoverblikket og spildtidsloggen.
 */
export function formatPause(minutes: number, locale?: LocaleArg): string {
  if (minutes < 60) {
    return sharedT("sharedFormat", "pauseMin", { m: minutes }, locale);
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0
    ? sharedT("sharedFormat", "pauseHour", { h }, locale)
    : sharedT("sharedFormat", "pauseHourMin", { h, m }, locale);
}
