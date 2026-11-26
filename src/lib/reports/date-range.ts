// Shared calendar bounds for reports and the client hours summary.
import { parseLocalDateStr } from "@/lib/format";
import {
  periodEndUtc,
  periodStartUtc,
  previousPeriodRangeUtc,
} from "@/lib/periods";
import type { ReportTemplateConfig } from "./config-schema";

export const CLIENT_PERIODS = [
  "thisMonth",
  "lastMonth",
  "thisYear",
  "lastYear",
  "custom",
] as const;

type DateRangeSelection = {
  dateRange: ReportTemplateConfig["filters"]["dateRange"] | "lastYear";
  customStart?: string;
  customEnd?: string;
};

export function reportDateBounds(
  filters: DateRangeSelection,
  reference = new Date(),
): { from: Date; to: Date } {
  const { dateRange, customStart, customEnd } = filters;
  if (dateRange === "custom") {
    if (!customStart || !customEnd) {
      throw new Error("custom dateRange requires customStart and customEnd");
    }
    const to = new Date(customEnd);
    to.setUTCDate(to.getUTCDate() + 1);
    return { from: new Date(customStart), to };
  }

  const key = {
    thisMonth: "month",
    lastMonth: "month",
    thisQuarter: "quarter",
    thisYear: "year",
    lastYear: "year",
  } as const;
  const period = key[dateRange];
  const bounds =
    dateRange === "lastMonth" || dateRange === "lastYear"
      ? previousPeriodRangeUtc(period, reference)
      : {
          from: periodStartUtc(period, reference),
          to: periodEndUtc(period, reference),
        };
  if (!bounds?.from || !bounds.to) {
    throw new Error("Expected a bounded report period");
  }
  return { from: bounds.from, to: bounds.to };
}

export function resolveDateRange(
  filters: DateRangeSelection,
  reference = new Date(),
): { start: Date; end: Date } {
  const { from, to } = reportDateBounds(filters, reference);
  return {
    start: parseLocalDateStr(from.toISOString().slice(0, 10)),
    end: parseLocalDateStr(
      new Date(to.getTime() - 1).toISOString().slice(0, 10),
    ),
  };
}
