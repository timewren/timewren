import {
  commonDaysOff,
  formatHours,
  MONTH_NAMES,
  officialHolidays,
  weekdayOf,
  workdaysByMonth,
  yearSummary,
} from "@/lib/marketing/workdays";

/**
 * Programmatiske SEO-sider: /arbejdsdage-<år>, /arbejdsdage-<år>/<måned> og
 * /arbejdstimer-<år>. Tallene kommer fra workdays.ts og den fælles
 * helligdagskalender; denne fil samler år-vinduet, slugs, titler og
 * beskrivelser, så sider, sitemap og tests bruger de samme værdier.
 */

/**
 * Indeværende år ±2. Vinduet er en konstant (ikke `new Date()`), fordi hvert
 * år har sine egne route-filer; flyt vinduet ved årsskiftet og tilføj filerne
 * (testen i arbejdsdage-seo.test.ts fejler, hvis de mangler).
 */
export const ARBEJDSDAGE_YEARS = [2024, 2025, 2026, 2027, 2028] as const;

export const HOURS_PER_WEEK = 37;

export type SeoMeta = { title: string; description: string; path: string };

export function monthSlug(month: number): string {
  return MONTH_NAMES[month].toLowerCase();
}

export function monthFromSlug(slug: string): number | null {
  const index = MONTH_NAMES.findIndex((n) => n.toLowerCase() === slug);
  return index === -1 ? null : index;
}

export const MONTH_SLUGS = MONTH_NAMES.map((_, m) => monthSlug(m));

export function yearPath(year: number): string {
  return `/arbejdsdage-${year}`;
}
export function monthPath(year: number, month: number): string {
  return `/arbejdsdage-${year}/${monthSlug(month)}`;
}
export function hoursPath(year: number): string {
  return `/arbejdstimer-${year}`;
}

export function arbejdsdageYearMeta(year: number): SeoMeta {
  const s = yearSummary(year, HOURS_PER_WEEK);
  const off = s.commonDaysOff;
  return {
    path: yearPath(year),
    title: `Arbejdsdage ${year}: ${s.workdays} dage (${formatHours(s.hours)} timer ved ${HOURS_PER_WEEK} t/uge)`,
    description: `Der er ${s.workdays} arbejdsdage i ${year} efter officielle helligdage, og ${s.workdays - off} hvis du også holder fri på grundlovsdag, juleaftensdag og nytårsaftensdag. Se hver måned og alle helligdage.`,
  };
}

export function arbejdsdageMonthMeta(year: number, month: number): SeoMeta {
  const m = workdaysByMonth(year, HOURS_PER_WEEK)[month];
  const name = MONTH_NAMES[month].toLowerCase();
  const holidays = dayRowsForMonth(year, month).filter(
    (r) => r.kind === "helligdag",
  );
  const holidayText = holidays.length
    ? `${holidays.length} helligdag${holidays.length === 1 ? "" : "e"} på hverdage (${holidays.map((h) => h.name?.toLowerCase()).join(", ")})`
    : "ingen helligdage på hverdage i måneden";
  return {
    path: monthPath(year, month),
    title: `Arbejdsdage ${name} ${year}: ${m.workdays} dage (${formatHours(m.hours)} timer ved ${HOURS_PER_WEEK} t/uge)`,
    description: `${MONTH_NAMES[month]} ${year} har ${m.workdays} arbejdsdage ud af ${m.weekdays} hverdage: ${holidayText}. Se dag for dag, hvilke dage der tæller.`,
  };
}

export function arbejdstimerYearMeta(year: number): SeoMeta {
  const s = yearSummary(year, HOURS_PER_WEEK);
  return {
    path: hoursPath(year),
    title: `Arbejdstimer ${year}: ${formatHours(s.hours)} timer ved ${HOURS_PER_WEEK} t/uge (${s.workdays} arbejdsdage)`,
    description: `Der er ${formatHours(s.hours)} arbejdstimer i ${year} ved ${HOURS_PER_WEEK} timer om ugen, og ${formatHours(s.hoursAfterVacation)} efter 5 ugers ferie. Se timer pr. måned og ved 30, 32, 35 og 40 timer om ugen.`,
  };
}

/** Officielle helligdage i en måned (inkl. dem der falder i weekenden). */
export function holidaysInMonth(year: number, month: number) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  return officialHolidays(year).filter((h) => h.date.startsWith(prefix));
}

export type DayKind = "arbejdsdag" | "helligdag" | "valgfri" | "weekend";
export type DayRow = {
  date: string;
  day: number;
  weekday: number;
  kind: DayKind;
  name?: string;
};

/**
 * Dag-for-dag-oversigt for en måned. Weekend vinder over helligdag (en
 * helligdag i weekenden koster ingen arbejdsdag); grundlovsdag og
 * jule-/nytårsaftensdag er "valgfri", når de falder på en hverdag.
 */
export function dayRowsForMonth(year: number, month: number): DayRow[] {
  const holidays = new Map(officialHolidays(year).map((h) => [h.date, h.name]));
  const optional = new Map(commonDaysOff(year).map((h) => [h.date, h.name]));
  const days = new Date(year, month + 1, 0).getDate();
  const rows: DayRow[] = [];
  for (let day = 1; day <= days; day++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const weekday = weekdayOf(date);
    let kind: DayKind = "arbejdsdag";
    let name: string | undefined;
    if (weekday === 0 || weekday === 6) {
      kind = "weekend";
      name = holidays.get(date);
    } else if (holidays.has(date)) {
      kind = "helligdag";
      name = holidays.get(date);
    } else if (optional.has(date)) {
      kind = "valgfri";
      name = optional.get(date);
    }
    rows.push({ date, day, weekday, kind, name });
  }
  return rows;
}

/** Måneden før/efter, også over årsskiftet, hvis året findes i vinduet. */
export function adjacentMonth(
  year: number,
  month: number,
  delta: 1 | -1,
): { year: number; month: number } | null {
  const index = year * 12 + month + delta;
  const y = Math.floor(index / 12);
  if (!(ARBEJDSDAGE_YEARS as readonly number[]).includes(y)) return null;
  return { year: y, month: index - y * 12 };
}

/** Det hubben /arbejdsdage renderer: pr. år de links, der vises. */
export function arbejdsdageHubSections() {
  return ARBEJDSDAGE_YEARS.map((year) => ({
    year,
    yearHref: yearPath(year),
    hoursHref: hoursPath(year),
    months: MONTH_NAMES.map((name, m) => ({
      month: m,
      name,
      href: monthPath(year, m),
    })),
  }));
}

/** Alle stier hubben /arbejdsdage skal linke til. */
export function arbejdsdageHubPaths(): string[] {
  return arbejdsdageHubSections().flatMap((s) => [
    s.yearHref,
    s.hoursHref,
    ...s.months.map((m) => m.href),
  ]);
}

/** Alle programmatiske sider, til sitemap og tests. */
export function seoPagePaths(): string[] {
  return ["/arbejdsdage", ...arbejdsdageHubPaths()];
}
