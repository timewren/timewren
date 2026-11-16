"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { trpc } from "@/providers/trpc-provider";
import { CoverageBar } from "./CoverageParts";
import {
  coverageHeadline,
  coverageTone,
  fmtHours,
  fmtPct,
  fmtRatio,
  useCoverageFormat,
} from "./coverage-format";

/** Kompakt dækningsgrad for en uge — til ugevisningen (#679). */
export function CoverageStrip({ weekStart }: { weekStart: string }) {
  const t = useTranslations("coverage");
  const fmt = useCoverageFormat();
  const { data } = trpc.coverage.getSummary.useQuery(
    { period: "week", date: weekStart },
    { refetchOnMount: "always", refetchOnWindowFocus: true },
  );
  if (!data) return null;
  const headline = coverageHeadline(data, fmt);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-gray-200 px-4 py-3 text-sm dark:border-gray-700">
      <div className="flex items-baseline gap-2">
        <span className="text-gray-600 dark:text-gray-400">
          {t("strip.title")}
        </span>
        <span
          className={`text-lg font-bold tabular-nums ${coverageTone(headline.pct)}`}
        >
          {fmtPct(headline.pct, fmt)}
        </span>
        <span className="text-gray-600 dark:text-gray-400">
          {headline.text}
        </span>
      </div>
      <CoverageBar
        className="h-2 max-w-[14rem] flex-1"
        billableHours={data.billableHours}
        nonBillableHours={data.nonBillableHours}
        expectedHours={data.expectedHours}
      />
      <span className="text-gray-700 dark:text-gray-300">
        {t.rich(
          data.nonBillablePerBillableHour != null
            ? "strip.summaryRatio"
            : "strip.summary",
          {
            billable: fmtHours(data.billableHours, fmt),
            nonBillable: fmtHours(data.nonBillableHours, fmt),
            ratio: fmtRatio(data.nonBillablePerBillableHour, fmt),
            n: (chunks) => <span className="tabular-nums">{chunks}</span>,
          },
        )}
      </span>
      <Link
        href={`/dashboard/reports/coverage?period=week&date=${weekStart}`}
        className="ml-auto font-medium text-brand-700 hover:underline dark:text-brand-400"
      >
        {t("strip.perClient")}
      </Link>
    </div>
  );
}
