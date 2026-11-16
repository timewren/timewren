import { AlertTriangle, Clock, Ticket } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { KlippekortHuller } from "@/components/klippekort/KlippekortHuller";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { formatTime } from "@/lib/format";
import { prepaidBalanceLevel } from "@/lib/prepaid/balance";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function PrepaidStatusWidget() {
  const t = useTranslations("dashboard.widgets.prepaidStatus");
  const { data: lowBalancePackages } = trpc.prepaid.getLowBalance.useQuery({});
  const { data: expiringPackages } = trpc.prepaid.getExpiring.useQuery();

  const hasLowBalance = lowBalancePackages && lowBalancePackages.length > 0;
  const hasExpiring = expiringPackages && expiringPackages.length > 0;

  // Under load rendrede widgetet et tomt kort med advarselsikon og "Se alle"
  if (lowBalancePackages === undefined || expiringPackages === undefined) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<Ticket className="h-5 w-5 text-gray-400" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-6 w-6" />
        </div>
      </DashboardWidget>
    );
  }

  // If both queries loaded and nothing to show, render minimal state
  if (
    lowBalancePackages !== undefined &&
    expiringPackages !== undefined &&
    !hasLowBalance &&
    !hasExpiring
  ) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<Ticket className="h-5 w-5 text-green-600 dark:text-green-400" />}
      >
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            {t("allGood")}
          </p>
        </div>
      </DashboardWidget>
    );
  }

  const variant = hasLowBalance ? "warning" : hasExpiring ? "info" : "default";

  return (
    <DashboardWidget
      title={t("title")}
      variant={variant}
      icon={<Ticket className="h-5 w-5 text-orange-600 dark:text-orange-400" />}
      actions={
        <Link
          href="/dashboard/klippekort"
          className="text-sm font-medium text-orange-600 dark:text-orange-400 hover:underline"
        >
          {t("seeAll")}
        </Link>
      }
    >
      <div className="space-y-3">
        {/* Low balance section */}
        {hasLowBalance && (
          <div>
            <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-1.5">
              {t("lowBalance")}
            </p>
            <div className="space-y-1.5">
              {lowBalancePackages.slice(0, 3).map((pkg) => {
                const remaining = parseFloat(String(pkg.remainingHours || "0"));
                const total = parseFloat(String(pkg.totalHours || "0"));
                const isVeryLow =
                  prepaidBalanceLevel(remaining, total) === "critical";

                return (
                  <Link
                    key={pkg.id}
                    href={`/dashboard/klippekort/${pkg.id}`}
                    className={`block rounded-lg border p-2 transition-colors ${
                      isVeryLow
                        ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700"
                        : "border-orange-200 dark:border-orange-800 bg-white dark:bg-gray-800 hover:border-orange-300 dark:hover:border-orange-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
                          {pkg.name}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                          {(Array.isArray(pkg.client)
                            ? pkg.client[0]
                            : pkg.client
                          )?.name ?? t("noClient")}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-xs font-semibold ${
                          isVeryLow
                            ? "text-red-600 dark:text-red-400"
                            : "text-orange-600 dark:text-orange-400"
                        }`}
                      >
                        {t("left", { time: formatTime(pkg.remainingHours) })}
                      </span>
                    </div>
                    <KlippekortHuller
                      className="mt-1.5"
                      size="sm"
                      totalHours={parseFloat(String(pkg.totalHours || "0"))}
                      remainingHours={remaining}
                      tone={isVeryLow ? "tom" : "lav"}
                    />
                  </Link>
                );
              })}
              {lowBalancePackages.length > 3 && (
                <p className="text-center text-xs text-gray-500 dark:text-gray-500">
                  {t("more", { count: lowBalancePackages.length - 3 })}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Expiring section */}
        {hasExpiring && (
          <div>
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1.5">
              {t("expiringSoon")}
            </p>
            <div className="space-y-1.5">
              {expiringPackages.slice(0, 3).map((pkg) => {
                const isUrgent = pkg.isExpired || pkg.daysUntilExpiry <= 7;

                return (
                  <Link
                    key={pkg.id}
                    href={`/dashboard/klippekort/${pkg.id}`}
                    className={`block rounded-lg border p-2 transition-colors ${
                      isUrgent
                        ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700"
                        : "border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-800 hover:border-amber-300 dark:hover:border-amber-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {isUrgent && (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                          )}
                          <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
                            {pkg.name}
                          </p>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                          {pkg.clientName}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className={`text-xs font-semibold ${
                            isUrgent
                              ? "text-red-600 dark:text-red-400"
                              : "text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {pkg.isExpired
                            ? t("expired")
                            : pkg.daysUntilExpiry === 0
                              ? t("today")
                              : t("days", { count: pkg.daysUntilExpiry })}
                        </span>
                        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-500">
                          <Clock className="h-3 w-3" />
                          <span>{formatTime(pkg.remainingHours)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
              {expiringPackages.length > 3 && (
                <p className="text-center text-xs text-gray-500 dark:text-gray-500">
                  {t("more", { count: expiringPackages.length - 3 })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardWidget>
  );
}
