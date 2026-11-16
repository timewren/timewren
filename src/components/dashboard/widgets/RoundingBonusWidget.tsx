"use client";

import { TrendingUp } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { formatCurrency } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function RoundingBonusWidget() {
  const t = useTranslations("dashboard.widgets.rounding");
  const { data, isLoading } = trpc.time.getRoundingBonus.useQuery();

  if (isLoading) {
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

  // No rounding configured anywhere — show CTA
  if (!data?.hasRoundingActive) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<TrendingUp className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("inactive")}
          </p>
          <Link
            href="/dashboard/settings"
            className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            {t("enable")}
          </Link>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget
      title={t("title")}
      variant="success"
      icon={<TrendingUp className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href="/dashboard/settings"
          className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
        >
          {t("settings")}
        </Link>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("thisMonth")}
          </p>
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
            {formatCurrency(data?.thisMonth ?? 0)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
            {t("extra")}
          </p>
        </div>
        <div className="flex items-center justify-between px-1">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("thisYear")}
          </p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {formatCurrency(data?.thisYear ?? 0)}
          </p>
        </div>
      </div>
    </DashboardWidget>
  );
}
