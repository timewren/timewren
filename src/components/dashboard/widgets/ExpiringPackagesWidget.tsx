import { AlertTriangle, Clock } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { KlippekortHuller } from "@/components/klippekort/KlippekortHuller";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency, formatTime } from "@/lib/format";
import { formatPrepaidExpiry } from "@/lib/prepaid/expiry";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function ExpiringPackagesWidget() {
  const t = useTranslations("dashboard.widgets.expiringPackages");
  const locale = useLocale();
  const { data: expiringPackages } = trpc.prepaid.getExpiring.useQuery();

  if (!expiringPackages) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<Clock className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  const hasPackages = expiringPackages.length > 0;

  return (
    <DashboardWidget
      title={t("title")}
      variant="warning"
      icon={<Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
      actions={
        <Link
          href="/dashboard/klippekort"
          className="text-sm font-medium text-amber-600 dark:text-amber-400 hover:underline"
        >
          {t("seeAll")}
        </Link>
      }
    >
      {!hasPackages ? (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            {t("none")}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {t("noneHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {expiringPackages.slice(0, 4).map((pkg) => {
            // Determine urgency level. Expired packages are always treated
            // as the most urgent state.
            const isUrgent = pkg.isExpired || pkg.daysUntilExpiry <= 7;
            const isWarning = !pkg.isExpired && pkg.daysUntilExpiry <= 14;

            const urgencyConfig = isUrgent
              ? {
                  bgColor: "bg-red-50 dark:bg-red-900/20",
                  borderColor: "border-red-200 dark:border-red-800",
                  textColor: "text-red-700 dark:text-red-300",
                  iconColor: "text-red-600 dark:text-red-400",
                  badgeColor: "bg-red-100 dark:bg-red-900/30",
                }
              : isWarning
                ? {
                    bgColor: "bg-amber-50 dark:bg-amber-900/20",
                    borderColor: "border-amber-200 dark:border-amber-800",
                    textColor: "text-amber-700 dark:text-amber-300",
                    iconColor: "text-amber-600 dark:text-amber-400",
                    badgeColor: "bg-amber-100 dark:bg-amber-900/30",
                  }
                : {
                    bgColor: "bg-blue-50 dark:bg-blue-900/20",
                    borderColor: "border-blue-200 dark:border-blue-800",
                    textColor: "text-blue-700 dark:text-blue-300",
                    iconColor: "text-tt-graa",
                    badgeColor: "bg-blue-100 dark:bg-blue-900/30",
                  };

            return (
              <Link
                key={pkg.id}
                href={`/dashboard/klippekort?id=${pkg.id}`}
                className={`block rounded-lg border ${urgencyConfig.borderColor} ${urgencyConfig.bgColor} p-3 transition-all hover:shadow-md`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {isUrgent && (
                        <AlertTriangle
                          className={`h-4 w-4 shrink-0 ${urgencyConfig.iconColor}`}
                        />
                      )}
                      <h4 className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                        {pkg.name}
                      </h4>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                      {pkg.clientName}
                    </p>
                  </div>

                  <div
                    className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${urgencyConfig.badgeColor} ${urgencyConfig.textColor}`}
                  >
                    {pkg.isExpired
                      ? pkg.daysSinceExpiry > 0
                        ? t("expiredAgo", { count: pkg.daysSinceExpiry })
                        : t("expired")
                      : pkg.daysUntilExpiry === 0
                        ? t("today")
                        : t("days", { count: pkg.daysUntilExpiry })}
                  </div>
                </div>

                <KlippekortHuller
                  className="mt-1"
                  size="sm"
                  totalHours={pkg.totalHours}
                  remainingHours={pkg.remainingHours}
                  tone={isUrgent ? "tom" : "lav"}
                />

                {/* Package details */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="rounded bg-white dark:bg-gray-900 p-2">
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t("hoursLeft")}
                    </p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      {formatTime(pkg.remainingHours)}
                    </p>
                  </div>
                  <div className="rounded bg-white dark:bg-gray-900 p-2">
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t("value")}
                    </p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      {formatCurrency(pkg.estimatedValue)}
                    </p>
                  </div>
                </div>

                {/* Expiry date */}
                <div className="mt-2 flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                  <Clock className="h-3 w-3" />
                  <span>
                    {t("expires", {
                      date: formatPrepaidExpiry(
                        pkg.expiryDate,
                        {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        },
                        toIntlLocale(locale),
                      ),
                    })}
                  </span>
                </div>
              </Link>
            );
          })}

          {/* Summary if more packages */}
          {expiringPackages.length > 4 && (
            <Link
              href="/dashboard/klippekort"
              className="block text-center text-sm text-brand-600 dark:text-brand-400 hover:underline py-2"
            >
              {t("more", { count: expiringPackages.length - 4 })}
            </Link>
          )}

          {/* Warning message if urgent packages exist */}
          {expiringPackages.some(
            (pkg) => pkg.isExpired || pkg.daysUntilExpiry <= 7,
          ) && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-300">
                  {t("urgent")}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </DashboardWidget>
  );
}
