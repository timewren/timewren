"use client";

import { useState } from "react";
import { CohortHeatmap } from "@/components/admin/CohortHeatmap";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { trpc } from "@/providers/trpc-provider";

const MONTH_OPTIONS = [6, 12, 18, 24] as const;

export default function RetentionPage() {
  const [months, setMonths] = useState<number>(12);

  const { data, isLoading } = trpc.admin.getCohortRetention.useQuery({
    months,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Kohort-retention
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Andel af brugere med mindst 1 tidsregistrering pr. maaned
        </p>
      </div>

      <div className="flex gap-2">
        {MONTH_OPTIONS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMonths(m)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              months === m
                ? "bg-tt-gran text-tt-paa-gran"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            }`}
          >
            {m} mdr
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <InlineSpinner className="h-8 w-8" />
            </div>
          ) : data?.cohorts && data.cohorts.length > 0 ? (
            <CohortHeatmap cohorts={data.cohorts} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                Ingen kohorte-data fundet for de valgte {months} maaneder.
              </p>
              <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
                Der skal vaere brugere med tidsregistreringer for at vise
                retention.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
