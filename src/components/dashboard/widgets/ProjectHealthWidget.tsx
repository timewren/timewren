import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  HeartPulse,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function ProjectHealthWidget() {
  const t = useTranslations("dashboard.widgets.projectHealth");
  const intlLocale = toIntlLocale(useLocale());
  const { data: projectHealth } = trpc.projects.healthStatus.useQuery();
  const { data: budgetAlerts } = trpc.projects.getBudgetAlerts.useQuery();

  if (!projectHealth) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<HeartPulse className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  // Filter out projects without budgets
  const projectsWithBudgets = projectHealth.filter(
    (project) => project.hasFixedPrice && project.estimatedBudget,
  );

  const hasProjects = projectsWithBudgets.length > 0;
  const hasAlerts = budgetAlerts && budgetAlerts.length > 0;

  return (
    <DashboardWidget
      title={t("title")}
      icon={<HeartPulse className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href="/dashboard/projects"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("seeAll")}
        </Link>
      }
    >
      <div className="space-y-4">
        {/* Budget Alerts Section */}
        {hasAlerts && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              {t("alertsHeading")}
            </h4>
            {budgetAlerts.slice(0, 3).map((alert) => {
              const config = {
                exceeded: {
                  bgColor: "bg-red-100 dark:bg-red-900/30",
                  borderColor: "border-red-300 dark:border-red-700",
                  textColor: "text-red-800 dark:text-red-200",
                  badgeColor: "bg-red-600 text-white",
                  icon: XCircle,
                  label: t("severity.exceeded"),
                },
                critical: {
                  bgColor: "bg-amber-100 dark:bg-amber-900/30",
                  borderColor: "border-amber-300 dark:border-amber-700",
                  textColor: "text-amber-800 dark:text-amber-200",
                  badgeColor: "bg-amber-600 text-white",
                  icon: AlertCircle,
                  label: t("severity.critical"),
                },
                warning: {
                  bgColor: "bg-yellow-50 dark:bg-yellow-900/20",
                  borderColor: "border-yellow-300 dark:border-yellow-700",
                  textColor: "text-yellow-800 dark:text-yellow-200",
                  badgeColor: "bg-yellow-500 text-white",
                  icon: AlertTriangle,
                  label: t("severity.warning"),
                },
              };

              const alertConfig = config[alert.severity];
              const Icon = alertConfig.icon;

              return (
                <Link
                  key={alert.id}
                  href={`/dashboard/projects/${alert.id}`}
                  className={`block rounded-lg border ${alertConfig.borderColor} ${alertConfig.bgColor} p-3 transition-all hover:shadow-md`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <Icon
                        className={`h-4 w-4 shrink-0 mt-0.5 ${alertConfig.textColor}`}
                      />
                      <div className="min-w-0">
                        <h5 className="font-medium text-sm text-gray-900 dark:text-white truncate">
                          {alert.projectName}
                        </h5>
                        <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                          {alert.clientName}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${alertConfig.badgeColor}`}
                    >
                      {alert.budgetPercentage}%
                    </span>
                  </div>

                  {/* Budget info */}
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className={alertConfig.textColor}>
                      {t("hoursUsed", {
                        used: alert.hoursUsed,
                        budget: alert.budgetHours,
                      })}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {t("budgetAmount", {
                        amount: alert.fixedPrice.toLocaleString(intlLocale),
                      })}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full ${
                        alert.severity === "exceeded"
                          ? "bg-red-600"
                          : alert.severity === "critical"
                            ? "bg-amber-600"
                            : "bg-yellow-500"
                      }`}
                      style={{
                        width: `${Math.min(alert.budgetPercentage, 100)}%`,
                      }}
                    />
                  </div>
                </Link>
              );
            })}

            {budgetAlerts.length > 3 && (
              <Link
                href="/dashboard/projects"
                className="block text-center text-xs text-amber-600 dark:text-amber-400 hover:underline py-1"
              >
                {t("moreAlerts", { count: budgetAlerts.length - 3 })}
              </Link>
            )}
          </div>
        )}

        {/* Healthy Projects Section */}
        {!hasProjects ? (
          <div className="flex flex-col items-center justify-center text-center py-4">
            <p className="text-sm text-gray-500 dark:text-gray-500">
              {t("noBudgets")}
            </p>
            <Link
              href="/dashboard/projects/new"
              className="mt-2 text-sm text-brand-600 dark:text-brand-400 hover:underline"
            >
              {t("createProject")}
            </Link>
          </div>
        ) : (
          <>
            {/* Show healthy projects summary if we have alerts */}
            {hasAlerts &&
              projectsWithBudgets.filter((p) => p.healthStatus === "green")
                .length > 0 && (
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      {t("onTrack", {
                        count: projectsWithBudgets.filter(
                          (p) => p.healthStatus === "green",
                        ).length,
                      })}
                    </span>
                    <Link
                      href="/dashboard/projects"
                      className="text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      {t("seeAll")}
                    </Link>
                  </div>
                </div>
              )}

            {/* If no alerts, show all projects like before */}
            {!hasAlerts && (
              <div className="space-y-3">
                {projectsWithBudgets.slice(0, 5).map((project) => {
                  const healthConfig = {
                    green: {
                      bgColor: "bg-green-50 dark:bg-green-900/20",
                      borderColor: "border-green-200 dark:border-green-800",
                      textColor: "text-green-700 dark:text-green-300",
                      iconColor: "text-green-600 dark:text-green-400",
                      icon: CheckCircle,
                    },
                    yellow: {
                      bgColor: "bg-amber-50 dark:bg-amber-900/20",
                      borderColor: "border-amber-200 dark:border-amber-800",
                      textColor: "text-amber-700 dark:text-amber-300",
                      iconColor: "text-amber-600 dark:text-amber-400",
                      icon: AlertCircle,
                    },
                    red: {
                      bgColor: "bg-red-50 dark:bg-red-900/20",
                      borderColor: "border-red-200 dark:border-red-800",
                      textColor: "text-red-700 dark:text-red-300",
                      iconColor: "text-red-600 dark:text-red-400",
                      icon: AlertCircle,
                    },
                  };

                  const config = healthConfig[project.healthStatus];
                  const Icon = config.icon;

                  return (
                    <Link
                      key={project.id}
                      href={`/dashboard/projects/${project.id}`}
                      className={`block rounded-lg border ${config.borderColor} ${config.bgColor} p-3 transition-all hover:shadow-md`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Icon
                              className={`h-4 w-4 shrink-0 ${config.iconColor}`}
                            />
                            <h4 className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                              {project.name}
                            </h4>
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                            {project.clientName}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <div
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.textColor}`}
                          >
                            {project.budgetPercentage}%
                          </div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                          <span>
                            {t("hoursUsed", {
                              used: project.hoursUsed,
                              budget: project.estimatedBudget ?? 0,
                            })}
                          </span>
                          <span>
                            {t("budgetAmount", {
                              amount:
                                project.fixedPrice?.toLocaleString(
                                  intlLocale,
                                ) ?? "",
                            })}
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              project.healthStatus === "green"
                                ? "bg-green-500"
                                : project.healthStatus === "yellow"
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                            }`}
                            style={{
                              width: `${Math.min(project.budgetPercentage, 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </Link>
                  );
                })}

                {projectsWithBudgets.length > 5 && (
                  <Link
                    href="/dashboard/projects"
                    className="block text-center text-sm text-brand-600 dark:text-brand-400 hover:underline py-2"
                  >
                    {t("moreProjects", {
                      count: projectsWithBudgets.length - 5,
                    })}
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </DashboardWidget>
  );
}
