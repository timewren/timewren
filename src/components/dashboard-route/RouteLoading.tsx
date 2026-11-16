"use client";

import { useTranslations } from "next-intl";

/**
 * Fælles skelet for dashboardets ruter (loading.tsx i hver rute
 * re-eksporterer det): overskrift, værktøjslinje og en liste, så navigation
 * giver øjeblikkelig respons, mens siden hentes.
 */
export function RouteLoading() {
  const t = useTranslations("shell.route");
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only" role="status">
        {t("loading")}
      </span>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-9 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          <div className="h-5 w-64 max-w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="hidden h-10 w-32 animate-pulse rounded-lg bg-gray-200 sm:block dark:bg-gray-700" />
      </div>

      <div className="h-10 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="space-y-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
