"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CoverageBar } from "@/components/coverage/CoverageParts";
import {
  coverageTone,
  fmtPct,
  useCoverageFormat,
} from "@/components/coverage/coverage-format";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";
import { isGenuinePause, useTimerStore } from "@/stores/timerStore";
import { formatDuration, formatRange } from "./home-logic";

/**
 * "I dag": dagens egne poster kompakt + dækningsgraden for dagen (#692).
 * Dato og dag afgøres på serveren i dansk tid (copenhagen.ts).
 */
export function HomeToday() {
  const t = useTranslations("home.today");
  const fmt = useCoverageFormat();
  const tHome = useTranslations("home");
  const intlLocale = toIntlLocale(useLocale());
  const units = {
    h: tHome("duration.hourUnit"),
    min: tHome("duration.minUnit"),
  };
  const { data, isLoading, isError } = trpc.dashboard.homeToday.useQuery(
    undefined,
    // Tid gemmes mange steder, der kun invaliderer time.* — hent frisk
    { refetchOnMount: "always", refetchOnWindowFocus: true },
  );
  // Tidsposter ændres mange steder — hent frisk ved hver visning (som widget'en)
  const { data: coverage } = trpc.coverage.getSummary.useQuery(
    { period: "day" },
    { refetchOnMount: "always", refetchOnWindowFocus: true },
  );
  const isRunning = useTimerStore((s) => s.isRunning);
  const paused = useTimerStore((s) => isGenuinePause(s));
  const resumeAsSegment = useTimerStore((s) => s.resumeAsSegment);

  const dateLabel = data
    ? new Date(`${data.date}T12:00:00`).toLocaleDateString(intlLocale, {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : null;
  const hasExpected = !!coverage && coverage.expectedHours > 0;

  return (
    <section
      aria-labelledby="hjem-i-dag"
      className="rounded-xl border border-gray-200/80 bg-white p-4 sm:p-5 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="hjem-i-dag"
          className="text-sm font-semibold text-gray-900 dark:text-white"
        >
          {t("title")}
          {dateLabel && (
            <span className="ml-2 font-normal text-gray-600 dark:text-gray-400">
              {dateLabel}
            </span>
          )}
        </h2>
        {data && (
          <p className="text-sm tabular-nums text-gray-700 dark:text-gray-300">
            <span className="font-semibold text-gray-900 dark:text-white">
              {formatDuration(data.totalHours, units)}
            </span>
            {hasExpected && (
              <>
                {" "}
                {t("ofExpected", {
                  duration: formatDuration(coverage.expectedHours, units),
                })}
                {" · "}
                <span
                  className={`font-semibold ${coverageTone(coverage.coveragePct)}`}
                >
                  {fmtPct(coverage.coveragePct, fmt)}
                </span>
              </>
            )}
          </p>
        )}
      </div>

      {hasExpected && (
        <CoverageBar
          className="mt-3 h-2"
          billableHours={coverage.billableHours}
          nonBillableHours={coverage.nonBillableHours}
          expectedHours={coverage.expectedHours}
        />
      )}

      {isLoading ? (
        <ul className="mt-4 space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </ul>
      ) : isError || !data ? (
        <p className="mt-4 text-sm text-red-700 dark:text-red-400">
          {t("loadFailed")}
        </p>
      ) : data.entries.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
          {data.entries.map((e) => {
            const range = formatRange(e.startTime, e.endTime, intlLocale);
            const where = [e.clientName, e.projectName]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <div className="w-20 shrink-0 text-right tabular-nums">
                  <span className="block text-sm font-medium text-gray-900 dark:text-white">
                    {formatDuration(e.hours, units)}
                  </span>
                  {range && (
                    <span className="block text-xs text-gray-600 dark:text-gray-400">
                      {range}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-900 dark:text-white">
                    {e.description || tHome("noDescription")}
                  </span>
                  <span className="block truncate text-xs text-gray-600 dark:text-gray-400">
                    {where || t("internal")}
                  </span>
                </div>
                {/* Fakturerede poster er låst (#702) og kan ikke fortsættes */}
                {!e.isBilled && (
                  <button
                    type="button"
                    disabled={isRunning || paused}
                    onClick={() => {
                      resumeAsSegment({
                        entryId: e.id,
                        projectId: e.projectId ?? undefined,
                        clientId: e.clientId ?? undefined,
                        description: e.description,
                        taskId: e.taskId ?? undefined,
                      });
                      toast.success(t("resumeToast"));
                    }}
                    aria-label={t("continueLabel", {
                      name: e.description || t("continueFallback"),
                    })}
                    title={t("continueTitle")}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-brand-300"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link
          href="/dashboard/time"
          className="font-medium text-brand-700 hover:underline dark:text-brand-400"
        >
          {t("allEntries")}
        </Link>
        <Link
          href="/dashboard/time/new"
          className="font-medium text-brand-700 hover:underline dark:text-brand-400"
        >
          {t("fullForm")}
        </Link>
      </div>
    </section>
  );
}
