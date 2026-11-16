"use client";

import { Receipt } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { formatCurrency } from "@/lib/format";
import type { VatPeriodKind } from "@/lib/vat/compute";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

/** Nøgle i dashboard.widgets.vat for brugerens momsperiode. */
function titleKeyForPeriod(kind: VatPeriodKind) {
  switch (kind) {
    case "monthly":
      return "titleMonthly";
    case "quarterly":
      return "titleQuarterly";
    case "semi_annual":
      return "titleSemiAnnual";
  }
}

export function VatOverviewWidget() {
  const t = useTranslations("dashboard.widgets.vat");
  const { data, isLoading } = trpc.vat.getVatOverview.useQuery();

  const icon = <Receipt className="h-5 w-5 text-tt-graa" />;

  if (isLoading) {
    return (
      <DashboardWidget title={t("title")} icon={icon}>
        <div className="flex h-full items-center justify-center">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  // VAT-exempt: user explicitly selected "Ikke momspligtig" in settings
  if (data?.isVatExempt) {
    return (
      <DashboardWidget title={t("title")} icon={icon}>
        <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("exempt")}
          </p>
          <Link
            href="/dashboard/settings/company"
            className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {t("changeInSettings")}
          </Link>
        </div>
      </DashboardWidget>
    );
  }

  const title = data ? t(titleKeyForPeriod(data.periodKind)) : t("title");

  const hasData =
    data &&
    !data.isVatExempt &&
    (data.ytdInvoicedExVat > 0 || data.currentPeriod.invoicedExVat > 0);

  if (!hasData) {
    return (
      <DashboardWidget title={title} icon={icon}>
        <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("createFirst")}
          </p>
          <Link
            href="/dashboard/invoices/new"
            className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {t("createInvoice")}
          </Link>
        </div>
      </DashboardWidget>
    );
  }

  const { currentPeriod, nextDeadline, ytdVat, recommendedSavings } = data;

  const deadlineUrgent = nextDeadline.daysUntil <= 7;
  const deadlineWarning =
    nextDeadline.daysUntil > 7 && nextDeadline.daysUntil <= 30;

  return (
    <DashboardWidget
      title={title}
      variant={deadlineUrgent ? "warning" : "default"}
      icon={icon}
      actions={
        <Link
          href="/dashboard/invoices"
          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t("invoices")}
        </Link>
      }
    >
      <div className="space-y-3">
        {/* Period label subtitle */}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {currentPeriod.label}
        </p>

        {/* Big number: current period VAT */}
        <div className="rounded-lg bg-brand-50 dark:bg-tt-gran-lys p-4">
          <p className="mb-1 text-xs text-gray-600 dark:text-gray-400">
            {t("toSettle")}
          </p>
          <p className="text-2xl font-bold text-brand-700 dark:text-brand-400">
            {formatCurrency(currentPeriod.vat)}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
            {t("percentOf", {
              amount: formatCurrency(currentPeriod.invoicedExVat),
            })}
          </p>
        </div>

        {/* Next payment deadline */}
        <div className="flex items-start justify-between gap-2 px-1">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {t("nextDeadline")}
          </p>
          <p
            className={`text-right text-xs font-medium ${
              deadlineUrgent
                ? "text-amber-600 dark:text-amber-400"
                : deadlineWarning
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {nextDeadline.label}
            {nextDeadline.daysUntil >= 0 ? (
              <span className="text-gray-500 dark:text-gray-500">
                {" "}
                {t("inDays", { count: nextDeadline.daysUntil })}
              </span>
            ) : (
              <span className="text-red-500 dark:text-red-400">
                {" "}
                {t("overdue")}
              </span>
            )}
          </p>
        </div>

        {/* YTD */}
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-gray-600 dark:text-gray-400">{t("ytd")}</p>
          <p className="text-xs font-semibold text-gray-900 dark:text-white">
            {formatCurrency(ytdVat)}
          </p>
        </div>

        {/* Recommended savings CTA */}
        {recommendedSavings > 0 && (
          <div className="rounded-md border border-brand-200 bg-brand-50/50 px-3 py-2 dark:border-brand-600 dark:bg-tt-gran-lys">
            <p className="text-xs text-brand-700 dark:text-brand-300">
              {t.rich("setAside", {
                amount: formatCurrency(recommendedSavings),
                b: (chunks) => <span className="font-semibold">{chunks}</span>,
              })}
            </p>
          </div>
        )}
      </div>
    </DashboardWidget>
  );
}
