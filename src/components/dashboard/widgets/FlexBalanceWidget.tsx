import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { trpc } from "@/providers/trpc-provider";

export function FlexBalanceWidget() {
  const t = useTranslations("dashboard.widgets.flexBalance");
  const { data, isLoading } = trpc.enterprise.getBalance.useQuery();

  const balance = data?.balance ?? 0;
  const isPositive = balance >= 0;
  const colorClass = isPositive
    ? "text-green-600 dark:text-green-400"
    : "text-red-600 dark:text-red-400";
  const borderClass = isPositive
    ? "border-l-green-500 dark:border-l-green-400"
    : "border-l-red-500 dark:border-l-red-400";

  return (
    <div
      className={`h-full rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 ${borderClass} bg-white dark:bg-gray-900 p-4 shadow-sm flex flex-col justify-center`}
    >
      <div className="flex items-center gap-2 mb-3">
        <Clock className={`h-5 w-5 ${colorClass}`} />
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {t("title")}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <p
          className={`text-2xl sm:text-3xl font-bold ${isLoading ? "text-gray-300 dark:text-gray-600" : colorClass}`}
        >
          {isLoading
            ? "–"
            : t("hours", {
                value: `${isPositive ? "+" : ""}${balance.toFixed(1)}`,
              })}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {t("entries", { count: data?.totalEntries ?? 0 })}
        </p>
      </div>
    </div>
  );
}
