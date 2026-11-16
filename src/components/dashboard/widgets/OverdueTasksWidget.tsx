import { AlertCircle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function OverdueTasksWidget() {
  const t = useTranslations("dashboard.widgets.overdueTasks");
  const locale = useLocale();
  const { data: overdueTasks } = trpc.tasks.getOverdue.useQuery();

  if (!overdueTasks || overdueTasks.length === 0) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
        }
      >
        <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-4">
          <CheckCircle2 className="h-8 w-8 text-green-500 dark:text-green-400" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("none")}
          </p>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget
      title={t("title")}
      variant="danger"
      icon={<AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />}
      actions={
        <Link
          href="/dashboard/tasks"
          className="text-sm font-medium text-red-600 dark:text-red-400 hover:underline"
        >
          {t("seeAll")}
        </Link>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("count", { count: overdueTasks.length })}
        </p>
        <div className="space-y-2">
          {overdueTasks.slice(0, 3).map((task) => (
            <Link
              key={task.id}
              href={`/dashboard/tasks/${task.id}`}
              className="block rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-900 p-3 transition-colors hover:border-red-300 dark:hover:border-red-700"
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
              <p className="text-xs text-red-600 dark:text-red-400">
                {t("deadline", {
                  date: new Date(task.deadline ?? 0).toLocaleDateString(
                    toIntlLocale(locale),
                  ),
                })}
              </p>
            </Link>
          ))}
          {overdueTasks.length > 3 && (
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">
              {t("more", { count: overdueTasks.length - 3 })}
            </p>
          )}
        </div>
      </div>
    </DashboardWidget>
  );
}
