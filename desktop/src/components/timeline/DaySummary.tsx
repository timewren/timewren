import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDuration } from "@/lib/format";
import type { Activity, Project } from "@/lib/types";

interface DaySummaryProps {
  activities: Activity[];
  projects: Project[];
}

interface ProjectSummary {
  projectId: string | null;
  projectName: string;
  color: string;
  duration: number;
  billable: boolean;
}

export function DaySummary({ activities, projects }: DaySummaryProps) {
  const { t } = useTranslation();
  // Filter out idle activities
  const activeActivities = activities.filter((a) => !a.is_idle);

  // Total tracked time (non-idle)
  const totalDuration = activeActivities.reduce(
    (sum, a) => sum + a.duration,
    0,
  );

  // Idle time
  const idleDuration = activities
    .filter((a) => a.is_idle)
    .reduce((sum, a) => sum + a.duration, 0);

  // Confirmed vs pending
  const confirmedCount = activeActivities.filter(
    (a) => a.is_confirmed || (a.confidence !== null && a.confidence > 0.85),
  ).length;
  const pendingCount = activeActivities.length - confirmedCount;

  // Group by project
  const projectMap = new Map<string | null, ProjectSummary>();

  for (const activity of activeActivities) {
    const key = activity.project_id;
    const existing = projectMap.get(key);

    if (existing) {
      existing.duration += activity.duration;
    } else {
      const project = projects.find((p) => p.id === activity.project_id);
      projectMap.set(key, {
        projectId: key,
        projectName: project?.name ?? t("daySummary.withoutProject"),
        color: project?.color ?? "#6b7280",
        duration: activity.duration,
        billable: activity.category !== "personal",
      });
    }
  }

  const projectSummaries = Array.from(projectMap.values()).sort(
    (a, b) => b.duration - a.duration,
  );

  // Billable split
  const billableDuration = activeActivities
    .filter((a) => a.category !== "personal")
    .reduce((sum, a) => sum + a.duration, 0);
  const nonBillableDuration = totalDuration - billableDuration;

  if (activities.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-(--color-text)">
          {t("daySummary.title")}
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-emerald-400" />
            <span className="text-xs text-(--color-text-muted)">
              {t("daySummary.confirmed", { count: confirmedCount })}
            </span>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5">
              <AlertCircle size={13} className="text-amber-400" />
              <span className="text-xs text-(--color-text-muted)">
                {t("daySummary.pending", { count: pendingCount })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Total time */}
      <div className="flex items-center gap-2">
        <Clock size={16} className="text-(--color-accent)" />
        <span className="text-lg font-bold text-(--color-text)">
          {formatDuration(totalDuration)}
        </span>
        {idleDuration > 0 && (
          <span className="text-xs text-(--color-text-muted)">
            ({t("daySummary.idle", { duration: formatDuration(idleDuration) })})
          </span>
        )}
      </div>

      {/* Project breakdown bar */}
      {totalDuration > 0 && projectSummaries.length > 0 && (
        <div className="space-y-2">
          {/* Stacked bar */}
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-(--color-border)/50">
            {projectSummaries.map((ps) => (
              <div
                key={ps.projectId ?? "none"}
                className="h-full transition-all"
                style={{
                  width: `${(ps.duration / totalDuration) * 100}%`,
                  backgroundColor: ps.color,
                }}
                title={`${ps.projectName}: ${formatDuration(ps.duration)}`}
              />
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3">
            {projectSummaries.map((ps) => (
              <div
                key={ps.projectId ?? "none"}
                className="flex items-center gap-1.5"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: ps.color }}
                />
                <span className="text-xs text-(--color-text-muted)">
                  {ps.projectName}
                </span>
                <span className="font-mono text-xs text-(--color-text-muted)/70">
                  {formatDuration(ps.duration)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Billable split */}
      {totalDuration > 0 && (
        <div className="flex items-center gap-4 border-t border-(--color-border) pt-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-(--color-text-muted)">
              {t("daySummary.billable")}: {formatDuration(billableDuration)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-(--color-text-muted)/40" />
            <span className="text-xs text-(--color-text-muted)">
              {t("daySummary.nonBillable")}:{" "}
              {formatDuration(nonBillableDuration)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
