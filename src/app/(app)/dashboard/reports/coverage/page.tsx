"use client";

import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import {
  CoverageBar,
  CoverageClientTable,
  CoverageLegend,
} from "@/components/coverage/CoverageParts";
import {
  coverageHeadline,
  coverageTone,
  fmtHours,
  fmtPct,
  fmtRatio,
  periodLabel,
  useCoverageFormat,
  weekdayShort,
} from "@/components/coverage/coverage-format";
import { PageHeader } from "@/components/dashboard-nav";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { type CoveragePeriod, shiftPeriod } from "@/lib/coverage/coverage";
import { trpc } from "@/providers/trpc-provider";

// Dækningsgrad (#679): logget tid ÷ normal arbejdstid for dag/uge/måned,
// delt i fakturerbar/ikke-fakturerbar og pr. kunde. Virker uden kalender.

const PERIODS: CoveragePeriod[] = ["day", "week", "month"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function Stat({
  label,
  value,
  hint,
  valueClass = "text-gray-900 dark:text-white",
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-white p-4 dark:bg-gray-900">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
          {hint}
        </div>
      )}
    </div>
  );
}

function CoverageReport() {
  const t = useTranslations("coverage");
  const fmt = useCoverageFormat();
  const router = useRouter();
  const params = useSearchParams();
  const rawPeriod = params.get("period");
  const period: CoveragePeriod = PERIODS.includes(rawPeriod as CoveragePeriod)
    ? (rawPeriod as CoveragePeriod)
    : "week";
  const rawDate = params.get("date");
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : undefined;

  const { data, isLoading, isError, refetch } =
    trpc.coverage.getSummary.useQuery(
      { period, date },
      { refetchOnMount: "always", refetchOnWindowFocus: true },
    );
  const { data: settings } = trpc.coverage.getSettings.useQuery();

  const go = (next: { period?: CoveragePeriod; date?: string | null }) => {
    const p = new URLSearchParams();
    p.set("period", next.period ?? period);
    const d = next.date === undefined ? date : next.date;
    if (d) p.set("date", d);
    router.replace(`/dashboard/reports/coverage?${p.toString()}`);
  };

  const anchor = date ?? data?.today;
  const headline = data ? coverageHeadline(data, fmt) : null;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/dashboard/reports"
          className="mb-1 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("page.back")}
        </Link>
        <PageHeader
          title={t("page.title")}
          description={t("page.description")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <fieldset
          className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700"
          aria-label={t("page.periodAria")}
        >
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => go({ period: p })}
              className={`min-h-[32px] rounded-md px-3 text-sm font-medium transition-colors ${
                period === p
                  ? "bg-tt-gran text-tt-paa-gran"
                  : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {t(`period.${p}`)}
            </button>
          ))}
        </fieldset>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!anchor}
            onClick={() =>
              anchor && go({ date: shiftPeriod(period, anchor, -1) })
            }
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800"
            aria-label={t("page.prev")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[12rem] text-center text-sm font-medium text-gray-900 dark:text-white">
            {data ? periodLabel(data.period, data.start, data.end, fmt) : " "}
          </span>
          <button
            type="button"
            disabled={!anchor}
            onClick={() =>
              anchor && go({ date: shiftPeriod(period, anchor, 1) })
            }
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800"
            aria-label={t("page.next")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {data && !data.isCurrent && (
            <button
              type="button"
              onClick={() => go({ date: null })}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-tt-gran-lys"
            >
              {t("page.today")}
            </button>
          )}
        </div>
        {settings && (
          <p className="ml-auto text-sm text-gray-600 dark:text-gray-400">
            {t(settings.source === "hr" ? "page.workTimeHr" : "page.workTime", {
              hours: fmtHours(settings.weeklyTotal, fmt),
            })}{" "}
            ·{" "}
            <Link
              href="/dashboard/settings#arbejdstid"
              className="font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              {t("page.edit")}
            </Link>
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <InlineSpinner className="h-6 w-6" />
        </div>
      ) : isError || !data ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-300">
            {t("page.loadError")}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-sm font-medium text-red-700 underline dark:text-red-300"
          >
            {t("page.retry")}
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-200 lg:grid-cols-4 dark:bg-gray-800">
            <Stat
              label={t("page.statCoverage")}
              value={fmtPct(headline?.pct ?? null, fmt)}
              valueClass={coverageTone(headline?.pct ?? null)}
              hint={headline?.text}
            />
            <Stat
              label={t("page.statBillable")}
              value={fmtHours(data.billableHours, fmt)}
              hint={t("page.ofWorkTime", {
                pct: fmtPct(data.billableCoveragePct, fmt),
              })}
            />
            <Stat
              label={t("page.statNonBillable")}
              value={fmtHours(data.nonBillableHours, fmt)}
              hint={t("page.ofWorkTime", {
                pct: fmtPct(data.nonBillableCoveragePct, fmt),
              })}
            />
            <Stat
              label={t("page.statRatio")}
              value={fmtRatio(data.nonBillablePerBillableHour, fmt)}
              hint={
                data.billableSharePct == null
                  ? t("page.noTimeLogged")
                  : t("page.shareBilled", {
                      pct: fmtPct(data.billableSharePct, fmt),
                    })
              }
            />
          </div>

          <div className="space-y-2 rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <CoverageBar
              className="h-4"
              billableHours={data.billableHours}
              nonBillableHours={data.nonBillableHours}
              expectedHours={data.expectedHours}
            />
            <CoverageLegend />
          </div>

          <section className="rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
              {t("page.perClient")}
            </h2>
            {data.clients.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-600 dark:text-gray-400">
                <p>{t("page.noTimeInPeriod")}</p>
                <Link
                  href="/dashboard/time"
                  className="font-medium text-brand-700 hover:underline dark:text-brand-400"
                >
                  {t("page.logTime")}
                </Link>
              </div>
            ) : (
              <CoverageClientTable clients={data.clients} />
            )}
          </section>

          {data.period !== "day" && (
            <section className="rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                {t("page.perDay")}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        {t("page.colDate")}
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        {t("page.colWorkTime")}
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        {t("page.colLogged")}
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        {t("page.colBillable")}
                      </th>
                      <th
                        scope="col"
                        className="py-2 pl-3 text-right font-medium"
                      >
                        {t("page.colCoverage")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.days.map((d) => (
                      <tr
                        key={d.date}
                        className={
                          d.date === data.today
                            ? "bg-brand-50/60 dark:bg-tt-gran-lys"
                            : undefined
                        }
                      >
                        <td className="py-1.5 pr-3 text-gray-900 dark:text-white">
                          <span className="inline-block w-9 text-gray-600 dark:text-gray-400">
                            {weekdayShort(d.date, fmt)}
                          </span>
                          {Number(d.date.slice(8))}/{Number(d.date.slice(5, 7))}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                          {d.expectedHours > 0
                            ? fmtHours(d.expectedHours, fmt)
                            : "–"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-900 dark:text-white">
                          {fmtHours(d.loggedHours, fmt)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-900 dark:text-white">
                          {fmtHours(d.billableHours, fmt)}
                        </td>
                        <td
                          className={`py-1.5 pl-3 text-right tabular-nums ${d.date > data.today ? "text-gray-600 dark:text-gray-400" : coverageTone(d.coveragePct)}`}
                        >
                          {d.date > data.today
                            ? "–"
                            : fmtPct(d.coveragePct, fmt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="text-xs text-gray-600 dark:text-gray-400">
            {t("page.footnote")}
          </p>
        </>
      )}
    </div>
  );
}

export default function CoverageReportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <InlineSpinner className="h-6 w-6" />
        </div>
      }
    >
      <CoverageReport />
    </Suspense>
  );
}
