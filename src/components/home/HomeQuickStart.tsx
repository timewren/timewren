"use client";

import { History, Play } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";
import { isGenuinePause, useTimerStore } from "@/stores/timerStore";
import { quickStartLabel } from "./home-logic";

/**
 * Hurtigstart: én klik = timeren kører på et af de mest brugte projekter.
 * Starter KUN via timerStore — TimeTrackingBar's useTimerSync sender starten
 * til serveren (atomisk one-running-timer-guard). Ingen direkte skrivning til
 * timerStates herfra.
 */
export function HomeQuickStart({ showProjects }: { showProjects: boolean }) {
  const t = useTranslations("home.quickStart");
  const tHome = useTranslations("home");
  const isRunning = useTimerStore((s) => s.isRunning);
  const paused = useTimerStore((s) => isGenuinePause(s));
  const startTimer = useTimerStore((s) => s.startTimer);
  const resumeAsSegment = useTimerStore((s) => s.resumeAsSegment);
  const busy = isRunning || paused;

  const { data: allItems, isLoading } = trpc.dashboard.homeQuickStart.useQuery(
    undefined,
    { staleTime: 60_000, refetchOnMount: "always" },
  );
  const { data: recent } = trpc.time.getRecent.useQuery({ limit: 1 });
  // Projektmodulet slået fra: start aldrig en timer på et projekt herfra
  const items = showProjects ? allItems : allItems?.filter((i) => !i.projectId);
  const lastCandidate = recent?.[0];
  const last =
    lastCandidate && (showProjects || !lastCandidate.projectId)
      ? lastCandidate
      : undefined;

  return (
    <section
      aria-labelledby="hjem-hurtigstart"
      className="rounded-xl border border-gray-200/80 bg-white p-4 sm:p-5 dark:border-gray-800 dark:bg-gray-900"
      data-tour="hjem-hurtigstart"
    >
      <h2
        id="hjem-hurtigstart"
        className="text-sm font-semibold text-gray-900 dark:text-white"
      >
        {t("title")}
      </h2>

      {busy && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          {isRunning ? t("running") : t("paused")}
        </p>
      )}

      {last && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            resumeAsSegment({
              entryId: last.entryId,
              projectId: last.projectId ?? undefined,
              clientId: last.clientId ?? undefined,
              description: last.description,
              taskId: last.taskId ?? undefined,
            });
            toast.success(t("resumeToast"));
          }}
          className="mt-3 flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-left transition-colors hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-600 dark:bg-tt-gran-lys dark:hover:bg-tt-gran-lys"
        >
          <History
            className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-300"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-brand-800 dark:text-brand-200">
              {t("continueLast")}
            </span>
            <span className="block truncate text-sm text-gray-900 dark:text-white">
              {last.description || tHome("noDescription")}
            </span>
            {(last.clientName || last.projectName) && (
              <span className="block truncate text-xs text-gray-600 dark:text-gray-400">
                {[last.clientName, last.projectName]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </span>
        </button>
      )}

      {isLoading ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-11 w-32 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : items && items.length > 0 ? (
        <ul
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap"
          aria-label={t("mostUsed")}
        >
          {items.map((item) => {
            const label = quickStartLabel(item, tHome("noName"));
            return (
              <li key={item.key} className="w-full sm:w-auto sm:max-w-full">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    startTimer({
                      clientId: item.clientId,
                      projectId: item.projectId,
                    });
                    toast.success(t("startedOn", { name: label.primary }));
                  }}
                  title={t("startOn", {
                    name: [label.primary, label.secondary]
                      .filter(Boolean)
                      .join(" · "),
                  })}
                  className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 sm:w-auto sm:max-w-full text-left transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-brand-600 dark:hover:bg-tt-gran-lys"
                >
                  <Play
                    className="h-3.5 w-3.5 shrink-0 text-brand-700 dark:text-brand-300"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium sm:max-w-[14rem] text-gray-900 dark:text-white">
                      {label.primary}
                    </span>
                    {label.secondary && (
                      <span className="block truncate text-xs sm:max-w-[14rem] text-gray-600 dark:text-gray-400">
                        {label.secondary}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          {t("empty")}{" "}
          {showProjects && (
            <Link
              href="/dashboard/projects/new"
              className="font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              {t("createProject")}
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
