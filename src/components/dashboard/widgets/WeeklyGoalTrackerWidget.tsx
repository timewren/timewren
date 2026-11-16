import { Target } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { formatTime } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function WeeklyGoalTrackerWidget() {
  const t = useTranslations("dashboard.widgets.weeklyGoal");
  const { data: goalProgress, isError } =
    trpc.time.weeklyGoalProgress.useQuery();

  if (!goalProgress) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<Target className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          {isError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {t("loadFailed")}
            </p>
          ) : (
            <InlineSpinner className="h-8 w-8" />
          )}
        </div>
      </DashboardWidget>
    );
  }

  // Determine color based on progress and status
  let progressColor = "text-green-600 dark:text-green-400";
  let progressBgColor = "stroke-green-600 dark:stroke-green-400";
  let statusColor =
    "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300";

  if (goalProgress.progressPercentage >= 100) {
    // Goal achieved
    progressColor = "text-green-600 dark:text-green-400";
    progressBgColor = "stroke-green-600 dark:stroke-green-400";
    statusColor =
      "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300";
  } else if (!goalProgress.isOnTrack) {
    // Behind schedule
    progressColor = "text-red-600 dark:text-red-400";
    progressBgColor = "stroke-red-600 dark:stroke-red-400";
    statusColor =
      "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
  } else if (goalProgress.progressPercentage >= 75) {
    // On track
    progressColor = "text-green-600 dark:text-green-400";
    progressBgColor = "stroke-green-600 dark:stroke-green-400";
    statusColor =
      "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300";
  } else {
    // Behind but can catch up
    progressColor = "text-amber-600 dark:text-amber-400";
    progressBgColor = "stroke-amber-600 dark:stroke-amber-400";
    statusColor =
      "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300";
  }

  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (goalProgress.progressPercentage / 100) * circumference;

  return (
    <DashboardWidget
      title={t("title")}
      icon={<Target className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href="/dashboard/time"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("trackTime")}
        </Link>
      }
    >
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        {/* Circular Progress */}
        <div className="relative">
          <svg
            aria-hidden="true"
            className="transform -rotate-90"
            width="160"
            height="160"
          >
            {/* Background circle */}
            <circle
              cx="80"
              cy="80"
              r={radius}
              stroke="currentColor"
              strokeWidth="12"
              fill="none"
              className="text-gray-200 dark:text-gray-700"
            />
            {/* Progress circle */}
            <circle
              cx="80"
              cy="80"
              r={radius}
              stroke="currentColor"
              strokeWidth="12"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className={progressBgColor}
              style={{ transition: "stroke-dashoffset 0.5s ease" }}
            />
          </svg>
          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-3xl font-bold ${progressColor}`}>
              {goalProgress.progressPercentage}%
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              {formatTime(goalProgress.hoursWorked)} /{" "}
              {formatTime(goalProgress.weeklyGoal)}
            </span>
          </div>
        </div>

        {/* Status and details */}
        <div className="w-full space-y-2">
          {/* Status badge */}
          <div className="flex justify-center">
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor}`}
            >
              {goalProgress.progressPercentage >= 100
                ? t("reached")
                : goalProgress.isOnTrack
                  ? t("onTrack")
                  : t("behind")}
            </span>
          </div>

          {/* Remaining hours */}
          {goalProgress.hoursRemaining > 0 && (
            <div className="text-center">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t.rich("remaining", {
                  time: formatTime(goalProgress.hoursRemaining),
                  b: (chunks) => (
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {chunks}
                    </span>
                  ),
                })}
              </p>
              {goalProgress.daysRemaining > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  {t("perDay", {
                    time: formatTime(goalProgress.hoursPerDayNeeded),
                    count: goalProgress.daysRemaining,
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardWidget>
  );
}
