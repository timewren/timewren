import { Mail, Users } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function EmailTasksWidget() {
  const t = useTranslations("dashboard.widgets.emailTasks");
  const { data: tasks, isLoading } =
    trpc.emailTasks.getRecentEmailTasks.useQuery({ limit: 5 });

  return (
    <DashboardWidget
      title={t("title")}
      icon={<Mail className="h-5 w-5" />}
      actions={
        <Link
          href="/dashboard/settings/email-integration/review"
          className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {t("review")}
        </Link>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
          <div className="h-3 w-5/6 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        </div>
      ) : tasks && tasks.length > 0 ? (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
            >
              <Link
                href={`/dashboard/tasks/${task.id}`}
                className="text-sm font-semibold text-gray-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400"
              >
                {task.title}
              </Link>
              <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Users className="h-3 w-3" />
                <span>
                  {task.client?.name || t("noClient")}
                  {task.project?.name ? ` • ${task.project.name}` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("empty")}</p>
      )}
    </DashboardWidget>
  );
}
