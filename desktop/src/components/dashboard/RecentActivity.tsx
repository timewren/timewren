import { Radar } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "@/components/ui/LoadError";
import { formatDuration, formatTime, toLocalDateStr } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { Activity, Project } from "@/lib/types";

/** How many of today's latest activities the feed shows. */
const MAX_ROWS = 6;

function byNewestFirst(a: Activity, b: Activity): number {
  if (a.started_at === b.started_at) return b.id - a.id;
  return a.started_at < b.started_at ? 1 : -1;
}

export function RecentActivity() {
  const { t } = useTranslation();
  const headingId = useId();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const result = await tauriInvoke<Activity[]>("list_activities", {
        date: toLocalDateStr(new Date()),
      });
      setActivities([...result].sort(byNewestFirst).slice(0, MAX_ROWS));
      // Cleared only once the data is actually there: dropping it before the
      // call would flash the empty state on top of an earlier error.
      setFailed(false);
    } catch (err) {
      console.error("Failed to load recent activity:", err);
      setFailed(true);
      setActivities([]);
    }

    // Project names are decoration: if this call fails the feed still shows
    // what was tracked, so it must not put the widget in an error state.
    try {
      setProjects(
        await tauriInvoke<Project[]>("list_projects", {
          includeArchived: false,
        }),
      );
    } catch (err) {
      console.error("Failed to load projects for recent activity:", err);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // The auto-tracker keeps running while the user works in another app, so
  // the feed is refreshed when they come back to the TimeTrack window.
  useEffect(() => {
    const onFocus = () => {
      fetchData();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchData]);

  const header = (
    <div className="flex items-center gap-2 mb-3">
      <Radar size={16} className="text-(--color-accent)" />
      <h3 id={headingId} className="text-sm font-semibold text-(--color-text)">
        {t("dashboard.recentActivity")}
      </h3>
    </div>
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        {header}
        <div className="flex items-center justify-center py-6">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-(--color-border) border-t-(--color-accent)" />
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        {header}
        <LoadError
          message={t("dashboard.recentActivityFailed")}
          onRetry={() => {
            setLoading(true);
            fetchData();
          }}
          className="py-4"
        />
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        {header}
        <p className="text-xs text-(--color-text-muted)">
          {t("dashboard.recentActivityEmpty")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
      {header}

      <ul className="space-y-2.5" aria-labelledby={headingId}>
        {activities.map((activity) => {
          const project = activity.project_id
            ? projects.find((p) => p.id === activity.project_id)
            : undefined;

          return (
            <li key={activity.id} className="flex items-center gap-3">
              <span className="shrink-0 font-mono text-xs text-(--color-text-muted)">
                {formatTime(activity.started_at)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium text-(--color-text)">
                    {activity.app_name}
                  </span>
                  {project && (
                    <span className="flex shrink-0 items-center gap-1 rounded bg-(--color-border)/60 px-1.5 py-px text-[10px] text-(--color-text-muted)">
                      {project.color && (
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: project.color }}
                        />
                      )}
                      {project.name}
                    </span>
                  )}
                </div>
                {activity.window_title && (
                  <p
                    className="truncate text-[10px] text-(--color-text-muted)"
                    title={activity.window_title}
                  >
                    {activity.window_title}
                  </p>
                )}
              </div>

              <span className="shrink-0 font-mono text-xs text-(--color-text-muted)">
                {formatDuration(activity.duration)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
