import { TrendingUp } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatCurrency, formatTime } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function TopClientsWidget() {
  const t = useTranslations("dashboard.widgets.topClients");
  const { data: topClients, isError } = trpc.clients.getTopClients.useQuery({
    limit: 5,
    sortBy: "hours",
  });

  if (isError || !topClients || topClients.length === 0) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<TrendingUp className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            {isError ? t("loadFailed") : t("none")}
          </p>
        </div>
      </DashboardWidget>
    );
  }

  const maxHours = Math.max(...topClients.map((c) => c.totalHours));

  return (
    <DashboardWidget
      title={t("title")}
      icon={<TrendingUp className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href="/dashboard/kunder"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("seeAll")}
        </Link>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("rankedBy")}
        </p>
        <div className="space-y-3">
          {topClients.map((client, index) => {
            const percentage =
              maxHours > 0 ? (client.totalHours / maxHours) * 100 : 0;

            return (
              <Link
                key={client.id}
                href={`/dashboard/kunder/${client.id}`}
                className="block group"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-tt-gran-lys text-xs font-semibold text-brand-600 dark:text-brand-400">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                      {client.name}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {formatTime(client.totalHours)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      {formatCurrency(client.totalRevenue)}
                    </p>
                  </div>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-600 dark:bg-brand-500 transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </DashboardWidget>
  );
}
