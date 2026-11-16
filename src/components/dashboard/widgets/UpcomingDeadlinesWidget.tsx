"use client";

import {
  AlertTriangle,
  Building2,
  CalendarClock,
  FileText,
  Receipt,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

type DeadlineCategory =
  | "vat"
  | "income_tax"
  | "corp_tax"
  | "annual_report"
  | "payroll"
  | "other";

function CategoryIcon({ category }: { category: DeadlineCategory }) {
  const cls = "h-4 w-4 flex-shrink-0";
  switch (category) {
    case "vat":
      return <Receipt className={cls} />;
    case "income_tax":
      return <FileText className={cls} />;
    case "corp_tax":
      return <Building2 className={cls} />;
    case "annual_report":
      return <FileText className={cls} />;
    case "payroll":
      return <Users className={cls} />;
    default:
      return <CalendarClock className={cls} />;
  }
}

function daysUntil(date: Date | string): number {
  const target = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function DaysUntilBadge({ days }: { days: number }) {
  const t = useTranslations("dashboard.widgets.deadlines");
  if (days < 0) {
    return (
      <span className="text-xs font-medium text-red-600 dark:text-red-400 whitespace-nowrap">
        {t("overdue")}
      </span>
    );
  }
  if (days < 7) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">
        <AlertTriangle className="h-3 w-3" />
        {days === 0 ? t("today") : t("days", { count: days })}
      </span>
    );
  }
  if (days < 30) {
    return (
      <span className="text-xs font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">
        {t("days", { count: days })}
      </span>
    );
  }
  return (
    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
      {t("days", { count: days })}
    </span>
  );
}

function formatDate(date: Date | string, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(toIntlLocale(locale), {
    day: "numeric",
    month: "long",
  });
}

export function UpcomingDeadlinesWidget() {
  const t = useTranslations("dashboard.widgets.deadlines");
  const locale = useLocale();
  const { data, isLoading } = trpc.user.getUpcomingDeadlines.useQuery({
    lookAheadDays: 180,
  });

  const icon = <CalendarClock className="h-4 w-4 text-tt-graa" />;

  if (isLoading) {
    return (
      <DashboardWidget title={t("title")} icon={icon}>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      </DashboardWidget>
    );
  }

  // User hasn't configured company type yet
  if (!data || data.needsSetup) {
    return (
      <DashboardWidget title={t("title")} icon={icon}>
        <div className="flex flex-col items-center justify-center py-6 text-center gap-3">
          <Settings className="h-8 w-8 text-gray-400 dark:text-gray-500" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("needsSetup")}
          </p>
          <Link
            href="/dashboard/settings/company"
            className="inline-flex items-center gap-1.5 rounded-lg bg-tt-gran px-3 py-1.5 text-xs font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            <Settings className="h-3.5 w-3.5" />
            {t("setUpNow")}
          </Link>
        </div>
      </DashboardWidget>
    );
  }

  // Valid settings but no deadlines in look-ahead window
  if (data.deadlines.length === 0) {
    return (
      <DashboardWidget title={t("title")} icon={icon}>
        <div className="flex items-center justify-center py-6">
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
            {t("none")}
          </p>
        </div>
      </DashboardWidget>
    );
  }

  const top5 = data.deadlines.slice(0, 5);

  return (
    <DashboardWidget
      title={t("title")}
      icon={icon}
      actions={
        <Link
          href="/dashboard/settings/company"
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          title={t("editSettings")}
        >
          <Settings className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <div className="space-y-2">
        {top5.map((deadline) => {
          const days = daysUntil(deadline.date);
          const isUrgent = days < 7;
          return (
            <div
              key={deadline.id}
              className={`flex items-start gap-2 rounded-lg border p-2 transition-colors ${
                isUrgent
                  ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              {/* Category icon */}
              <span
                className={`mt-0.5 ${
                  isUrgent
                    ? "text-red-500 dark:text-red-400"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                <CategoryIcon category={deadline.category} />
              </span>

              {/* Title + date */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {deadline.title}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDate(deadline.date, locale)}
                </p>
              </div>

              {/* Days until */}
              <DaysUntilBadge days={days} />
            </div>
          );
        })}
      </div>
    </DashboardWidget>
  );
}
