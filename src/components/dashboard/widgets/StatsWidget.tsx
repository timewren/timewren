import { Clock, DollarSign, FolderKanban, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import type { WidgetType } from "@/types/dashboard";

interface StatsWidgetProps {
  type: Extract<
    WidgetType,
    "stats-clients" | "stats-projects" | "stats-hours" | "stats-revenue"
  >;
}

export function StatsWidget({ type }: StatsWidgetProps) {
  const t = useTranslations("dashboard.widgets.stats");
  const intlLocale = toIntlLocale(useLocale());
  // Beregnes pr. render — på modulniveau frøs måneden ved første load, og
  // bureauer har fanen åben hen over månedsskift.
  const currentMonth = new Date().toLocaleDateString(intlLocale, {
    month: "long",
    year: "numeric",
  });
  const clientsQ = trpc.clients.count.useQuery(undefined, {
    enabled: type === "stats-clients",
  });
  const projectsQ = trpc.projects.count.useQuery(undefined, {
    enabled: type === "stats-projects",
  });
  const hoursQ = trpc.time.monthlyHours.useQuery(undefined, {
    enabled: type === "stats-hours",
  });
  const revenueQ = trpc.time.monthlyRevenue.useQuery(undefined, {
    enabled: type === "stats-revenue",
  });
  const activeQ = {
    "stats-clients": clientsQ,
    "stats-projects": projectsQ,
    "stats-hours": hoursQ,
    "stats-revenue": revenueQ,
  }[type];
  // "0" under load/fejl lignede et tomt firma — vis "—" indtil tallet er der
  const pending = activeQ.isLoading || activeQ.isError;
  const clientsCount = clientsQ.data;
  const projectsCount = projectsQ.data;
  const monthlyHours = hoursQ.data;
  const monthlyRevenue = revenueQ.data;

  const config = {
    "stats-clients": {
      name: t("activeClients"),
      value: pending ? "…" : (clientsCount?.toString() ?? "0"),
      icon: Users,
      iconColor: "text-tt-graa",
      iconBg: "bg-tt-flade",
      subtitle: currentMonth,
    },
    "stats-projects": {
      name: t("activeProjects"),
      value: pending ? "…" : (projectsCount?.toString() ?? "0"),
      icon: FolderKanban,
      iconColor: "text-tt-graa",
      iconBg: "bg-tt-flade",
      subtitle: currentMonth,
    },
    "stats-hours": {
      name: t("hoursThisMonth"),
      value: pending ? "…" : (monthlyHours?.toString() ?? "0"),
      icon: Clock,
      iconColor: "text-tt-graa",
      iconBg: "bg-tt-flade",
      subtitle: currentMonth,
    },
    "stats-revenue": {
      name: t("revenueThisMonth"),
      value: pending ? "…" : formatCurrency(monthlyRevenue ?? 0),
      icon: DollarSign,
      iconColor: "text-tt-graa",
      iconBg: "bg-tt-flade",
      subtitle: currentMonth,
    },
  }[type];

  const Icon = config.icon;

  return (
    <div className="h-full rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col justify-center">
      {/* Label + Icon row */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {config.name}
        </span>
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${config.iconBg}`}
        >
          <Icon className={`h-4 w-4 ${config.iconColor}`} />
        </div>
      </div>

      {/* Value */}
      <p className="text-3xl font-bold tabular-nums text-gray-900 dark:text-white">
        {config.value}
      </p>

      {/* Subtitle */}
      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
        {config.subtitle}
      </p>
    </div>
  );
}
