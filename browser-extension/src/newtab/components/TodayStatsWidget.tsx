import { useQuery } from "@tanstack/react-query";
import { Clock, Target, TrendingUp } from "lucide-react";
import { apiClient } from "../../api/client";
import { useT } from "../../i18n";
import { formatHoursShort } from "../../lib/format-hours";
import { QueryErrorState } from "../../popup/components/QueryErrorState";
import { useAuthStore } from "../../stores/authStore";
import { getTodayStr } from "../../utils/date";

interface TodayStats {
  totalHours: number;
  totalEntries: number;
  topProject: string | null;
}

export function TodayStatsWidget() {
  const { t } = useT();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const {
    data: stats,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["todayStats", selectedOrgId],
    // Ingen try/catch her: en fejl må ikke caches som "0 t i dag"
    queryFn: async (): Promise<TodayStats> => {
      const todayStr = getTodayStr();

      const entries = await apiClient.getTimeEntries(todayStr, todayStr);

      // entries is an array with { hours, projectId, projectName, ... }
      // Ensure entries is an array before using reduce
      if (!Array.isArray(entries)) {
        return { totalHours: 0, totalEntries: 0, topProject: null };
      }

      const totalHours = entries.reduce(
        (acc, entry) => acc + (entry.hours || 0),
        0,
      );

      // Find top project
      const projectCounts: Record<string, { name: string; hours: number }> = {};
      for (const entry of entries) {
        if (entry.projectId && entry.projectName) {
          if (!projectCounts[entry.projectId]) {
            projectCounts[entry.projectId] = {
              name: entry.projectName,
              hours: 0,
            };
          }
          projectCounts[entry.projectId].hours += entry.hours || 0;
        }
      }

      const topProject =
        Object.values(projectCounts).sort((a, b) => b.hours - a.hours)[0]
          ?.name || null;

      return {
        totalHours,
        totalEntries: entries.length,
        topProject,
      };
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1,
    enabled: orgsLoaded,
  });

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-4">
          {t("newtab.todayStats.title")}
        </h2>
        <div className="space-y-3">
          <div className="h-8 bg-[var(--color-surface-sunken)] rounded w-24" />
          <div className="h-4 bg-[var(--color-surface-sunken)] rounded w-32" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-4">
          {t("newtab.todayStats.title")}
        </h2>
        <QueryErrorState
          error={error}
          fallback={t("newtab.todayStats.loadFailed")}
          onRetry={() => refetch()}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-4">
        {t("newtab.todayStats.title")}
      </h2>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 shrink-0 bg-[var(--color-surface-sunken)] rounded-lg flex items-center justify-center">
            <Clock
              className="w-5 h-5 text-[var(--color-text-secondary)]"
              aria-hidden="true"
            />
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums text-[var(--color-text-primary)]">
              {formatHoursShort(stats?.totalHours ?? 0)}
            </div>
            <div className="text-sm text-[var(--color-text-muted)]">
              {t("newtab.todayStats.hours")}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 shrink-0 bg-[var(--color-surface-sunken)] rounded-lg flex items-center justify-center">
            <TrendingUp
              className="w-5 h-5 text-[var(--color-text-secondary)]"
              aria-hidden="true"
            />
          </div>
          <div>
            <div className="text-lg font-medium text-[var(--color-text-primary)]">
              {stats?.totalEntries || 0}
            </div>
            <div className="text-sm text-[var(--color-text-muted)]">
              {t("newtab.todayStats.entries")}
            </div>
          </div>
        </div>

        {stats?.topProject && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 shrink-0 bg-[var(--color-surface-sunken)] rounded-lg flex items-center justify-center">
              <Target
                className="w-5 h-5 text-[var(--color-text-secondary)]"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-medium text-[var(--color-text-primary)] truncate">
                {stats.topProject}
              </div>
              <div className="text-sm text-[var(--color-text-muted)]">
                {t("newtab.todayStats.topProject")}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
