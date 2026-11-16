import { Activity, Clock, FileText, FolderKanban, Users } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function RecentActivityWidget() {
  const t = useTranslations("dashboard.widgets.recentActivity");
  const intlLocale = toIntlLocale(useLocale());
  const { data: activities } = trpc.user.getRecentActivity.useQuery({
    limit: 10,
    type: "all",
  });

  const getActivityIcon = (type: "time" | "invoice" | "client" | "project") => {
    switch (type) {
      case "time":
        return <Clock className="h-4 w-4 text-tt-graa" />;
      case "invoice":
        return (
          <FileText className="h-4 w-4 text-green-600 dark:text-green-400" />
        );
      case "client":
        return <Users className="h-4 w-4 text-tt-graa" />;
      case "project":
        return (
          <FolderKanban className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        );
    }
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return t("now");
    if (diffInSeconds < 3600)
      return t("minutesAgo", { count: Math.floor(diffInSeconds / 60) });
    if (diffInSeconds < 86400)
      return t("hoursAgo", { count: Math.floor(diffInSeconds / 3600) });
    if (diffInSeconds < 604800)
      return t("daysAgo", { count: Math.floor(diffInSeconds / 86400) });
    return new Date(date).toLocaleDateString(intlLocale, {
      day: "numeric",
      month: "short",
    });
  };

  if (!activities || activities.length === 0) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<Activity className="h-5 w-5 text-gray-600 dark:text-gray-400" />}
      >
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            {t("none")}
          </p>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget
      title={t("title")}
      icon={<Activity className="h-5 w-5 text-gray-600 dark:text-gray-400" />}
      actions={
        <Link
          href="/dashboard/time"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("seeAll")}
        </Link>
      }
    >
      <div className="space-y-2 overflow-y-auto max-h-[250px] sm:max-h-[400px]">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 transition-colors hover:border-gray-300 dark:hover:border-gray-600"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
              {getActivityIcon(activity.type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {activity.title}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                {activity.description}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                {formatTimeAgo(new Date(activity.timestamp))}
                {activity.actorName ? ` · ${activity.actorName}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </DashboardWidget>
  );
}
