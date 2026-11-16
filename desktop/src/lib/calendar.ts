/**
 * Calendar math helpers.
 * All date logic uses local time (never .toISOString()) to avoid
 * UTC shift issues in CET/CEST timezones.
 */

import i18n from "i18next";
import { toLocalDateStr } from "./format";

/** Monday of the week containing `date`. */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Sunday of the week containing `date`. */
export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** ISO 8601 week number. */
export function getWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Number of days in a given month (1-indexed month). */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** First day of the month containing `date`. */
export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Last day of the month containing `date`. */
export function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * Add `delta` months to `date`, anchored to the 1st of the target month.
 * Anchoring avoids day-of-month overflow — e.g. stepping forward from the
 * 31st would otherwise roll a 30-day target month into the month after,
 * silently skipping a month.
 */
export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

/** Array of 7 Date objects (Mon-Sun) for the week containing `date`. */
export function getWeekDays(date: Date): Date[] {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** Check if two dates are the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Check if a date is today. */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/** Day name abbreviations, translated via i18n. */
export function getDayName(date: Date): string {
  const dayNames = i18n.t("calendar.dayNames", {
    returnObjects: true,
  }) as string[];
  const day = date.getDay(); // 0=Sun
  const idx = day === 0 ? 6 : day - 1;
  return dayNames[idx];
}

/** Month names, translated via i18n. */
export function getMonthName(date: Date): string {
  const monthNames = i18n.t("calendar.monthNames", {
    returnObjects: true,
  }) as string[];
  return monthNames[date.getMonth()];
}

/**
 * Convert a time entry's start_time/end_time to a vertical position
 * in the calendar grid. Returns fractional hours from midnight.
 */
export function timeToHours(isoString: string): number {
  const d = new Date(isoString);
  return d.getHours() + d.getMinutes() / 60;
}

/**
 * Check if a time entry spans across midnight (start and end on different days).
 */
export function crossesMidnight(
  startTime: string,
  endTime: string | null,
): boolean {
  if (!endTime) return false;
  const start = new Date(startTime);
  const end = new Date(endTime);
  return (
    start.getFullYear() !== end.getFullYear() ||
    start.getMonth() !== end.getMonth() ||
    start.getDate() !== end.getDate()
  );
}

/**
 * For a time entry that crosses midnight, return two virtual entries:
 * one for each day. The original entry is kept intact — these are
 * display-only slices for the calendar view.
 *
 * Returns an array of { entry, displayStart, displayEnd } objects,
 * where displayStart/displayEnd are the clamped times for each day.
 */
export function splitAtMidnight<
  T extends {
    start_time: string;
    end_time: string | null;
    duration: number | null;
  },
>(
  entry: T,
): Array<{
  entry: T;
  displayStart: string;
  displayEnd: string;
  dayDate: Date;
}> {
  if (!entry.end_time || !crossesMidnight(entry.start_time, entry.end_time)) {
    return [
      {
        entry,
        displayStart: entry.start_time,
        displayEnd: entry.end_time ?? entry.start_time,
        dayDate: new Date(entry.start_time),
      },
    ];
  }

  const start = new Date(entry.start_time);
  const end = new Date(entry.end_time);

  // Midnight after the start day
  const midnight = new Date(start);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);

  const results: Array<{
    entry: T;
    displayStart: string;
    displayEnd: string;
    dayDate: Date;
  }> = [];

  // Part 1: start_time to midnight (end of start day)
  const endOfDay = new Date(start);
  endOfDay.setHours(23, 59, 59, 0);
  results.push({
    entry,
    displayStart: entry.start_time,
    displayEnd: endOfDay.toISOString(),
    dayDate: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
  });

  // Part 2: midnight to end_time (start of end day)
  // Handle entries spanning more than one midnight (rare but possible)
  const current = new Date(midnight);
  while (current < end) {
    const dayEnd = new Date(current);
    dayEnd.setHours(23, 59, 59, 0);

    const segmentEnd = dayEnd < end ? dayEnd : end;

    results.push({
      entry,
      displayStart: current.toISOString(),
      displayEnd: segmentEnd.toISOString(),
      dayDate: new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate(),
      ),
    });

    current.setDate(current.getDate() + 1);
    current.setHours(0, 0, 0, 0);
  }

  return results;
}

/**
 * Build an array of calendar grid weeks for month view.
 * Each week is an array of 7 dates, padding with days from
 * previous/next month to fill complete weeks.
 */
export function getMonthGrid(date: Date): Date[][] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Start from Monday of the week containing the 1st
  const gridStart = getWeekStart(firstDay);
  const weeks: Date[][] = [];

  const current = new Date(gridStart);
  // Generate weeks until we pass the last day of the month
  while (current <= lastDay || current.getDay() !== 1) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
    // Safety: max 6 weeks
    if (weeks.length >= 6) break;
  }

  return weeks;
}

/** Format date as "23. maj" / "May 23" depending on locale. */
export function formatShortDate(date: Date): string {
  const shortMonths = i18n.t("calendar.shortMonthNames", {
    returnObjects: true,
  }) as string[];
  if (i18n.language === "en") {
    return `${shortMonths[date.getMonth()]} ${date.getDate()}`;
  }
  // Spansk og svensk skriver dagen uden punktum ("23 may", "23 maj").
  if (i18n.language === "es" || i18n.language === "sv") {
    return `${date.getDate()} ${shortMonths[date.getMonth()]}`;
  }
  return `${date.getDate()}. ${shortMonths[date.getMonth()]}`;
}

/** Get the date string for Tauri IPC calls. */
export function toISODateStr(date: Date): string {
  return toLocalDateStr(date);
}
