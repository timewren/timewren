import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function UpcomingTasksWidget() {
  const t = useTranslations("dashboard.widgets.upcomingTasks");
  const locale = useLocale();
  const { data: upcomingTasks } = trpc.tasks.getUpcoming.useQuery();

  if (!upcomingTasks || upcomingTasks.length === 0) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<CalendarClock className="h-5 w-5 text-tt-graa" />}
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
      icon={<CalendarClock className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href="/dashboard/tasks"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("seeAll")}
        </Link>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("within7")}
        </p>
        <div className="space-y-2">
          {upcomingTasks.slice(0, 3).map((task) => (
            <Link
              key={task.id}
              href={`/dashboard/tasks/${task.id}`}
              className="block rounded-lg border border-gray-200 dark:border-gray-700 p-3 transition-colors hover:border-brand-300 dark:hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-tt-gran-lys"
            >
              <p className="font-medium text-gray-900 dark:text-white">
                {task.title}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {(Array.isArray(task.project) ? task.project[0] : task.project)
                  ?.name ||
                  (Array.isArray(task.client) ? task.client[0] : task.client)
                    ?.name ||
                  t("noProject")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500">
                {t("deadline", {
                  date: new Date(task.deadline ?? 0).toLocaleDateString(
                    toIntlLocale(locale),
                  ),
                })}
              </p>
            </Link>
          ))}
          {upcomingTasks.length > 3 && (
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">
              {t("more", { count: upcomingTasks.length - 3 })}
            </p>
          )}
        </div>
      </div>
    </DashboardWidget>
  );
}
