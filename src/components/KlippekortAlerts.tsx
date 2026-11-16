"use client";

import { AlertTriangle, Clock, Ticket, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useModules } from "@/hooks/useModules";
import { prepaidBalanceLevel } from "@/lib/prepaid/balance";
import { prepaidDaysUntilExpiry } from "@/lib/prepaid/expiry";
import { trpc } from "@/providers/trpc-provider";

interface AlertProps {
  id: string;
  type: "expiring" | "lowBalance";
  title: string;
  message: string;
  link: string;
  urgency: "critical" | "warning" | "info";
}

export function KlippekortAlerts() {
  const t = useTranslations("klippekort");
  const expiryPhrase = (days: number): string => {
    if (days < 0) return t("expiry.expired");
    if (days === 0) return t("expiry.today");
    if (days === 1) return t("expiry.tomorrow");
    return t("expiry.inDays", { days });
  };
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(
    new Set(),
  );

  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const showKlippekort = !modulesPlaceholder && isModuleEnabled("klippekort");
  const { data: expiringPackages } = trpc.prepaid.getExpiring.useQuery(
    undefined,
    { enabled: showKlippekort },
  );
  const { data: lowBalancePackages } = trpc.prepaid.getLowBalance.useQuery(
    {},
    { enabled: showKlippekort },
  );

  // Build alerts from data
  const alerts: AlertProps[] = [];

  // Critical: Expiring within 7 days
  expiringPackages
    ?.filter((pkg) => pkg.daysUntilExpiry <= 7)
    .forEach((pkg) => {
      alerts.push({
        id: `expiring-${pkg.id}`,
        type: "expiring",
        // getExpiring klemmer daysUntilExpiry til 0 for udløbne kort, så
        // brug isExpired — ellers stod der "udløber om 0 dage".
        title: pkg.isExpired
          ? pkg.daysSinceExpiry > 0
            ? t("alerts.expiredDaysAgo", {
                name: pkg.name,
                count: pkg.daysSinceExpiry,
              })
            : t("alerts.expired", { name: pkg.name })
          : t("alerts.expiring", {
              name: pkg.name,
              phrase: expiryPhrase(pkg.daysUntilExpiry),
            }),
        message: t("alerts.hoursLeft", {
          client: pkg.clientName ?? "",
          hours: pkg.remainingHours,
        }),
        link: `/dashboard/klippekort/${pkg.id}`,
        urgency:
          pkg.isExpired || pkg.daysUntilExpiry <= 3 ? "critical" : "warning",
      });
    });

  // Lav saldo — lowBalancePackages er allerede filtreret til "low"/"critical"
  // på serveren (samme regel som resten af UI'et og lav-saldo-mailen, #881);
  // urgency afspejler bare hvilket af de to niveauer kortet er på.
  lowBalancePackages?.forEach((pkg) => {
    const remaining = parseFloat(pkg.remainingHours);
    const level = prepaidBalanceLevel(remaining, parseFloat(pkg.totalHours));
    alerts.push({
      id: `lowbalance-${pkg.id}`,
      type: "lowBalance",
      title: t("alerts.lowBalanceTitle", {
        name: pkg.name,
        hours: remaining.toFixed(1),
      }),
      message: t("alerts.lowBalanceMessage", {
        client:
          (Array.isArray(pkg.client) ? pkg.client[0] : pkg.client)?.name ??
          t("alerts.unknownClient"),
      }),
      link: `/dashboard/klippekort/${pkg.id}`,
      urgency: level === "critical" ? "critical" : "warning",
    });
  });

  // Filter out dismissed alerts
  const visibleAlerts = alerts.filter(
    (alert) => !dismissedAlerts.has(alert.id),
  );

  if (visibleAlerts.length === 0) return null;

  const handleDismiss = (id: string) => {
    setDismissedAlerts((prev) => new Set([...prev, id]));
  };

  const urgencyStyles = {
    critical: {
      bg: "bg-red-50 dark:bg-red-900/20",
      border: "border-red-200 dark:border-red-800",
      text: "text-red-800 dark:text-red-200",
      icon: "text-red-600 dark:text-red-400",
    },
    warning: {
      bg: "bg-amber-50 dark:bg-amber-900/20",
      border: "border-amber-200 dark:border-amber-800",
      text: "text-amber-800 dark:text-amber-200",
      icon: "text-amber-600 dark:text-amber-400",
    },
    info: {
      bg: "bg-blue-50 dark:bg-blue-900/20",
      border: "border-blue-200 dark:border-blue-800",
      text: "text-blue-800 dark:text-blue-200",
      icon: "text-blue-600 dark:text-blue-400",
    },
  };

  return (
    <div className="space-y-2 mb-6">
      {visibleAlerts.slice(0, 3).map((alert) => {
        const styles = urgencyStyles[alert.urgency];
        const Icon = alert.type === "expiring" ? Clock : Ticket;

        return (
          <div
            key={alert.id}
            className={`flex items-start gap-3 rounded-lg border ${styles.border} ${styles.bg} p-3`}
          >
            <div className={`shrink-0 mt-0.5 ${styles.icon}`}>
              {alert.urgency === "critical" ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <Icon className="h-5 w-5" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className={`font-medium text-sm ${styles.text}`}>
                {alert.title}
              </p>
              <p className={`text-xs mt-0.5 opacity-80 ${styles.text}`}>
                {alert.message}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Link
                href={alert.link}
                className={`text-xs font-medium ${styles.text} hover:underline`}
              >
                {t("alerts.details")}
              </Link>
              <button
                type="button"
                onClick={() => handleDismiss(alert.id)}
                className={`p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ${styles.icon}`}
                title={t("alerts.dismiss")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}

      {visibleAlerts.length > 3 && (
        <Link
          href="/dashboard/klippekort"
          className="block text-center text-sm text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400"
        >
          {t("alerts.more", { count: visibleAlerts.length - 3 })}
        </Link>
      )}
    </div>
  );
}

// Compact inline alert for use in forms/modals
export function KlippekortInlineAlert({
  remainingHours,
  totalHours,
  expiryDate,
}: {
  packageId: string;
  remainingHours: number;
  totalHours: number;
  expiryDate?: Date | null;
}) {
  const t = useTranslations("klippekort");
  const expiryLabel = (days: number): string => {
    if (days < 0) return t("expiry.expiredCap");
    if (days === 0) return t("expiry.todayCap");
    if (days === 1) return t("expiry.tomorrowCap");
    return t("expiry.inDaysCap", { days });
  };
  const isLowBalance = prepaidBalanceLevel(remainingHours, totalHours) !== "ok";
  // Hele danske kalenderdage; 0 = udløber i dag (#736)
  const daysUntilExpiry = prepaidDaysUntilExpiry(expiryDate);
  const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry < 14;

  if (!isLowBalance && !isExpiringSoon) return null;

  return (
    <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <span className="text-amber-800 dark:text-amber-200">
        {isLowBalance &&
          t("alerts.onlyLeft", { hours: remainingHours.toFixed(1) })}
        {isLowBalance && isExpiringSoon && " • "}
        {isExpiringSoon &&
          daysUntilExpiry !== null &&
          expiryLabel(daysUntilExpiry)}
      </span>
    </div>
  );
}
