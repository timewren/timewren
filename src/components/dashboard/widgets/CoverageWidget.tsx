"use client";

import { Gauge } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CoverageBar } from "@/components/coverage/CoverageParts";
import {
  coverageHeadline,
  coverageTone,
  fmtHours,
  fmtPct,
  fmtRatio,
  periodLabel,
  useCoverageFormat,
} from "@/components/coverage/coverage-format";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import type { CoveragePeriod } from "@/lib/coverage/coverage";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

const PERIODS: CoveragePeriod[] = ["day", "week", "month"];

/**
 * Dækningsgrad (#679): hvor stor en del af arbejdstiden der er logget —
 * virker uden kalender. Tidsposter ændres mange steder, så tallet hentes
 * frisk ved hver visning i stedet for at afhænge af invalidering.
 */
export function CoverageWidget() {
  const t = useTranslations("dashboard.widgets.coverage");
  const tc = useTranslations("coverage");
  const fmt = useCoverageFormat();
  const [period, setPeriod] = useState<CoveragePeriod>("week");
  const { data, isError, isLoading } = trpc.coverage.getSummary.useQuery(
    { period },
    { refetchOnMount: "always", refetchOnWindowFocus: true },
  );
  const headline = data ? coverageHeadline(data, fmt) : null;

  return (
    <DashboardWidget
      title={t("title")}
      icon={<Gauge className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href={`/dashboard/reports/coverage?period=${period}`}
          className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
        >
          {t("details")}
        </Link>
      }
    >
      <div className="flex h-full flex-col gap-3">
        <fieldset
          className="inline-flex self-start rounded-lg border border-gray-200 p-0.5 dark:border-gray-700"
          aria-label={t("period")}
        >
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`min-h-[28px] rounded-md px-2.5 text-xs font-medium transition-colors ${
                period === p
                  ? "bg-tt-gran text-tt-paa-gran"
                  : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {tc(`period.${p}`)}
            </button>
          ))}
        </fieldset>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <InlineSpinner className="h-6 w-6" />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-red-700 dark:text-red-400">
            {t("loadFailed")}
          </p>
        ) : (
          <>
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {periodLabel(data.period, data.start, data.end, fmt)}
              </p>
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-3xl font-bold tabular-nums ${coverageTone(headline?.pct)}`}
                >
                  {fmtPct(headline?.pct, fmt)}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {headline?.text}
                </span>
              </div>
            </div>

            <CoverageBar
              billableHours={data.billableHours}
              nonBillableHours={data.nonBillableHours}
              expectedHours={data.expectedHours}
            />

            {data.loggedHours === 0 ? (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                <p>{t("noTime")}</p>
                <Link
                  href="/dashboard/time"
                  className="font-medium text-brand-700 hover:underline dark:text-brand-400"
                >
                  {t("trackTime")}
                </Link>
              </div>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-gray-600 dark:text-gray-400">
                      {t("billable")}
                    </dt>
                    <dd className="tabular-nums text-gray-900 dark:text-white">
                      {fmtHours(data.billableHours, fmt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-600 dark:text-gray-400">
                      {t("nonBillable")}
                    </dt>
                    <dd className="tabular-nums text-gray-900 dark:text-white">
                      {fmtHours(data.nonBillableHours, fmt)}
                    </dd>
                  </div>
                </dl>
                {data.nonBillablePerBillableHour != null && (
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {t.rich("ratio", {
                      ratio: fmtRatio(data.nonBillablePerBillableHour, fmt),
                      b: (chunks) => (
                        <span className="font-semibold tabular-nums">
                          {chunks}
                        </span>
                      ),
                    })}
                  </p>
                )}
                <ul className="space-y-1 text-sm">
                  <li className="flex justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <span>{t("clientCol")}</span>
                    <span>{t("splitCol")}</span>
                  </li>
                  {data.clients.slice(0, 3).map((c) => (
                    <li
                      key={c.clientId ?? "intern"}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate text-gray-900 dark:text-white">
                        {c.clientName}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-gray-400">
                        {fmtHours(c.billableHours, fmt)} /{" "}
                        {fmtHours(c.nonBillableHours, fmt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </DashboardWidget>
  );
}
