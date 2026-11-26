"use client";

import {
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Edit,
  KanbanSquare,
  MoreHorizontal,
  Pause,
  Play,
  Timer,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/dashboard-nav";
import { MonthlyBudgetSection } from "@/components/projects/MonthlyBudgetSection";
import { ProjectActivityTypesSection } from "@/components/projects/ProjectActivityTypesSection";
import { ProjectAssignmentsSection } from "@/components/projects/ProjectAssignmentsSection";
import {
  PERIOD_OPTIONS,
  type PeriodKey,
  ProjectBudgetBar,
  periodStart,
} from "@/components/projects/ProjectBudgetBar";
import { ProjectTimelineAlerts } from "@/components/projects/ProjectTimelineAlerts";
import { TeamRatesSection } from "@/components/projects/TeamRatesSection";
import { RateHistory } from "@/components/RateHistory";
import { ScheduledRateChanges } from "@/components/ScheduledRateChanges";
import { KanbanBoard } from "@/components/tasks/KanbanBoard";
import { QuickAddTask } from "@/components/tasks/QuickAddTask";
import { TimeIntervalsOverview } from "@/components/time/TimeIntervalsOverview";
import { ConfirmDialog } from "@/components/ui";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useModules } from "@/hooks/useModules";
import { useOrgRole } from "@/hooks/useOrgRole";
import { usePermission } from "@/hooks/usePermission";
import { useTimeListSummary } from "@/hooks/useTimeListSummary";
import { toIntlLocale } from "@/i18n/format-locale";
import { projectEndDateState } from "@/lib/projects/timeline";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { trpc } from "@/providers/trpc-provider";

type ProjectStatus = "active" | "completed" | "on_hold" | "archived";

const STATUS_CONFIG: Record<
  ProjectStatus,
  { color: string; bgColor: string; icon: typeof Play }
> = {
  active: {
    color: "text-green-700 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/30",
    icon: Play,
  },
  completed: {
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    icon: Check,
  },
  on_hold: {
    color: "text-amber-700 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    icon: Pause,
  },
  archived: {
    color: "text-gray-700 dark:text-gray-400",
    bgColor: "bg-gray-100 dark:bg-gray-700",
    icon: Trash2,
  },
};

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const { data: project, isLoading } = trpc.projects.getById.useQuery({ id });
  const { data: stats } = trpc.projects.getStats.useQuery({ projectId: id });
  const { data: timeEntriesData } = useTimeListSummary({ projectId: id });
  // Én-relationer er altid et objekt eller null (aldrig et array), og uden
  // en Array.isArray-normalisering beholder posterne deres type.
  const timeEntries = timeEntriesData?.entries;

  // Periodefilter på "Arbejdstid pr. dag" (kundeønske: dag/uge/måned/
  // kvartal uden at skulle bygge en rapport pr. kunde)
  const [period, setPeriod] = useState<PeriodKey>("all");
  const periodFrom = periodStart(period);
  const periodEntries = timeEntries?.filter(
    (entry) => !periodFrom || new Date(entry.date) >= periodFrom,
  );

  const { canWrite: canManage } = usePermission("projects");
  // Per-member rates are salary-like — only owner/admin may see the matrix.
  const { canManage: isOrgAdmin } = useOrgRole();
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  // Projektets task-board (#213) — kun når tasks-modulet er slået til og
  // rollen må læse opgaver
  const { canRead: canReadTasks, canWrite: canWriteTasks } =
    usePermission("tasks");
  const showTaskBoard =
    !modulesPlaceholder && isModuleEnabled("tasks") && canReadTasks;

  const archiveMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success(t("detail.archived"));
      router.push("/dashboard/projects");
    },
    onError: (error) => {
      toast.error(t("detail.archiveFailed"), {
        description: error.message,
      });
    },
  });

  const permanentDeleteMutation = trpc.projects.permanentDelete.useMutation({
    onSuccess: () => {
      toast.success(t("detail.deleted"));
      router.push("/dashboard/projects");
    },
    onError: (error) => {
      if (error.data?.code === "NOT_FOUND") {
        toast.success(t("detail.alreadyDeleted"));
        router.push("/dashboard/projects");
      } else {
        toast.error(t("detail.deleteFailed"), {
          description: error.message,
        });
      }
    },
  });

  const updateStatusMutation = trpc.projects.updateStatus.useMutation({
    onSuccess: (updatedProject) => {
      const statusLabel =
        updatedProject.status && updatedProject.status in STATUS_CONFIG
          ? t(`detail.status.${updatedProject.status as ProjectStatus}`)
          : updatedProject.status;
      toast.success(t("detail.statusChanged", { status: statusLabel ?? "" }));
      utils.projects.getById.invalidate({ id });
      setShowStatusDropdown(false);
    },
    onError: (error) => {
      toast.error(t("detail.statusFailed"), {
        description: error.message,
      });
    },
  });

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        statusDropdownRef.current &&
        !statusDropdownRef.current.contains(e.target as Node)
      ) {
        setShowStatusDropdown(false);
      }
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(e.target as Node)
      ) {
        setShowMoreMenu(false);
      }
    };

    if (showStatusDropdown || showMoreMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showStatusDropdown, showMoreMenu]);

  const handleArchive = () => {
    setShowArchiveConfirm(true);
  };

  const handlePermanentDelete = () => {
    setDeleteConfirmName("");
    setShowDeleteConfirm(true);
  };

  const handleStatusChange = (newStatus: ProjectStatus) => {
    if (project?.status === newStatus) {
      setShowStatusDropdown(false);
      return;
    }
    updateStatusMutation.mutate({ id, status: newStatus });
  };

  if (isLoading) {
    return <LoadingScreen message={t("detail.loading")} />;
  }

  if (!project) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
        <p className="text-sm font-medium text-gray-900 dark:text-white">
          {t("detail.notFound")}
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("detail.notFoundHint")}
        </p>
        <Link
          href="/dashboard/projects"
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("detail.backToProjects")}
        </Link>
      </div>
    );
  }

  const clientName = (
    Array.isArray(project.client) ? project.client[0] : project.client
  )?.name;
  const fmtHours = (n: number | string) =>
    Number(n).toLocaleString(toIntlLocale(locale), {
      maximumFractionDigits: 2,
    });
  const fmtMoney = (n: number | string) =>
    Number(n).toLocaleString(toIntlLocale(locale), {
      maximumFractionDigits: 0,
    });
  // Slutdatoen er projektets sidste dag — overskredet først dagen efter
  const endDateOverdue =
    projectEndDateState(project, copenhagenToday())?.kind === "overdue";

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <Breadcrumbs
          items={[
            { label: t("detail.breadcrumb"), href: "/dashboard/projects" },
            { label: project.name },
          ]}
        />

        <div className="mt-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                {project.name}
              </h1>

              {/* Status dropdown */}
              <div className="relative" ref={statusDropdownRef}>
                {(() => {
                  const status = (project.status || "active") as ProjectStatus;
                  const config = STATUS_CONFIG[status];
                  const StatusIcon = config.icon;
                  return (
                    <button
                      type="button"
                      onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${config.bgColor} ${config.color} hover:opacity-80 transition-opacity`}
                    >
                      <StatusIcon className="h-3.5 w-3.5" />
                      {t(`detail.status.${status}`)}
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${showStatusDropdown ? "rotate-180" : ""}`}
                      />
                    </button>
                  );
                })()}

                {showStatusDropdown && (
                  <div className="absolute left-0 top-full z-50 mt-1 min-w-40 rounded-xl border border-gray-200/80 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900">
                    {(Object.keys(STATUS_CONFIG) as ProjectStatus[]).map(
                      (status) => {
                        const config = STATUS_CONFIG[status];
                        const StatusIcon = config.icon;
                        const isCurrentStatus = project.status === status;
                        return (
                          <button
                            key={status}
                            type="button"
                            onClick={() => handleStatusChange(status)}
                            disabled={
                              isCurrentStatus || updateStatusMutation.isPending
                            }
                            className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${
                              isCurrentStatus
                                ? "cursor-not-allowed bg-gray-50 dark:bg-gray-800/50"
                                : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                            }`}
                          >
                            <StatusIcon className={`h-4 w-4 ${config.color}`} />
                            <span
                              className={isCurrentStatus ? "font-medium" : ""}
                            >
                              {t(`detail.status.${status}`)}
                            </span>
                            {isCurrentStatus && (
                              <Check className="ml-auto h-4 w-4 text-green-500" />
                            )}
                          </button>
                        );
                      },
                    )}
                  </div>
                )}
              </div>
            </div>
            {clientName && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {project.clientId ? (
                  <Link
                    href={`/dashboard/clients/${project.clientId}`}
                    className="hover:text-gray-900 hover:underline dark:hover:text-white"
                  >
                    {clientName}
                  </Link>
                ) : (
                  clientName
                )}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/dashboard/time?project=${id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
            >
              <Timer className="h-4 w-4" />
              {t("detail.logTime")}
            </Link>
            <Link
              href={`/dashboard/projects/${id}/edit`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Edit className="h-4 w-4" />
              {tc("edit")}
            </Link>
            {canManage && (
              // biome-ignore lint/a11y/noStaticElementInteractions: wrapper stopper kun bobling af klik, den er ikke selv et kontrolelement
              <div
                className="relative"
                ref={moreMenuRef}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && showMoreMenu) {
                    e.stopPropagation();
                    setShowMoreMenu(false);
                    moreMenuRef.current?.querySelector("button")?.focus();
                  }
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowMoreMenu((v) => !v)}
                  aria-label={t("detail.moreActions")}
                  aria-expanded={showMoreMenu}
                  aria-haspopup="menu"
                  className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {showMoreMenu && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-gray-200/80 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowMoreMenu(false);
                        handleArchive();
                      }}
                      disabled={archiveMutation.isPending}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      <Archive className="h-4 w-4 text-gray-400" />
                      {t("detail.archiveProject")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowMoreMenu(false);
                        handlePermanentDelete();
                      }}
                      disabled={permanentDeleteMutation.isPending}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("detail.deletePermanently")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Nøgletal */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-200 lg:grid-cols-4 dark:bg-gray-800">
        <div className="bg-white p-4 dark:bg-gray-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("detail.hoursTotal")}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {stats
              ? t("detail.hoursValue", { value: fmtHours(stats.totalHours) })
              : "–"}
          </div>
        </div>
        <div className="bg-white p-4 dark:bg-gray-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("detail.thisMonth")}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {stats
              ? t("detail.hoursValue", { value: fmtHours(stats.monthHours) })
              : "–"}
          </div>
          {project.monthlyBudgetHours && (
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {t("detail.ofBudget", {
                hours: fmtHours(project.monthlyBudgetHours),
              })}
            </div>
          )}
        </div>
        <div className="bg-white p-4 dark:bg-gray-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("detail.revenue")}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {stats
              ? t("detail.currencyShort", { amount: fmtMoney(stats.revenue) })
              : "–"}
          </div>
        </div>
        <div className="bg-white p-4 dark:bg-gray-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("detail.entries")}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {stats ? stats.entriesCount : "–"}
          </div>
        </div>
      </div>

      {(project.description ||
        project.hourlyRate ||
        project.fixedPrice ||
        project.startDate ||
        project.endDate) && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
            {t("detail.detailsTitle")}
          </h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {project.description && (
              <div className="sm:col-span-2 lg:col-span-4">
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.description")}
                </dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm text-gray-900 dark:text-white">
                  {project.description}
                </dd>
              </div>
            )}
            {project.hourlyRate && (
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.hourlyRate")}
                </dt>
                <dd className="mt-0.5 text-sm tabular-nums text-gray-900 dark:text-white">
                  {t("detail.rateValue", {
                    rate: fmtMoney(project.hourlyRate),
                  })}
                </dd>
              </div>
            )}
            {project.fixedPrice && (
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.fixedPrice")}
                </dt>
                <dd className="mt-0.5 text-sm tabular-nums text-gray-900 dark:text-white">
                  {t("detail.currencyShort", {
                    amount: fmtMoney(project.fixedPrice),
                  })}
                </dd>
              </div>
            )}
            {project.startDate && (
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.startDate")}
                </dt>
                <dd className="mt-0.5 text-sm tabular-nums text-gray-900 dark:text-white">
                  {new Date(project.startDate).toLocaleDateString(
                    toIntlLocale(locale),
                  )}
                </dd>
              </div>
            )}
            {project.endDate && (
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.endDate")}
                </dt>
                <dd
                  className={`mt-0.5 text-sm tabular-nums ${
                    endDateOverdue
                      ? "text-red-600 dark:text-red-400"
                      : "text-gray-900 dark:text-white"
                  }`}
                >
                  {new Date(project.endDate).toLocaleDateString(
                    toIntlLocale(locale),
                  )}
                  {endDateOverdue && ` · ${t("detail.overdueSuffix")}`}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Slutdato tæt på/overskredet + forbrug foran tiden (#213) */}
      <ProjectTimelineAlerts
        project={project}
        budgetPercent={stats?.budget?.percentage}
      />

      {/* Samlet timebudget (eksplicit eller udledt af fastpris/timepris) */}
      {stats?.budget && (
        <ProjectBudgetBar
          budget={stats.budget}
          editHref={`/dashboard/projects/${id}/edit`}
        />
      )}

      {/* Monthly hours budget (only when set on the project) */}
      {project.monthlyBudgetHours && <MonthlyBudgetSection projectId={id} />}

      {/* Projektets opgaver som board (#213) — de generelle lanes, filtreret
          på projektet; nye opgaver arver projektet */}
      {showTaskBoard && (
        <section
          aria-labelledby="project-tasks-heading"
          className="rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KanbanSquare
                className="h-4 w-4 text-gray-400"
                aria-hidden="true"
              />
              <h2
                id="project-tasks-heading"
                className="text-sm font-semibold text-gray-900 dark:text-white"
              >
                {t("detail.tasks")}
              </h2>
            </div>
            <Link
              href="/dashboard/tasks"
              className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              {t("detail.allTasks")}
            </Link>
          </div>
          {canWriteTasks && (
            <QuickAddTask
              projectId={id}
              clientId={project.clientId}
              placeholder={t("detail.addTaskPlaceholder")}
              className="mb-3"
            />
          )}
          <KanbanBoard filterProjectId={id} />
        </section>
      )}

      {/* Planlagte timepriser + prishistorik */}
      <ScheduledRateChanges projectId={id} currentRate={project.hourlyRate} />
      {project.hourlyRate && <RateHistory projectId={id} />}

      {/* Team Member Rates (org admin only — salary-like data) */}
      {isOrgAdmin && <TeamRatesSection projectId={id} />}

      {/* Enterprise: faste rækker i ugegrid'et (#432) — admin/owner */}
      {isOrgAdmin && isModuleEnabled("enterprise") && (
        <ProjectAssignmentsSection projectId={id} />
      )}

      {/* Enterprise: tilladte aktivitetstyper på projektet (#459) */}
      {isOrgAdmin && isModuleEnabled("enterprise") && (
        <ProjectActivityTypesSection projectId={id} />
      )}

      {/* Time Intervals Overview - grouped by date with time ranges */}
      {timeEntries && timeEntries.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("detail.period")}
            </span>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setPeriod(opt.key)}
                  aria-pressed={period === opt.key}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    period === opt.key
                      ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  {t(`period.${opt.key}`)}
                </button>
              ))}
            </div>
          </div>
          {periodEntries && periodEntries.length > 0 ? (
            <TimeIntervalsOverview
              entries={periodEntries}
              title={t("detail.workTimePerDay")}
              maxDates={15}
            />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-12 text-center dark:border-gray-800">
              <Clock className="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {t("detail.noEntriesInPeriod")}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("detail.noEntriesInPeriodHint")}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
          <Clock className="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {t("detail.noEntries")}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("detail.noEntriesHint")}
          </p>
          <Link
            href={`/dashboard/time?project=${id}`}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            <Timer className="h-4 w-4" />
            {t("detail.logTime")}
          </Link>
        </div>
      )}

      <ConfirmDialog
        isOpen={showArchiveConfirm}
        onClose={() => setShowArchiveConfirm(false)}
        onConfirm={async () => {
          try {
            await archiveMutation.mutateAsync({ id });
            setShowArchiveConfirm(false);
          } catch {
            // Fejlen vises af mutationens onError.
          }
        }}
        title={t("detail.archiveDialogTitle")}
        description={t("detail.archiveDialogDescription")}
        confirmLabel={t("detail.archiveDialogConfirm")}
        variant="warning"
        isLoading={archiveMutation.isPending}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setDeleteConfirmName("");
        }}
        onConfirm={async () => {
          try {
            await permanentDeleteMutation.mutateAsync({
              id,
              confirmName: deleteConfirmName,
            });
          } catch {
            // Fejlen vises af mutationens onError.
          }
        }}
        title={t("detail.deleteDialogTitle")}
        description={
          <div className="space-y-3">
            <p>{t("detail.deleteDialogBody")}</p>
            <p className="font-medium">
              {t("detail.deleteDialogConfirmName")}{" "}
              <span className="text-red-600 dark:text-red-400">
                {project.name}
              </span>
            </p>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={project.name}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500/20"
            />
          </div>
        }
        confirmLabel={t("detail.deletePermanently")}
        variant="danger"
        isLoading={permanentDeleteMutation.isPending}
        confirmDisabled={deleteConfirmName !== project.name}
      />
    </div>
  );
}
