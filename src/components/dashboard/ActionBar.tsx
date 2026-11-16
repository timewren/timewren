"use client";

import { AlertTriangle, Clock, CreditCard, FileText } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useModules } from "@/hooks/useModules";
import { formatCurrency } from "@/lib/format";
import { isPrepaidBalanceLow } from "@/lib/prepaid/balance";
import { prepaidDaysUntilExpiry } from "@/lib/prepaid/expiry";
import { trpc } from "@/providers/trpc-provider";

interface AlertItem {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  icon: typeof AlertTriangle;
  href: string;
}

export function ActionBar() {
  const t = useTranslations("dashboard.actionBar");
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const staleTime = 5 * 60 * 1000;

  const { data: tasks } = trpc.tasks.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("tasks"),
    staleTime,
  });
  const { data: prepaidPackages } = trpc.prepaid.list.useQuery(
    { activeOnly: true },
    {
      enabled: !modulesPlaceholder && isModuleEnabled("klippekort"),
      staleTime,
    },
  );
  const { data: clientsWithStats } = trpc.clients.listWithStats.useQuery(
    undefined,
    { enabled: !modulesPlaceholder && isModuleEnabled("clients"), staleTime },
  );

  const alerts = useMemo(() => {
    const items: AlertItem[] = [];

    // 1. Overdue tasks
    if (tasks) {
      const overdueTasks = tasks.filter(
        (t) =>
          t.deadline !== null &&
          new Date(t.deadline) < new Date() &&
          t.status !== "done",
      );
      if (overdueTasks.length > 0) {
        items.push({
          id: "overdue-tasks",
          title: t("overdueTasks", { count: overdueTasks.length }),
          subtitle: t("needsAttention"),
          color: "#ef4444",
          icon: AlertTriangle,
          href: "/dashboard/tasks",
        });
      }
    }

    // 2. Low balance klippekort
    if (prepaidPackages) {
      const lowBalance = prepaidPackages.filter((pkg) => {
        const remaining = Number.parseFloat(String(pkg.remainingHours));
        const total = Number.parseFloat(String(pkg.totalHours));
        return isPrepaidBalanceLow(remaining, total);
      });
      if (lowBalance.length > 0) {
        items.push({
          id: "low-balance",
          title: t("lowBalance", { count: lowBalance.length }),
          subtitle: t("lowBalanceSub"),
          color: "#f59e0b",
          icon: CreditCard,
          href: "/dashboard/klippekort",
        });
      }
    }

    // 3. Expiring klippekort (within 14 days)
    if (prepaidPackages) {
      const now = new Date();
      // Udløbsdagen tæller med (kortet gælder hele dagen, #736)
      const expiring = prepaidPackages.filter((pkg) => {
        const days = prepaidDaysUntilExpiry(pkg.expiryDate, now);
        return days !== null && days >= 0 && days <= 14;
      });
      if (expiring.length > 0) {
        items.push({
          id: "expiring-packages",
          title: t("expiring", { count: expiring.length }),
          subtitle: t("expiringSub"),
          color: "#f59e0b",
          icon: Clock,
          href: "/dashboard/klippekort",
        });
      }
    }

    // 4. Unbilled time
    if (clientsWithStats) {
      const totalUnbilled = clientsWithStats.reduce(
        (sum, client) => sum + (client.stats.unbilledAmount ?? 0),
        0,
      );
      if (totalUnbilled > 0) {
        items.push({
          id: "unbilled-time",
          title: t("unbilled", { amount: formatCurrency(totalUnbilled) }),
          subtitle: t("unbilledSub"),
          // Ikke en status, så neutral (docs/BRAND.md → Ikoner)
          color: "var(--tt-graa)",
          icon: FileText,
          // Åbner "Fra tidsregistreringer" direkte i stedet for fakturalisten
          href: "/dashboard/invoices?fraTid=1",
        });
      }
    }

    return items;
  }, [tasks, prepaidPackages, clientsWithStats, t]);

  if (alerts.length === 0) return null;

  return (
    <section aria-label={t("title")} className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        {t("title")}
      </h3>
      {/* biome-ignore lint/a11y/useSemanticElements: rollen sidder på en container uden ul/ol-styling (reset), og punkterne er knapper/links; ul/li ville ændre layoutet */}
      <div className="flex gap-3 overflow-x-auto pb-1" role="list">
        {alerts.map((alert) => (
          <Link
            key={alert.id}
            href={alert.href}
            role="listitem"
            className="flex-shrink-0 min-w-[220px] flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-xl hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
            style={{ borderLeftWidth: "3px", borderLeftColor: alert.color }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: `color-mix(in srgb, ${alert.color} 9%, transparent)`,
              }}
            >
              <alert.icon className="h-4 w-4" style={{ color: alert.color }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                {alert.title}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {alert.subtitle}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
