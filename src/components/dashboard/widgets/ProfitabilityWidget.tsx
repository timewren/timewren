"use client";

import { ArrowDown, ArrowUp, TrendingDown } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function ProfitabilityWidget() {
  const t = useTranslations("dashboard.widgets.profitability");
  const intlLocale = toIntlLocale(useLocale());

  function formatRate(rate: number | null | undefined): string {
    if (rate === null || rate === undefined) return "–";
    return t("rate", { rate: rate.toLocaleString(intlLocale) });
  }

  function formatHours(hours: number): string {
    // e.g. 12.5 → "12,5 t"
    return t("hours", {
      hours: hours.toLocaleString(intlLocale, { maximumFractionDigits: 1 }),
    });
  }

  const { data, isLoading, isError } = trpc.time.getProfitability.useQuery({});

  if (isLoading) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<TrendingDown className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  if (isError) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<TrendingDown className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-red-600 dark:text-red-400">
            {t("loadFailed")}
          </p>
        </div>
      </DashboardWidget>
    );
  }

  // No time data at all this month
  if (!data?.hasData && !data?.agreedRate) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<TrendingDown className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-2">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("noBilled")}
          </p>
          <Link
            href="/dashboard/invoices/new"
            className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
          >
            {t("createInvoice")}
          </Link>
        </div>
      </DashboardWidget>
    );
  }

  const isRealRateLower =
    data?.realRate !== null &&
    data?.agreedRate !== null &&
    (data?.realRate ?? 0) < (data?.agreedRate ?? 0);

  const isRealRateHigher =
    data?.realRate !== null &&
    data?.agreedRate !== null &&
    (data?.realRate ?? 0) >= (data?.agreedRate ?? 0);

  const deltaAbs =
    data?.deltaPercent !== null ? Math.abs(data?.deltaPercent ?? 0) : null;

  // Period label: "April 2026"
  const periodLabel = data?.period?.from
    ? new Date(data.period.from).toLocaleDateString(intlLocale, {
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <DashboardWidget
      title={t("title")}
      variant={isRealRateLower ? "warning" : "default"}
      icon={<TrendingDown className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href="/dashboard/reports?view=profitability"
          className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("details")}
        </Link>
      }
    >
      <div className="space-y-2">
        {/* Period */}
        {periodLabel && (
          <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
            {periodLabel}
          </p>
        )}

        {/* Agreed rate + Real rate side by side */}
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("agreedRate")}
            </p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              {formatRate(data?.agreedRate)}
            </p>
          </div>

          {data?.realRate !== null && data?.realRate !== undefined && (
            <div className="text-right">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("realRate")}
              </p>
              <p
                className={`text-xl font-bold ${
                  isRealRateLower
                    ? "text-red-600 dark:text-red-400"
                    : isRealRateHigher
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-gray-900 dark:text-white"
                }`}
              >
                {formatRate(data.realRate)}
              </p>
            </div>
          )}
        </div>

        {/* Delta badge */}
        {deltaAbs !== null && data?.deltaPercent !== null && (
          <div className="flex items-center gap-1">
            {isRealRateLower ? (
              <ArrowDown className="h-3 w-3 text-red-500 dark:text-red-400 shrink-0" />
            ) : (
              <ArrowUp className="h-3 w-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
            )}
            <p
              className={`text-xs font-medium ${
                isRealRateLower
                  ? "text-red-600 dark:text-red-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {t("vsAgreed", {
                percent: deltaAbs.toLocaleString(intlLocale, {
                  maximumFractionDigits: 1,
                }),
              })}
            </p>
          </div>
        )}

        {/* Billable avg (tertiary) */}
        {data?.billableAvg !== null && data?.billableAvg !== undefined && (
          <div className="rounded-md bg-gray-50 dark:bg-gray-900/50 px-3 py-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("billableAvg")}
              </p>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {formatRate(data.billableAvg)}
              </p>
            </div>
          </div>
        )}

        {/* Footer stats */}
        <p className="text-xs text-gray-400 dark:text-gray-500 pt-0.5">
          {(data?.invoicedAmount ?? 0) > 0
            ? t("footerInvoiced", {
                total: formatHours(data?.totalHours ?? 0),
                billable: formatHours(data?.billableHours ?? 0),
                invoiced: formatCurrency(data?.invoicedAmount ?? 0),
              })
            : t("footer", {
                total: formatHours(data?.totalHours ?? 0),
                billable: formatHours(data?.billableHours ?? 0),
              })}
        </p>
      </div>
    </DashboardWidget>
  );
}
