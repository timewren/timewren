"use client";

import { Radio, Timer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useElectricShape } from "@/hooks/useElectricShape";
import { useElectricTimer } from "@/hooks/useElectricTimer";
import { toIntlLocale } from "@/i18n/format-locale";

/**
 * ElectricSQL spike demo page (issue #260, beta-only). Shows multiple surfaces
 * syncing live via Electric — the user's timer + a live time-entries feed — as
 * a visible proof of the "more live" direction. Read-only; does not touch the
 * real timer/time logic. On prod this page isn't built (code lives on
 * develop/beta) and the shapes return 503/404, so the hooks show "not live".
 */

interface TimeEntryRow {
  id: string;
  description: string | null;
  hours: string | null;
  date: string | null;
  created_at: string | null;
  project_id: string | null;
  client_id: string | null;
}

function formatTime(iso: string | null, intlLocale: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function ElectricLivePage() {
  const t = useTranslations("team.electricLive");
  const intlLocale = toIntlLocale(useLocale());
  const timer = useElectricTimer();
  const { connected: entriesConnected, rows: entries } =
    useElectricShape<TimeEntryRow>("time-entries", "time_entries");

  const recent = [...entries]
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, 15);

  const live = timer.connected || entriesConnected;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
          <Radio className="h-5 w-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t("title")}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("description")}
          </p>
        </div>
      </div>

      {!live && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-300">
          {t("notEnabled")}
        </div>
      )}

      {/* Live timer */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Timer className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white">
            {t("yourTimer")}
          </h2>
          <StatusDot connected={timer.connected} />
        </div>
        {timer.row ? (
          <div className="flex items-center gap-4 text-sm">
            <span
              className={`rounded-full px-2.5 py-0.5 font-medium ${
                timer.row.is_running
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
              }`}
            >
              {timer.row.is_running ? t("running") : t("stopped")}
            </span>
            <span className="text-gray-500 dark:text-gray-400 tabular-nums">
              {t("version", { version: timer.row.version })}
            </span>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("noTimerRow")}
          </p>
        )}
      </div>

      {/* Live time entries */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            {t("recentEntries")}
          </h2>
          <StatusDot connected={entriesConnected} />
          <span className="text-xs text-gray-400">
            {t("totalCount", { count: entries.length })}
          </span>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("noEntries")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {recent.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 py-2 text-sm animate-in fade-in slide-in-from-top-1 duration-300"
              >
                <span className="w-20 shrink-0 text-gray-400 tabular-nums">
                  {formatTime(e.created_at, intlLocale)}
                </span>
                <span className="flex-1 truncate text-gray-900 dark:text-white">
                  {e.description || t("noDescription")}
                </span>
                <span className="shrink-0 font-medium text-gray-600 dark:text-gray-300 tabular-nums">
                  {e.hours
                    ? t("hoursShort", {
                        hours: Number(e.hours).toLocaleString(intlLocale),
                      })
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusDot({ connected }: { connected: boolean }) {
  const t = useTranslations("team.electricLive");
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${
        connected
          ? "text-green-600 dark:text-green-400"
          : "text-gray-400 dark:text-gray-500"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-gray-300 dark:bg-gray-600"}`}
      />
      {connected ? t("live") : t("offline")}
    </span>
  );
}
