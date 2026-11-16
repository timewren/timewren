import { Palmtree } from "lucide-react";
import { useTranslations } from "next-intl";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

export function VacationBalanceWidget() {
  const t = useTranslations("dashboard.widgets.vacation");
  const { data, isLoading } = trpc.enterprise.getVacationBalance.useQuery();

  // Indeværende ferieår (kalenderår eller 1/9–31/8 afhængigt af org, #461)
  const today = toLocalDateStr(new Date());
  const current =
    data?.find(
      (b) =>
        (b.periodStart ?? `${b.year}-01-01`) <= today &&
        (b.periodEnd ?? `${b.year}-12-31`) >= today,
    ) ?? data?.[0];
  const remaining = current?.remaining ?? 0;
  const label =
    current?.periodLabel ?? (current?.year ? String(current.year) : null);

  return (
    <div className="h-full rounded-xl border border-gray-200/80 dark:border-gray-800 border-l-4 border-l-cyan-500 dark:border-l-cyan-400 bg-white dark:bg-gray-900 p-4 flex flex-col justify-center">
      <div className="flex items-center gap-2 mb-3">
        <Palmtree className="h-5 w-5 text-tt-graa" />
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {t("title")}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <p
          className={`text-2xl sm:text-3xl font-bold ${
            isLoading
              ? "text-gray-300 dark:text-gray-600"
              : "text-gray-900 dark:text-white"
          }`}
        >
          {isLoading ? "–" : `${remaining.toFixed(1)}`}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {label ? t("daysLeftIn", { label }) : t("daysLeft")}
        </p>
      </div>
    </div>
  );
}
