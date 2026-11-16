"use client";

import { CalendarClock, TrendingDown, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatEffectiveDate } from "@/components/ScheduledRateChanges";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

interface RateHistoryProps {
  clientId?: string;
  projectId?: string;
}

const card =
  "rounded-xl border border-gray-200/80 bg-white p-5 dark:border-gray-800 dark:bg-gray-900";

function money(n: number, locale: string): string {
  return n.toLocaleString(toIntlLocale(locale), { maximumFractionDigits: 0 });
}

export function RateHistory({ clientId, projectId }: RateHistoryProps) {
  const t = useTranslations("settingsRates.history");
  const locale = useLocale();
  const rateTypeLabel: Record<string, string> = {
    global: t("typeGlobal"),
    client: t("typeClient"),
    project: t("typeProject"),
  };
  const { data: history, isLoading } = trpc.rateHistory.getHistory.useQuery({
    clientId,
    projectId,
  });
  // Planlagte (endnu ikke gennemførte) ændringer vises øverst som "Planlagt"
  const { data: planned } = trpc.scheduledRates.list.useQuery(
    projectId ? { projectId } : { clientId },
    { enabled: !!(clientId || projectId) },
  );

  if (isLoading) {
    return (
      <div className={card}>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h3>
        <div className="flex items-center justify-center py-6">
          <InlineSpinner className="h-5 w-5" />
        </div>
      </div>
    );
  }

  // Ingen historik: én rolig linje frem for et helt kort med tom tilstand.
  if ((!history || history.length === 0) && !planned?.length) {
    return (
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("empty")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={card}>
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
        {t("title")}
      </h3>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {planned?.map((change) => (
          <li
            key={change.id}
            className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <CalendarClock className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                <span className="tabular-nums text-gray-900 dark:text-white">
                  → {money(parseFloat(change.newRate), locale)} kr
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t("effectiveFrom", {
                  date: formatEffectiveDate(change.effectiveDate, locale),
                })}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300">
              {t("planned")}
            </span>
          </li>
        ))}
        {(history ?? []).map((entry) => {
          const oldRate = parseFloat(entry.oldRate || "0");
          const newRate = parseFloat(entry.newRate || "0");
          const isIncrease = newRate > oldRate;
          const change = newRate - oldRate;
          const percentageChange =
            oldRate > 0 ? ((change / oldRate) * 100).toFixed(1) : null;

          return (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {isIncrease ? (
                    <TrendingUp className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                  ) : (
                    <TrendingDown className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                  )}
                  <span className="tabular-nums text-gray-900 dark:text-white">
                    {oldRate > 0 ? `${money(oldRate, locale)} kr` : t("noRate")}{" "}
                    → {money(newRate, locale)} kr
                  </span>
                  {percentageChange !== null && (
                    <span
                      className={`text-xs font-medium ${
                        isIncrease
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {isIncrease ? "+" : ""}
                      {percentageChange} %
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {new Date(entry.effectiveDate).toLocaleDateString(
                    toIntlLocale(locale),
                    {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    },
                  )}
                  {entry.reason && ` · ${entry.reason}`}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {rateTypeLabel[entry.rateType] ?? entry.rateType}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
