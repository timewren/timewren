import { danishPublicHolidays, optionalDayDate } from "@/lib/holidays/danish";

/**
 * Arbejdsdage og arbejdstimer til de offentlige værktøjssider
 * (/arbejdstimer-pr-maaned, /arbejdsdage-2026 …).
 *
 * Helligdagene kommer fra den fælles kalender i src/lib/holidays/danish.ts
 * (#526). Siderne skelner mellem officielle helligdage og de fridage, mange
 * — men ikke alle — har.
 */

export type Holiday = { date: string; name: string };

export type MonthSummary = {
  month: number; // 0-11
  name: string;
  weekdays: number;
  /** Hverdage minus officielle helligdage. */
  workdays: number;
  hours: number;
  /** Grundlovsdag, juleaftensdag og nytårsaftensdag, når de er hverdage. */
  commonDaysOff: number;
};

export const MONTH_NAMES = [
  "Januar",
  "Februar",
  "Marts",
  "April",
  "Maj",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "December",
];

export const WEEKDAY_NAMES = [
  "søndag",
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
];

/** Ferielovens 5 ugers ferie = 25 arbejdsdage. */
export const VACATION_DAYS = 25;

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Officielle danske helligdage (store bededag er afskaffet fra 2024). */
export function officialHolidays(year: number): Holiday[] {
  return danishPublicHolidays(year);
}

/** Dage mange har fri, men som ikke er officielle helligdage. */
export function commonDaysOff(year: number): Holiday[] {
  return [
    { date: optionalDayDate("constitutionDay", year), name: "Grundlovsdag" },
    { date: optionalDayDate("christmasEve", year), name: "Juleaftensdag" },
    { date: optionalDayDate("newYearsEve", year), name: "Nytårsaftensdag" },
  ];
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

function isWeekday(date: string): boolean {
  const day = weekdayOf(date);
  return day !== 0 && day !== 6;
}

export function workdaysByMonth(
  year: number,
  hoursPerWeek = 37,
): MonthSummary[] {
  const holidays = new Set(officialHolidays(year).map((h) => h.date));
  const extra = new Set(commonDaysOff(year).map((h) => h.date));
  const hoursPerDay = hoursPerWeek / 5;

  return MONTH_NAMES.map((name, month) => {
    const days = new Date(year, month + 1, 0).getDate();
    let weekdays = 0;
    let workdays = 0;
    let common = 0;
    for (let day = 1; day <= days; day++) {
      const date = iso(year, month, day);
      if (!isWeekday(date)) continue;
      weekdays++;
      if (holidays.has(date)) continue;
      workdays++;
      if (extra.has(date)) common++;
    }
    return {
      month,
      name,
      weekdays,
      workdays,
      hours: workdays * hoursPerDay,
      commonDaysOff: common,
    };
  });
}

/** Timer i en gennemsnitsmåned: ugetimer × 52 uger ÷ 12 måneder. */
export function averageMonthlyHours(hoursPerWeek: number): number {
  return (hoursPerWeek * 52) / 12;
}

export function yearSummary(year: number, hoursPerWeek = 37) {
  const months = workdaysByMonth(year, hoursPerWeek);
  const workdays = months.reduce((s, m) => s + m.workdays, 0);
  const hoursPerDay = hoursPerWeek / 5;
  return {
    workdays,
    hours: workdays * hoursPerDay,
    hoursAfterVacation: (workdays - VACATION_DAYS) * hoursPerDay,
    commonDaysOff: months.reduce((s, m) => s + m.commonDaysOff, 0),
  };
}

/** Dansk talformat med op til 2 decimaler, fx 160,33. */
export function formatHours(value: number): string {
  return value.toLocaleString("da-DK", { maximumFractionDigits: 2 });
}
