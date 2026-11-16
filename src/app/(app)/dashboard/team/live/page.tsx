"use client";

import { Circle, Clock, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useTeamRealtime } from "@/hooks/useTeamRealtime";
import { trpc } from "@/providers/trpc-provider";

function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

interface LiveRow {
  userId: string;
  userName: string;
  isRunning: boolean;
  startTime: string | null;
  elapsedSeconds: number;
  baseSeconds: number;
  description: string;
  projectName: string | null;
  clientName: string | null;
}

function liveElapsed(row: LiveRow, nowMs: number): number {
  if (!row.isRunning) return row.elapsedSeconds;
  if (!row.startTime) return row.elapsedSeconds;
  const sessionSeconds = Math.floor(
    (nowMs - new Date(row.startTime).getTime()) / 1000,
  );
  return (row.baseSeconds ?? 0) + Math.max(0, sessionSeconds);
}

export default function TeamLivePage() {
  const t = useTranslations("team.live");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const { data, isLoading, isError } = trpc.team.liveTimers.useQuery(
    undefined,
    {
      // Polling baseline; SSE "team" events refresh instantly when enabled.
      refetchInterval: 15000,
    },
  );

  useTeamRealtime(() => {
    utils.team.liveTimers.invalidate();
  });

  // Tick once per second so running timers count up live.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const rows = (data ?? []) as LiveRow[];
  const active = rows
    .filter((r) => r.isRunning)
    .sort((a, b) => liveElapsed(b, nowMs) - liveElapsed(a, nowMs));
  const idle = rows
    .filter((r) => !r.isRunning)
    .sort((a, b) => a.userName.localeCompare(b.userName, locale));

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <Users className="h-6 w-6 text-gray-500 dark:text-gray-400" />
        <div>
          <h1 className="font-semibold text-gray-900 text-xl dark:text-gray-100">
            {t("title")}
          </h1>
          <p className="text-gray-500 text-sm dark:text-gray-400">
            {t("tracking", { count: active.length })}
          </p>
        </div>
      </header>

      {isLoading && (
        <p className="text-gray-500 text-sm dark:text-gray-400">
          {t("loading")}
        </p>
      )}
      {isError && (
        <p className="text-red-600 text-sm dark:text-red-400">
          {t("loadError")}
        </p>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
          <Users className="h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">
            {t("noMembers")}
          </p>
        </div>
      )}

      {active.length > 0 && (
        <section className="space-y-2">
          {active.map((r) => (
            <div
              key={r.userId}
              className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-900/40 dark:bg-green-950/20"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Circle className="h-2.5 w-2.5 animate-pulse fill-green-500 text-green-500" />
                  <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                    {r.userName}
                  </span>
                </div>
                <p className="truncate text-gray-500 text-sm dark:text-gray-400">
                  {[r.clientName, r.projectName, r.description]
                    .filter(Boolean)
                    .join(" · ") || t("internalTime")}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-gray-900 text-sm tabular-nums dark:text-gray-100">
                <Clock className="h-3.5 w-3.5 text-gray-400" />
                {formatElapsed(liveElapsed(r, nowMs))}
              </div>
            </div>
          ))}
        </section>
      )}

      {idle.length > 0 && (
        <section className="space-y-1">
          <h2 className="px-1 font-medium text-gray-400 text-xs uppercase tracking-wide dark:text-gray-500">
            {t("inactive")}
          </h2>
          {idle.map((r) => (
            <div
              key={r.userId}
              className="flex items-center justify-between rounded-lg px-4 py-2"
            >
              <div className="flex items-center gap-2">
                <Circle className="h-2.5 w-2.5 fill-gray-300 text-gray-300 dark:fill-gray-600 dark:text-gray-600" />
                <span className="text-gray-600 dark:text-gray-300">
                  {r.userName}
                </span>
              </div>
              <span className="text-gray-400 text-sm dark:text-gray-500">
                {t("notActive")}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
