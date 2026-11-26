"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { formatReportHours } from "@/lib/reports/columns";
import { CLIENT_PERIODS } from "@/lib/reports/date-range";
import { trpc } from "@/providers/trpc-provider";

type Period = (typeof CLIENT_PERIODS)[number];

const fieldClass =
  "min-h-11 w-full rounded-lg border border-gray-500 bg-white px-3 text-base text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:bg-gray-900 dark:text-gray-100";

export function ClientPeriodHours({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.detail.periodHours");
  const toolbar = useTranslations("reports.toolbar");
  const common = useTranslations("common");
  const locale = useLocale();
  const fieldId = useId();
  const [dateRange, setDateRange] = useState<Period>("thisMonth");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const custom = dateRange === "custom";
  const reversed = !!customStart && !!customEnd && customStart > customEnd;
  const ready = !custom || (!!customStart && !!customEnd && !reversed);

  const { data, isError, refetch } = trpc.clients.getPeriodHours.useQuery(
    {
      clientId,
      dateRange,
      customStart: custom ? customStart || undefined : undefined,
      customEnd: custom ? customEnd || undefined : undefined,
    },
    { enabled: ready },
  );

  return (
    <section
      aria-labelledby={`${fieldId}-title`}
      className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id={`${fieldId}-title`} className="text-lg font-semibold">
          {t("title")}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium">
            {toolbar("period")}
            <select
              className={fieldClass}
              value={dateRange}
              onChange={(event) => setDateRange(event.target.value as Period)}
            >
              {CLIENT_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {period === "lastYear" ? t("lastYear") : toolbar(period)}
                </option>
              ))}
            </select>
          </label>
          {custom && (
            <>
              <label className="grid gap-1 text-sm font-medium">
                {toolbar("from")}
                <input
                  type="date"
                  className={fieldClass}
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                {toolbar("to")}
                <input
                  type="date"
                  className={fieldClass}
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  aria-invalid={reversed}
                  aria-describedby={reversed ? `${fieldId}-error` : undefined}
                />
              </label>
            </>
          )}
        </div>
      </div>

      <div aria-live="polite" className="mt-4 min-h-10 text-sm">
        {!ready ? (
          <p id={`${fieldId}-error`}>
            {reversed ? toolbar("dateOrder") : t("chooseDates")}
          </p>
        ) : isError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p>{t("loadError")}</p>
            <button
              type="button"
              className="min-h-11 underline underline-offset-2"
              onClick={() => void refetch()}
            >
              {t("retry")}
            </button>
          </div>
        ) : data ? (
          <>
            <dl className="divide-y divide-gray-200 dark:divide-gray-800">
              <div className="flex justify-between gap-4 py-2 text-base font-semibold">
                <dt>{t("total")}</dt>
                <dd className="shrink-0 tabular-nums">
                  {formatReportHours(data.totalHours, locale)}
                </dd>
              </div>
              {data.projects.map(({ projectId, projectName, hours: value }) => (
                <div
                  key={projectId ?? "unassigned"}
                  className="flex justify-between gap-4 py-2"
                >
                  <dt className="min-w-0 wrap-anywhere">
                    {projectName ?? t("noProject")}
                  </dt>
                  <dd className="shrink-0 tabular-nums">
                    {formatReportHours(value, locale)}
                  </dd>
                </div>
              ))}
            </dl>
            {data.projects.length === 0 && <p className="py-2">{t("empty")}</p>}
          </>
        ) : (
          <p>{common("loading")}</p>
        )}
      </div>
    </section>
  );
}
