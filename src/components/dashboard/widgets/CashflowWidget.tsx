"use client";

import { AlertTriangle, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { dkkFormatter } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

/** Format a number as Danish currency (no decimals for whole numbers). */
function fmtKr(amount: number): string {
  return `${dkkFormatter.format(Math.round(amount))} kr`;
}

export function CashflowWidget() {
  const t = useTranslations("dashboard.widgets.cashflow");
  const { data, isLoading } = trpc.cashflow.getCashflowForecast.useQuery();
  // Which week's breakdown is expanded (null = none)
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  if (isLoading || !data) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<TrendingUp className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------
  const isEmpty = data.totalExpected === 0;
  const hasOverdue = data.totalOverdue > 0;

  // Count confirmed invoices contributing to overdueAmount in week 1.
  // All overdue money is bucketed into week 1 by the forecast function.
  const overdueWeek = data.weeks[0];
  const overdueCount =
    overdueWeek.overdueAmount > 0
      ? overdueWeek.breakdown.invoices.filter(
          (inv) => inv.confidence === "confirmed",
        ).length
      : 0;

  // Max weekly expected amount for the bar chart scale
  const maxAmount = Math.max(...data.weeks.map((w) => w.expectedAmount), 1);

  if (isEmpty) {
    return (
      <DashboardWidget
        title={t("title")}
        variant="default"
        icon={<TrendingUp className="h-5 w-5 text-tt-graa" />}
        actions={
          <Link
            href="/dashboard/invoices?filter=unpaid"
            className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
          >
            {t("seeUnpaid")}
          </Link>
        }
      >
        <div className="flex flex-col items-center justify-center h-full text-center py-4">
          <TrendingUp className="h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("empty")}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {t("emptyHint")}
          </p>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget
      title={t("title")}
      variant={hasOverdue ? "warning" : "default"}
      icon={
        <TrendingUp
          className={`h-5 w-5 ${hasOverdue ? "text-amber-600 dark:text-amber-400" : "text-brand-600 dark:text-brand-400"}`}
        />
      }
      actions={
        <Link
          href="/dashboard/invoices?filter=unpaid"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("seeAllUnpaid")}
        </Link>
      }
    >
      <div className="space-y-3">
        {/* Overdue banner */}
        {hasOverdue && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-2.5">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 dark:text-red-300">
              {overdueCount > 0
                ? t("overdueInvoices", { count: overdueCount })
                : t("overdue")}
              <span className="font-semibold">{fmtKr(data.totalOverdue)}</span>
            </p>
          </div>
        )}

        {/* Weekly bar chart */}
        <div className="space-y-2">
          {data.weeks.map((week, idx) => {
            const barPct =
              maxAmount > 0
                ? Math.round((week.expectedAmount / maxAmount) * 100)
                : 0;
            const isExpanded = expandedWeek === idx;
            const hasItems =
              week.breakdown.invoices.length > 0 ||
              week.breakdown.prepaidRenewals.length > 0;

            return (
              <div key={week.weekNumber}>
                {/* Week row */}
                <button
                  type="button"
                  onClick={() =>
                    hasItems
                      ? setExpandedWeek(isExpanded ? null : idx)
                      : undefined
                  }
                  className={`w-full text-left ${hasItems ? "cursor-pointer" : "cursor-default"}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-14 shrink-0 text-xs font-medium text-gray-600 dark:text-gray-400">
                      {t("week", { number: week.weekNumber })}
                    </span>
                    {/* Bar */}
                    <div className="flex-1 h-5 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      <div
                        className={`h-full rounded transition-all duration-300 ${
                          week.overdueAmount > 0
                            ? "bg-red-400 dark:bg-red-600"
                            : week.expectedAmount > 0
                              ? "bg-brand-500 dark:bg-brand-400"
                              : ""
                        }`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    {/* Amount */}
                    <span
                      className={`w-24 shrink-0 text-right text-xs font-semibold ${
                        week.overdueAmount > 0
                          ? "text-red-600 dark:text-red-400"
                          : week.expectedAmount > 0
                            ? "text-gray-900 dark:text-white"
                            : "text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      {week.expectedAmount > 0
                        ? fmtKr(week.expectedAmount)
                        : "–"}
                    </span>
                    {/* Expand indicator */}
                    {hasItems && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    )}
                  </div>
                </button>

                {/* Expandable breakdown */}
                {isExpanded && hasItems && (
                  <div className="ml-16 mb-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 p-2 space-y-1">
                    {week.breakdown.invoices.map((inv) => (
                      <div
                        key={inv.invoiceId}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-gray-700 dark:text-gray-300 truncate max-w-[160px]">
                          {inv.invoiceNumber}
                          {inv.confidence === "estimated" && (
                            <span className="ml-1 text-gray-400 dark:text-gray-500">
                              {t("estimated")}
                            </span>
                          )}
                        </span>
                        <span className="font-medium text-gray-900 dark:text-white ml-2 shrink-0">
                          {fmtKr(inv.amount)}
                        </span>
                      </div>
                    ))}
                    {week.breakdown.prepaidRenewals.map((renewal) => (
                      <div
                        key={renewal.clientId}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-gray-700 dark:text-gray-300 truncate max-w-[160px]">
                          {renewal.clientName}
                          <span className="ml-1 text-brand-500 dark:text-brand-400">
                            {t("prepaidTag")}
                          </span>
                        </span>
                        <span className="font-medium text-gray-900 dark:text-white ml-2 shrink-0">
                          {fmtKr(renewal.estimatedAmount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Total */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {t("expected30")}
            </span>
            <span className="text-base font-bold text-gray-900 dark:text-white">
              {fmtKr(data.totalExpected)}
            </span>
          </div>
        </div>
      </div>
    </DashboardWidget>
  );
}
