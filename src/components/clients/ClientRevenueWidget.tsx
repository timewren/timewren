"use client";

import { DollarSign, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { formatCurrency } from "@/lib/format";

interface TimeEntry {
  id: string;
  date: Date | string;
  hours: string;
  billableRate: string | null;
  isBillable: boolean | null;
  isBilled: boolean | null;
  isPrepaid: boolean | null;
}

interface ClientRevenueWidgetProps {
  timeEntries: TimeEntry[];
  onNavigateToInvoicing?: () => void;
}

export function ClientRevenueWidget({
  timeEntries,
  onNavigateToInvoicing,
}: ClientRevenueWidgetProps) {
  const t = useTranslations("clients");
  const stats = useMemo(() => {
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

    let thisYearRevenue = 0;
    let thisMonthRevenue = 0;
    let lastMonthRevenue = 0;
    let paidRevenue = 0;
    let unbilledCount = 0;
    let unbilledHours = 0;
    let unbilledValue = 0;

    for (const entry of timeEntries) {
      if (!entry.isBillable || entry.isPrepaid) continue;

      const entryDate = new Date(entry.date);
      const entryYear = entryDate.getFullYear();
      const entryMonth = entryDate.getMonth();
      const hours = parseFloat(entry.hours || "0");
      const rate = parseFloat(entry.billableRate || "0");
      const value = hours * rate;

      // This year's revenue
      if (entryYear === thisYear) {
        thisYearRevenue += value;
      }

      // This month's revenue
      if (entryYear === thisYear && entryMonth === thisMonth) {
        thisMonthRevenue += value;
      }

      // Last month's revenue (for comparison)
      if (entryYear === lastMonthYear && entryMonth === lastMonth) {
        lastMonthRevenue += value;
      }

      // Paid vs unbilled
      if (entry.isBilled) {
        paidRevenue += value;
      } else {
        unbilledCount++;
        unbilledHours += hours;
        unbilledValue += value;
      }
    }

    // Calculate trend percentage
    let trendPercentage = 0;
    if (lastMonthRevenue > 0) {
      trendPercentage =
        ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;
    } else if (thisMonthRevenue > 0) {
      trendPercentage = 100;
    }

    return {
      thisYearRevenue,
      thisMonthRevenue,
      lastMonthRevenue,
      paidRevenue,
      unbilledCount,
      unbilledHours,
      unbilledValue,
      trendPercentage,
    };
  }, [timeEntries]);

  const TrendIcon =
    stats.trendPercentage > 0
      ? TrendingUp
      : stats.trendPercentage < 0
        ? TrendingDown
        : Minus;

  const trendColor =
    stats.trendPercentage > 0
      ? "text-green-600 dark:text-green-400"
      : stats.trendPercentage < 0
        ? "text-red-600 dark:text-red-400"
        : "text-gray-500 dark:text-gray-400";

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("revenue.title")}
        </h3>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
          <DollarSign className="h-5 w-5 text-purple-600 dark:text-purple-400" />
        </div>
      </div>

      <div className="space-y-4">
        {/* This year */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t("revenue.thisYear")}
            </span>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(stats.thisYearRevenue)}
            </span>
          </div>
        </div>

        {/* This month with trend */}
        <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t("revenue.thisMonth")}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatCurrency(stats.thisMonthRevenue)}
              </span>
              {stats.lastMonthRevenue > 0 && (
                <span
                  className={`flex items-center gap-1 text-sm ${trendColor}`}
                >
                  <TrendIcon className="h-4 w-4" />
                  {Math.abs(stats.trendPercentage).toFixed(0)}%
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Paid */}
        <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t("revenue.paid")}
            </span>
            <span className="text-lg font-semibold text-green-600 dark:text-green-400">
              {formatCurrency(stats.paidRevenue)}
            </span>
          </div>
        </div>
      </div>

      {/* Unbilled CTA */}
      {stats.unbilledValue > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onNavigateToInvoicing}
            className="w-full rounded-lg bg-brand-50 dark:bg-tt-gran-lys border border-brand-200 dark:border-brand-600 p-3 text-left hover:bg-brand-100 dark:hover:bg-tt-gran-lys transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-brand-900 dark:text-brand-100">
                  {t("revenue.unbilled")}
                </p>
                <p className="text-xs text-brand-600 dark:text-brand-400">
                  {t("revenue.entries", { count: stats.unbilledCount })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-brand-900 dark:text-brand-100">
                  {formatCurrency(stats.unbilledValue)}
                </p>
                <p className="text-xs text-brand-600 dark:text-brand-400">
                  {t("revenue.invoiceNow")} &rarr;
                </p>
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
