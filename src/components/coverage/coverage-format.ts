import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import type { CoveragePeriod } from "@/lib/coverage/coverage";

type CoverageMsgKey =
  | "headline.untilToday"
  | "headline.noWorkTimeYet"
  | "headline.of"
  | "headline.noWorkTime"
  | "week";

/**
 * Sprogvalg til formatterne. Uden argument bruges dansk (da-DK, "t"), så
 * eksisterende kaldere uden for coverage-komponenterne er uændrede.
 */
export interface CoverageFormat {
  locale: string;
  hourUnit: string;
  t: (key: CoverageMsgKey, values?: Record<string, string | number>) => string;
}

const DA_MESSAGES: Record<CoverageMsgKey, string> = {
  "headline.untilToday": "{logged} af {expected} indtil i dag",
  "headline.noWorkTimeYet": "Ingen arbejdstid endnu i perioden",
  "headline.of": "{logged} af {expected}",
  "headline.noWorkTime": "Ingen arbejdstid i perioden",
  week: "Uge {week} ({start}–{end})",
};

const DEFAULT_FORMAT: CoverageFormat = {
  locale: "da-DK",
  hourUnit: "t",
  t: (key, values) =>
    DA_MESSAGES[key].replace(/\{(\w+)\}/g, (_, name) =>
      String(values?.[name] ?? ""),
    ),
};

/** Format-indstillinger for det aktive sprog (kun i klientkomponenter). */
export function useCoverageFormat(): CoverageFormat {
  const t = useTranslations("coverage");
  const locale = toIntlLocale(useLocale());
  return useMemo(
    () => ({
      locale,
      hourUnit: t("hourUnit"),
      t: (key, values) => t(key, values),
    }),
    [t, locale],
  );
}

/** "7,4 t" */
export function fmtHours(
  hours: number,
  fmt: CoverageFormat = DEFAULT_FORMAT,
): string {
  const n = new Intl.NumberFormat(fmt.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(hours);
  return `${n} ${fmt.hourUnit}`;
}

/** "73 %" — eller tankestreg når der ikke er arbejdstid at måle mod */
export function fmtPct(
  pct: number | null | undefined,
  fmt: CoverageFormat = DEFAULT_FORMAT,
): string {
  return pct == null
    ? "–"
    : `${new Intl.NumberFormat(fmt.locale, { maximumFractionDigits: 0 }).format(pct)} %`;
}

/** "0,6 t" pr. faktureret time — eller tankestreg */
export function fmtRatio(
  ratio: number | null | undefined,
  fmt: CoverageFormat = DEFAULT_FORMAT,
): string {
  if (ratio == null) return "–";
  const n = new Intl.NumberFormat(fmt.locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
  return `${n} ${fmt.hourUnit}`;
}

export const PERIOD_LABELS: Record<CoveragePeriod, string> = {
  day: "Dag",
  week: "Uge",
  month: "Måned",
};

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoWeekNumber(date: string): number {
  const d = parse(date);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** "Tirsdag 29. september", "Uge 40 (28. sep – 4. okt)", "September 2026" */
export function periodLabel(
  period: CoveragePeriod,
  start: string,
  end: string,
  fmt: CoverageFormat = DEFAULT_FORMAT,
): string {
  const opts = { timeZone: "UTC" } as const;
  if (period === "day") {
    const s = parse(start).toLocaleDateString(fmt.locale, {
      ...opts,
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (period === "week") {
    const short = (d: string) =>
      parse(d).toLocaleDateString(fmt.locale, {
        ...opts,
        day: "numeric",
        month: "short",
      });
    return fmt.t("week", {
      week: isoWeekNumber(start),
      start: short(start),
      end: short(end),
    });
  }
  const s = parse(start).toLocaleDateString(fmt.locale, {
    ...opts,
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function weekdayShort(
  date: string,
  fmt: CoverageFormat = DEFAULT_FORMAT,
): string {
  return parse(date).toLocaleDateString(fmt.locale, {
    timeZone: "UTC",
    weekday: "short",
  });
}

interface HeadlineInput {
  coveragePct: number | null;
  loggedHours: number;
  expectedHours: number;
  toDate: {
    coveragePct: number | null;
    loggedHours: number;
    expectedHours: number;
  } | null;
}

/**
 * Overskriftstal: i en igangværende uge/måned måles mod arbejdstiden til og
 * med i dag, så resten af perioden ikke trækker tallet ned.
 */
export function coverageHeadline(
  d: HeadlineInput,
  fmt: CoverageFormat = DEFAULT_FORMAT,
): {
  pct: number | null;
  text: string;
} {
  if (d.toDate) {
    return {
      pct: d.toDate.coveragePct,
      text:
        d.toDate.expectedHours > 0
          ? fmt.t("headline.untilToday", {
              logged: fmtHours(d.toDate.loggedHours, fmt),
              expected: fmtHours(d.toDate.expectedHours, fmt),
            })
          : fmt.t("headline.noWorkTimeYet"),
    };
  }
  return {
    pct: d.coveragePct,
    text:
      d.expectedHours > 0
        ? fmt.t("headline.of", {
            logged: fmtHours(d.loggedHours, fmt),
            expected: fmtHours(d.expectedHours, fmt),
          })
        : fmt.t("headline.noWorkTime"),
  };
}

/** Farve for dækningsgraden — tekstfarver med AA-kontrast i begge temaer */
export function coverageTone(pct: number | null | undefined): string {
  if (pct == null) return "text-gray-600 dark:text-gray-400";
  if (pct >= 90) return "text-green-700 dark:text-green-400";
  if (pct >= 70) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}
