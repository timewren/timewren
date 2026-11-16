"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  TIMER_REJECTION_EVENTS,
  type TimerEventName,
} from "@/lib/timer/event-names";
import { trpc } from "@/providers/trpc-provider";

const RANGES = [
  { id: "24h", labelKey: "timerEvents.range24h", hours: 24 },
  { id: "7d", labelKey: "timerEvents.range7d", hours: 24 * 7 },
  { id: "30d", labelKey: "timerEvents.range30d", hours: 24 * 30 },
] as const;

export function UserTimerEvents({ userId }: { userId: string }) {
  const t = useTranslations("adminUsers");
  const locale = useLocale();
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(toIntlLocale(locale), {
        timeZone: "Europe/Copenhagen",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    [locale],
  );
  const fmt = (value: Date | string | null | undefined): string => {
    if (!value) return "–";
    const d = typeof value === "string" ? new Date(value) : value;
    return Number.isNaN(d.getTime()) ? "–" : timeFmt.format(d);
  };
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]["id"]>("7d");
  // Fast "fra" pr. valgt interval, så query-nøglen ikke skifter hvert render.
  const from = useMemo(() => {
    const hours = RANGES.find((r) => r.id === rangeId)?.hours ?? 24 * 7;
    return new Date(Date.now() - hours * 3600 * 1000);
  }, [rangeId]);

  const { data, isLoading, error, refetch, isFetching } =
    trpc.admin.timerEvents.useQuery({ userId, from });

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {t("timerEvents.title")}
          </h3>
          <p className="text-xs text-gray-500">{t("timerEvents.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRangeId(r.id)}
              aria-pressed={rangeId === r.id}
              className={`min-h-[32px] rounded-md px-3 text-xs font-medium ${
                rangeId === r.id
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {t(r.labelKey)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="min-h-[32px] rounded-md border border-gray-300 px-3 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t("timerEvents.refresh")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : error ? (
        <p className="p-4 text-sm text-red-600">
          {t("timerEvents.loadFailed", { message: error.message })}
        </p>
      ) : !data?.length ? (
        <p className="p-4 text-sm text-gray-500">{t("timerEvents.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">
                  {t("timerEvents.colTime")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("timerEvents.colEvent")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("timerEvents.colSource")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("timerEvents.colVersion")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("timerEvents.colTimerStart")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("timerEvents.colProject")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("timerEvents.colDetails")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((e) => {
                const name = e.event as TimerEventName;
                const rejected = TIMER_REJECTION_EVENTS.has(name);
                return (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-700">
                      {fmt(e.createdAt)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 font-medium ${
                        rejected ? "text-red-700" : "text-gray-900"
                      }`}
                      title={e.event}
                    >
                      {t.has(`timerEvents.events.${name}`)
                        ? t(`timerEvents.events.${name}`)
                        : e.event}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                      {e.source}
                      {e.clientHint ? (
                        <span className="block text-gray-400">
                          {e.clientHint}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-700">
                      {e.versionBefore ?? "–"} → {e.versionAfter ?? "–"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-700">
                      {fmt(e.startTime)}
                      {e.baseSeconds ? (
                        <span className="block text-gray-400">
                          {t("timerEvents.minutesBefore", {
                            minutes: Math.round(e.baseSeconds / 60),
                          })}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {e.projectName ??
                        (e.projectId ? t("timerEvents.deleted") : "–")}
                      <span className="block text-gray-400">
                        {e.clientName ??
                          (e.clientId ? t("timerEvents.deleted") : "")}
                      </span>
                    </td>
                    <td className="max-w-xs break-all px-3 py-2 font-mono text-[11px] text-gray-500">
                      {e.detail ? JSON.stringify(e.detail) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
