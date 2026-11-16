import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "@/components/ui/LoadError";
import { tauriInvoke } from "@/lib/tauri";
import type { OverBudgetProject } from "@/lib/types";

export function OverBudgetProjects() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<OverBudgetProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const result = await tauriInvoke<OverBudgetProject[]>(
        "get_over_budget_projects",
      );
      // Sort by highest overshoot first
      result.sort((a, b) => b.percentage - a.percentage);
      setProjects(result);
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to fetch over-budget projects:", err);
      setLoadFailed(true);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={16} className="text-amber-400" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.overBudget")}
          </h3>
        </div>
        <div className="flex items-center justify-center py-6">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-(--color-border) border-t-(--color-accent)" />
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-amber-400" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.overBudget")}
          </h3>
        </div>
        <LoadError
          message={t("projects.projectsLoadFailed")}
          onRetry={() => {
            setLoading(true);
            fetchData();
          }}
          className="py-4"
        />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-(--color-text-muted)/40" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.overBudget")}
          </h3>
        </div>
        <p className="text-xs text-(--color-text-muted)">
          {t("dashboard.noOverBudget")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={16} className="text-amber-400" />
        <h3 className="text-sm font-semibold text-(--color-text)">
          {t("dashboard.overBudget")}
        </h3>
        <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
          {projects.length}
        </span>
      </div>

      {/* Project list */}
      <div className="space-y-2.5">
        {projects.map((project) => {
          const isRed = project.percentage >= 150;
          const barWidth = Math.min(project.percentage, 200);

          return (
            <div key={project.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-(--color-text) truncate">
                  {project.name}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                    isRed
                      ? "bg-red-500/15 text-red-400"
                      : "bg-yellow-500/15 text-yellow-400"
                  }`}
                >
                  {Math.round(project.percentage)}%
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--color-border)/50">
                <div
                  className={`h-full rounded-full transition-all ${
                    isRed ? "bg-red-400" : "bg-yellow-400"
                  }`}
                  style={{ width: `${Math.min(barWidth / 2, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-(--color-text-muted)">
                  {Math.round(project.used_hours * 10) / 10} {t("common.hours")}{" "}
                  / {project.estimated_hours} {t("common.hours")}
                </span>
                <span
                  className={`text-[10px] ${isRed ? "text-red-400" : "text-yellow-400"}`}
                >
                  +
                  {Math.round(
                    (project.used_hours - project.estimated_hours) * 10,
                  ) / 10}
                  {t("common.hours")} {t("dashboard.overBudgetLabel")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
