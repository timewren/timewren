"use client";

import { AlertTriangle, CheckCircle2, Mail, UserCheck } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

function formatDate(date: Date, locale: string): string {
  return date.toLocaleDateString(toIntlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function DaysBadge({ days }: { days: number }) {
  const t = useTranslations("dashboard.widgets.atRisk");
  const isRed = days >= 90;
  const colorClass = isRed
    ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
    : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colorClass}`}
    >
      {t("daysAgo", { days })}
    </span>
  );
}

export function AtRiskClientsWidget() {
  const t = useTranslations("dashboard.widgets.atRisk");
  const locale = useLocale();
  const { data: atRiskClients, isLoading } =
    trpc.clients.getAtRiskClients.useQuery({ daysSilent: 60 });

  const widgetIcon = (
    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
  );

  if (isLoading) {
    return (
      <DashboardWidget title={t("title")} icon={widgetIcon}>
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  if (!atRiskClients || atRiskClients.length === 0) {
    return (
      <DashboardWidget title={t("title")} icon={widgetIcon}>
        <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-4">
          <CheckCircle2 className="h-8 w-8 text-green-500 dark:text-green-400" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("allActive")}
          </p>
        </div>
      </DashboardWidget>
    );
  }

  const displayClients = atRiskClients.slice(0, 5);
  const hasMore = atRiskClients.length > 5;

  return (
    <DashboardWidget
      title={t("title")}
      variant="warning"
      icon={widgetIcon}
      actions={
        <Link
          href="/dashboard/kunder"
          className="text-sm font-medium text-amber-600 dark:text-amber-400 hover:underline"
        >
          {t("seeAll")}
        </Link>
      }
    >
      <div className="space-y-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("count", { count: atRiskClients.length })}
        </p>

        <div className="space-y-2">
          {displayClients.map((client) => (
            <div
              key={client.clientId}
              className="group rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 transition-colors hover:border-amber-300 dark:hover:border-amber-700 hover:bg-amber-50/50 dark:hover:bg-amber-900/10"
            >
              {/* Top row: name + days badge */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <Link
                  href={`/dashboard/kunder/${client.clientId}`}
                  className="flex-1 min-w-0 font-medium text-sm text-gray-900 dark:text-white hover:text-amber-700 dark:hover:text-amber-300 truncate"
                >
                  {client.clientName}
                </Link>
                <DaysBadge days={client.daysSinceLastActivity} />
              </div>

              {/* Last activity date */}
              {client.lastActivityDate && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("lastActive", {
                    date: formatDate(new Date(client.lastActivityDate), locale),
                  })}
                </p>
              )}

              {/* Bottom row: revenue + klippekort + actions */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  {client.recentRevenue > 0 && (
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      {t("revenue6m", {
                        amount: formatCurrency(client.recentRevenue),
                      })}
                    </span>
                  )}
                  {client.activePrepaidHours > 0 && (
                    <span className="inline-flex items-center rounded-full bg-brand-100 dark:bg-tt-gran-lys px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300">
                      {t("hoursLeft", {
                        hours:
                          client.activePrepaidHours % 1 === 0
                            ? client.activePrepaidHours
                            : client.activePrepaidHours.toFixed(1),
                      })}
                    </span>
                  )}
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    href={`/dashboard/kunder/${client.clientId}`}
                    title={t("openClient")}
                    className="rounded p-1 text-gray-500 dark:text-gray-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                  </Link>
                  {client.clientEmail && (
                    <a
                      href={`mailto:${client.clientEmail}?subject=${encodeURIComponent(t("checkInSubject"))}`}
                      title={t("sendCheckIn")}
                      className="rounded p-1 text-gray-500 dark:text-gray-400 hover:text-brand-700 dark:hover:text-brand-300 hover:bg-brand-100 dark:hover:bg-tt-gran-lys transition-colors"
                    >
                      <Mail className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {hasMore && (
          <Link
            href="/dashboard/kunder"
            className="block text-center text-sm text-amber-600 dark:text-amber-400 hover:underline py-1"
          >
            {t("more", { count: atRiskClients.length - 5 })}
          </Link>
        )}
      </div>
    </DashboardWidget>
  );
}
