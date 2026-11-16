"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  TrendingDown,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { PageHeader } from "@/components/dashboard-nav";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

// Reel timepris (#97): "Du siger 500. Du tjener 300." — men beregnet
// rigtigt, fordi vi har hele kæden: tid, satser, fakturaer OG klippekort.

export default function ProfitabilityPage() {
  const t = useTranslations("reports");
  const locale = useLocale();
  const fmtKr = (n: number) =>
    new Intl.NumberFormat(toIntlLocale(locale), {
      maximumFractionDigits: 0,
    }).format(n);
  const [months, setMonths] = useState(12);
  const { data, isLoading } = trpc.reports.getRealRates.useQuery({ months });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/dashboard/reports"
            className="mb-1 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("profitability.back")}
          </Link>
          <PageHeader
            title={t("profitability.title")}
            description={t("profitability.description")}
          />
        </div>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value={3}>{t("profitability.months3")}</option>
          <option value={6}>{t("profitability.months6")}</option>
          <option value={12}>{t("profitability.months12")}</option>
          <option value={24}>{t("profitability.months24")}</option>
        </select>
      </div>

      {isLoading || !data ? (
        <div className="flex h-64 items-center justify-center">
          <InlineSpinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          {/* Intern tid-kort */}
          {data.internal.hours > 0 && (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <Clock className="h-8 w-8 shrink-0 text-amber-500" />
              <div>
                <p className="font-medium text-gray-900 dark:text-white">
                  {t("profitability.internalHours", {
                    hours: data.internal.hours.toFixed(1),
                  })}
                </p>
                {data.internal.lostValue !== null && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("profitability.internalLost", {
                      amount: fmtKr(data.internal.lostValue),
                    })}
                  </p>
                )}
              </div>
            </div>
          )}

          {data.clients.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
              <Wallet className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
                {t("profitability.noClientTime")}
              </h3>
              <p className="mt-2 text-gray-500 dark:text-gray-400">
                {t("profitability.noClientTimeHint")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-3">
                      {t("profitability.colClient")}
                    </th>
                    <th className="px-4 py-3 text-right">
                      {t("profitability.colRealRate")}
                    </th>
                    <th className="px-4 py-3 text-right">
                      {t("profitability.colYourRate")}
                    </th>
                    <th className="px-4 py-3 text-right">
                      {t("profitability.colTotalHours")}
                    </th>
                    <th className="px-4 py-3 text-right">
                      {t("profitability.colEarned")}
                    </th>
                    <th className="px-4 py-3">
                      {t("profitability.colAssessment")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-950">
                  {data.clients.map((c) => {
                    const pct =
                      c.rateRatio !== null
                        ? Math.round(c.rateRatio * 100)
                        : null;
                    const bad = pct !== null && pct < 70;
                    const warn = pct !== null && pct >= 70 && pct < 90;
                    return (
                      <tr key={c.clientId}>
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/clients/${c.clientId}`}
                            className="font-medium text-gray-900 hover:underline dark:text-white"
                          >
                            {c.clientName}
                          </Link>
                          {c.unbilledBillableHours > 0.5 && (
                            <p className="text-xs text-gray-400">
                              {t("profitability.unbilledHours", {
                                hours: c.unbilledBillableHours.toFixed(1),
                              })}
                            </p>
                          )}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold tabular-nums ${
                            bad
                              ? "text-red-600 dark:text-red-400"
                              : warn
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-gray-900 dark:text-white"
                          }`}
                        >
                          {t("profitability.ratePerHour", {
                            rate: fmtKr(c.realRate),
                          })}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                          {c.nominalRate
                            ? t("profitability.ratePerHour", {
                                rate: fmtKr(c.nominalRate),
                              })
                            : "–"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                          {c.totalHours.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                          {t("profitability.amountKr", {
                            amount: fmtKr(c.earned),
                          })}
                        </td>
                        <td className="px-4 py-3">
                          {pct === null ? (
                            <span className="text-xs text-gray-400">
                              {t("profitability.setRate")}
                            </span>
                          ) : bad ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                              <TrendingDown className="h-3.5 w-3.5" />
                              {t("profitability.bad", { pct })}
                            </span>
                          ) : warn ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {t("profitability.warn", { pct })}
                            </span>
                          ) : (
                            <span className="text-xs text-green-600 dark:text-green-400">
                              {t("profitability.good", { pct })}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-500">
            {t("profitability.footnote", { from: data.from })}
          </p>
        </>
      )}
    </div>
  );
}
