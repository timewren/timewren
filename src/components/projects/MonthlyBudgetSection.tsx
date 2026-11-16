"use client";

import { Gauge } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { budgetHealthStatus } from "@/lib/projects/budget";
import { trpc } from "@/providers/trpc-provider";

// Tærsklerne kommer fra @/lib/projects/budget — 80/100 %, samme som
// projektlisten, budget-baren, rapporten og advarsels-cronen (#592).
const BAR_COLORS = {
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
} as const;

function formatHours(hours: number, locale: string): string {
  return hours.toLocaleString(toIntlLocale(locale), {
    maximumFractionDigits: 1,
  });
}

function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(
    toIntlLocale(locale),
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  );
}

/**
 * Månedligt timebudget på et projekt: forbrug i indeværende måned mod
 * budgettet + historik over tidligere måneder. Budgettet "nulstilles"
 * automatisk pr. påbegyndt måned, fordi forbruget beregnes pr. kalendermåned.
 */
export function MonthlyBudgetSection({ projectId }: { projectId: string }) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const { data, isLoading } = trpc.projects.monthlyBudget.useQuery({
    projectId,
    months: 12,
  });

  if (isLoading) {
    return (
      <div className="h-40 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
    );
  }

  if (!data?.budgetHours) return null;

  const [current, ...history] = data.months;
  const currentPct = current?.percentage ?? 0;
  const color = current?.healthStatus ?? budgetHealthStatus(currentPct);
  const shownHistory = history.filter(
    (m, i) => m.hours > 0 || i < 3, // always show the last 3 months, older only if used
  );

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("monthlyBudget.title")}
        </h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("monthlyBudget.hint", {
            hours: formatHours(data.budgetHours, locale),
          })}
        </span>
      </div>

      {/* Current month */}
      <div className="mb-6">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">
            {current ? monthLabel(current.month, locale) : ""}
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {t("monthlyBudget.usage", {
              used: formatHours(current?.hours ?? 0, locale),
              budget: formatHours(data.budgetHours, locale),
              pct: currentPct,
            })}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div
            className={`h-full rounded-full transition-all ${BAR_COLORS[color]}`}
            style={{ width: `${Math.min(100, currentPct)}%` }}
          />
        </div>
        {currentPct >= 100 && (
          <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
            {t("monthlyBudget.overrun", {
              hours: formatHours(
                (current?.hours ?? 0) - data.budgetHours,
                locale,
              ),
            })}
          </p>
        )}
      </div>

      {/* History */}
      {shownHistory.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t("monthlyBudget.previous")}
          </h3>
          <div className="space-y-2">
            {shownHistory.map((m) => {
              const pct = m.percentage ?? 0;
              return (
                <div key={m.month} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-sm text-gray-600 dark:text-gray-400 capitalize">
                    {monthLabel(m.month, locale)}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div
                      className={`h-full rounded-full ${BAR_COLORS[m.healthStatus ?? budgetHealthStatus(pct)]}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right text-sm tabular-nums text-gray-600 dark:text-gray-400">
                    {t("monthlyBudget.hoursPct", {
                      hours: formatHours(m.hours, locale),
                      pct,
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
