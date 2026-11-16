import { FileText } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatCurrency, formatTime } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function UnbilledTimeWidget() {
  const t = useTranslations("dashboard.widgets.unbilled");
  const { data: unbilledStats, isError } = trpc.time.unbilledStats.useQuery();

  if (isError || !unbilledStats || unbilledStats.count === 0) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={
          <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        }
      >
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            {isError ? t("loadFailed") : t("none")}
          </p>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget
      title={t("title")}
      variant="warning"
      icon={<FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
      actions={
        <Link
          href="/dashboard/time"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("seeAll")}
        </Link>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("entries", { count: unbilledStats.count })}
        </p>
        <div className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-900 p-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("totalHours")}
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatTime(unbilledStats.hours)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("estimatedValue")}
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(unbilledStats.value)}
            </p>
          </div>
        </div>
      </div>
    </DashboardWidget>
  );
}
