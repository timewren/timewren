"use client";

import {
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Kanban,
  List,
  Mail,
  PlayCircle,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { ColumnConfigPopover } from "@/components/tasks/ColumnConfigPopover";
import { DensityToggle } from "@/components/tasks/DensityToggle";
import { FilterChip } from "@/components/tasks/FilterChip";
import { FilterPresetBar } from "@/components/tasks/FilterPresetBar";
import { KanbanBoard } from "@/components/tasks/KanbanBoard";
import type { KanbanStatus } from "@/components/tasks/KanbanColumn";
import { QuickAddTask } from "@/components/tasks/QuickAddTask";
import type { TaskModalData } from "@/components/tasks/TaskFormModal";
import {
  type TaskForList,
  TaskListTable,
} from "@/components/tasks/TaskListTable";
import { TaskSidePanel } from "@/components/tasks/TaskSidePanel";
import {
  Button,
  Card,
  ConfirmDialog,
  SkeletonList,
  SkeletonStats,
} from "@/components/ui";
import { useDebounce } from "@/hooks/useDebounce";
import { useModules } from "@/hooks/useModules";
import {
  type TaskUndoSnapshot,
  useTaskDeleteUndo,
} from "@/hooks/useTaskDeleteUndo";
import { toIntlLocale } from "@/i18n/format-locale";
import { useSession } from "@/lib/auth-client";
import { formatTaskMinutes } from "@/lib/tasks/time-progress";
import { trpc } from "@/providers/trpc-provider";
import { useTaskPreferencesStore } from "@/stores/taskPreferencesStore";

// Altid monteret, men åbnes først ved en brugerhandling — kun klient-side, så
// formularernes kode (react-hook-form + zod) hentes efter hydrering i stedet
// for i sidens første load (samme mønster som tidsregistreringssiden).
// Komponenterne importeres direkte, ikke via @/components/tasks, så barrel-
// filen ikke trækker TaskFormModal med i det første load.
const TaskFormModal = dynamic(
  () => import("@/components/tasks/TaskFormModal").then((m) => m.TaskFormModal),
  { ssr: false },
);
const MarkIrrelevantDialog = dynamic(
  () =>
    import("@/components/tasks/MarkIrrelevantDialog").then(
      (m) => m.MarkIrrelevantDialog,
    ),
  { ssr: false },
);
const SaveAsTemplateModal = dynamic(
  () =>
    import("@/components/templates/SaveAsTemplateModal").then(
      (m) => m.SaveAsTemplateModal,
    ),
  { ssr: false },
);

// Updated status config for new Kanban statuses
const statusConfig = {
  backlog: {
    icon: Circle,
    color: "text-gray-600 bg-gray-100",
  },
  todo: {
    icon: Clock,
    color: "text-blue-600 bg-blue-100",
  },
  in_progress: {
    icon: PlayCircle,
    color: "text-amber-600 bg-amber-100",
  },
  done: {
    icon: CheckCircle2,
    color: "text-green-600 bg-green-100",
  },
};

const priorityConfig = {
  low: {
    color: "text-gray-600",
    bg: "bg-gray-100",
  },
  medium: {
    color: "text-blue-600",
    bg: "bg-blue-100",
  },
  high: {
    color: "text-orange-600",
    bg: "bg-orange-100",
  },
  urgent: {
    color: "text-red-600",
    bg: "bg-red-100",
  },
};

function TasksPageContent() {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const locale = useLocale();
  const fmtOpts = {
    locale: toIntlLocale(locale),
    minuteUnit: t("timeUnits.minute"),
    hourUnit: t("timeUnits.hour"),
  };
  // Preferences store (persisted)
  const {
    viewMode,
    setViewMode,
    statsCollapsed,
    toggleStats,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    clientFilter,
    setClientFilter,
    searchQuery: storedSearch,
    setSearchQuery: setStoredSearch,
    listDensity,
    setListDensity,
    listColumns,
    setListColumns,
    deadlineFilter,
    setDeadlineFilter,
    projectFilter,
    assigneeFilter,
    setAssigneeFilter,
    listGroupBy,
    setListGroupBy,
  } = useTaskPreferencesStore();

  // Local search state for responsive typing (synced to store on debounce)
  const [localSearch, setLocalSearch] = useState(storedSearch);
  const debouncedSearch = useDebounce(localSearch, 300);

  // Sync debounced search to store
  useEffect(() => {
    setStoredSearch(debouncedSearch);
  }, [debouncedSearch, setStoredSearch]);

  const [listSidePanelTask, setListSidePanelTask] = useState<string | null>(
    null,
  );
  const [listContextMenu, setListContextMenu] = useState<{
    task: TaskForList;
    x: number;
    y: number;
  } | null>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!listContextMenu) return;
    const handler = () => setListContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [listContextMenu]);

  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<{
    id: string;
    title: string;
    snapshot: TaskUndoSnapshot;
  } | null>(null);
  const { showUndoToast } = useTaskDeleteUndo();
  const [irrelevantTask, setIrrelevantTask] = useState<{
    id: string;
    title: string;
  } | null>(null);

  // Save as template modal
  const [templateTask, setTemplateTask] = useState<TaskForList | null>(null);

  // Modal state (Phase 3)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskModalData | null>(null);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<
    string | undefined
  >();

  // URL sync (Phase 5)
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize from URL params on mount
  useEffect(() => {
    const urlStatus = searchParams.get("status");
    const urlPriority = searchParams.get("priority");
    const urlView = searchParams.get("view");
    if (urlStatus && urlStatus !== "all") {
      setStatusFilter(urlStatus as typeof statusFilter);
    }
    if (urlPriority && urlPriority !== "all") {
      setPriorityFilter(urlPriority as typeof priorityFilter);
    }
    if (urlView === "list" || urlView === "board") {
      setViewMode(urlView);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get, setPriorityFilter, setStatusFilter, setViewMode]);

  // Debounced URL sync
  const debouncedStatusFilter = useDebounce(statusFilter, 500);
  const debouncedPriorityFilter = useDebounce(priorityFilter, 500);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedStatusFilter !== "active")
      params.set("status", debouncedStatusFilter);
    if (debouncedPriorityFilter !== "all")
      params.set("priority", debouncedPriorityFilter);
    if (viewMode !== "board") params.set("view", viewMode);
    const paramStr = params.toString();
    const newUrl = paramStr
      ? `/dashboard/tasks?${paramStr}`
      : "/dashboard/tasks";
    router.replace(newUrl, { scroll: false });
  }, [debouncedStatusFilter, debouncedPriorityFilter, viewMode, router]);

  // Email-to-task banner
  const [emailBannerDismissed, setEmailBannerDismissed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("tasks-email-banner-dismissed") === "true";
    }
    return false;
  });
  const { data: emailSettings } = trpc.user.getEmailToTaskSettings.useQuery();

  const utils = trpc.useUtils();
  const { data: tasks, isLoading } = trpc.tasks.list.useQuery();
  const { data: stats } = trpc.tasks.getStats.useQuery();
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });
  // Assignee filter is only meaningful in a team (>1 member).
  const { data: session } = useSession();
  const { data: orgMembers } = trpc.organization.getMembers.useQuery();
  const isTeam = (orgMembers?.length ?? 0) > 1;
  const myUserId = session?.user?.id;
  // A persisted member userId may no longer exist (org switch, member removed);
  // treat it as "all" so a stale choice never hides every task.
  const effectiveAssigneeFilter =
    assigneeFilter === "all" ||
    assigneeFilter === "mine" ||
    assigneeFilter === "_none" ||
    orgMembers?.some((m) => m.userId === assigneeFilter)
      ? assigneeFilter
      : "all";

  const bulkUpdateMutation = trpc.tasks.bulkUpdate.useMutation({
    onSuccess: (data) => {
      toast.success(t("page.bulkUpdated", { count: data.count }));
      setSelectedTasks(new Set());
      setShowBulkActions(false);
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
    },
    onError: () => {
      toast.error(t("page.bulkUpdateFailed"));
    },
  });

  const bulkDeleteMutation = trpc.tasks.bulkDelete.useMutation({
    onSuccess: (data) => {
      toast.success(t("page.bulkDeleted", { count: data.count }));
      setSelectedTasks(new Set());
      setShowBulkActions(false);
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
    },
    onError: () => {
      toast.error(t("page.bulkDeleteFailed"));
    },
  });

  const deleteMutation = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("page.deleteFailed"));
    },
  });

  const markDoneMutation = trpc.tasks.markDone.useMutation({
    onSuccess: () => {
      toast.success(t("page.markedDone"));
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("page.updateFailed"));
    },
  });

  const updateTaskMutation = trpc.tasks.update.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("page.updateFailed"));
    },
  });

  const filteredTasks = tasks?.filter((task) => {
    const query = localSearch.toLowerCase();
    const taskProject = Array.isArray(task.project)
      ? task.project[0]
      : task.project;
    const taskClient = Array.isArray(task.client)
      ? task.client[0]
      : task.client;
    const matchesSearch =
      task.title.toLowerCase().includes(query) ||
      task.description?.toLowerCase().includes(query) ||
      (taskProject?.name || "").toLowerCase().includes(query) ||
      (taskClient?.name || "").toLowerCase().includes(query);

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && task.status !== "done") ||
      task.status === statusFilter;

    const matchesPriority =
      priorityFilter === "all" || task.priority === priorityFilter;

    const matchesClient =
      clientFilter === "all" ||
      taskClient?.id === clientFilter ||
      (!taskClient && clientFilter === "_none");

    const matchesDeadline =
      deadlineFilter === "all" ||
      (() => {
        if (!task.deadline) return false;
        const now = new Date();
        const deadline = new Date(task.deadline);
        const daysUntil = Math.ceil(
          (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (deadlineFilter === "overdue") return daysUntil < 0;
        if (deadlineFilter === "this_week") return daysUntil <= 7;
        if (deadlineFilter === "this_month") return daysUntil <= 30;
        return true;
      })();

    const matchesProject =
      projectFilter === "all" || taskProject?.id === projectFilter;

    const matchesAssignee =
      !isTeam ||
      effectiveAssigneeFilter === "all" ||
      (effectiveAssigneeFilter === "mine"
        ? task.assignedToUserId === myUserId
        : effectiveAssigneeFilter === "_none"
          ? !task.assignedToUserId
          : task.assignedToUserId === effectiveAssigneeFilter);

    return (
      matchesSearch &&
      matchesStatus &&
      matchesPriority &&
      matchesClient &&
      matchesDeadline &&
      matchesProject &&
      matchesAssignee
    );
  });

  // Samlet estimeret vs. brugt for de filtrerede opgaver med estimat (#212)
  const estimateSummary = (filteredTasks ?? []).reduce(
    (acc, task) => {
      if (task.estimatedMinutes && task.estimatedMinutes > 0) {
        acc.estimated += task.estimatedMinutes;
        acc.tracked += task.trackedMinutes ?? 0;
      }
      return acc;
    },
    { estimated: 0, tracked: 0 },
  );

  // Handle add task from Kanban column - open modal (Phase 3)
  const handleAddTask = useCallback((status: KanbanStatus) => {
    setEditingTask(null);
    setModalDefaultStatus(status);
    setModalOpen(true);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-9 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2" />
            <div className="h-5 w-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          </div>
        </div>
        <SkeletonStats />
        <SkeletonList items={5} />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-tour="tasks-board">
      {/* Header */}
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        helpTopicId="tasks"
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* View mode toggle */}
            <div
              className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 shrink-0"
              data-tour="tasks-view-toggle"
            >
              <button
                type="button"
                onClick={() => setViewMode("board")}
                aria-label={t("page.board")}
                aria-pressed={viewMode === "board"}
                className={`
                  flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                  ${
                    viewMode === "board"
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }
                `}
              >
                <Kanban className="h-4 w-4" />
                <span className="hidden xs:inline">{t("page.board")}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-label={t("page.list")}
                aria-pressed={viewMode === "list"}
                className={`
                  flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                  ${
                    viewMode === "list"
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }
                `}
              >
                <List className="h-4 w-4" />
                <span className="hidden xs:inline">{t("page.list")}</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                setTemplateTask({
                  id: "",
                  title: "",
                  description: null,
                  status: "todo",
                  priority: null,
                  deadline: null,
                  estimatedMinutes: null,
                  actualMinutes: null,
                  project: null,
                  client: null,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              title={t("page.newTemplate")}
              aria-label={t("page.newTemplate")}
            >
              <Bookmark className="h-4 w-4" />
              <span className="hidden sm:inline">{t("page.newTemplate")}</span>
            </button>
            <Button
              leftIcon={<Plus className="h-4 w-4 sm:h-5 sm:w-5" />}
              onClick={() => {
                setEditingTask(null);
                setModalDefaultStatus(undefined);
                setModalOpen(true);
              }}
              data-tour="tasks-add-btn"
            >
              {t("page.newTask")}
            </Button>
          </div>
        }
      />

      {/* Email-to-Task Banner */}
      {emailSettings && !emailBannerDismissed && (
        <div className="flex items-center gap-3 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 dark:border-teal-800 dark:bg-teal-950/50">
          <Mail className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
          {emailSettings.enabled ? (
            <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-teal-800 dark:text-teal-200">
                {t("page.forwardEmailsTo")}
              </span>
              <code className="rounded bg-teal-100 px-2 py-0.5 text-xs font-mono text-teal-900 dark:bg-teal-900 dark:text-teal-100">
                {emailSettings.inboundEmail}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(
                    emailSettings.inboundEmail || "",
                  );
                  toast.success(t("page.emailCopied"));
                }}
                className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-200"
                title={t("page.copyEmail")}
              >
                <Copy className="h-3.5 w-3.5" />
                {t("page.copy")}
              </button>
              <span className="text-teal-500 dark:text-teal-600">|</span>
              <Link
                href="/dashboard/settings/ai"
                className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-200"
              >
                <Settings className="h-3.5 w-3.5" />
                {t("page.settings")}
              </Link>
            </div>
          ) : (
            <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-teal-800 dark:text-teal-200">
                {t("page.createFromEmails")}
              </span>
              <Link
                href="/dashboard/settings/ai"
                className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-100"
              >
                {t("page.enableEmailToTask")}
              </Link>
              <span className="text-teal-500 dark:text-teal-600">|</span>
              <Link
                href="/dashboard/settings/email?tab=integration"
                className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-200"
              >
                {t("page.imapSync")}
              </Link>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setEmailBannerDismissed(true);
              localStorage.setItem("tasks-email-banner-dismissed", "true");
            }}
            className="shrink-0 rounded p-1 text-teal-500 hover:bg-teal-100 hover:text-teal-700 dark:text-teal-500 dark:hover:bg-teal-900 dark:hover:text-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
            title={t("page.hideBanner")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Quick add */}
      <QuickAddTask />

      {/* Collapsible Stats (Phase 1) */}
      {stats && (
        <div>
          <button
            type="button"
            onClick={toggleStats}
            className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-750"
          >
            {statsCollapsed ? (
              <ChevronRight className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
            <span className="font-medium text-gray-900 dark:text-white">
              {t("page.summaryTasks", { count: stats.total })}
            </span>
            <span className="text-gray-400">|</span>
            <span className="text-amber-600 font-medium">
              {t("page.summaryInProgress", { count: stats.inProgress })}
            </span>
            {stats.overdue > 0 && (
              <>
                <span className="text-gray-400">|</span>
                <span className="text-red-600 font-medium">
                  {t("page.summaryOverdue", { count: stats.overdue })}
                </span>
              </>
            )}
            {estimateSummary.estimated > 0 && (
              <>
                <span className="text-gray-400">|</span>
                <span
                  className="tabular-nums text-gray-600 dark:text-gray-300"
                  title={t("page.summaryEstimateTitle")}
                >
                  {t("page.summaryEstimate", {
                    tracked: formatTaskMinutes(
                      estimateSummary.tracked,
                      fmtOpts,
                    ),
                    estimated: formatTaskMinutes(
                      estimateSummary.estimated,
                      fmtOpts,
                    ),
                  })}
                </span>
              </>
            )}
          </button>

          {!statsCollapsed && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 md:grid-cols-6">
              <div className="rounded-lg border border-gray-200 bg-white p-2.5 sm:p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
                  {stats.total}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t("page.statTotal")}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-2.5 sm:p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="text-lg sm:text-2xl font-bold text-gray-500">
                  {stats.backlog}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t("status.backlog")}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-2.5 sm:p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="text-lg sm:text-2xl font-bold text-brand-600 dark:text-brand-400">
                  {stats.todo}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t("status.todo")}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-2.5 sm:p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="text-lg sm:text-2xl font-bold text-amber-600">
                  {stats.inProgress}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t("status.in_progress")}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-2.5 sm:p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="text-lg sm:text-2xl font-bold text-green-600">
                  {stats.done}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t("status.done")}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-2.5 sm:p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="text-lg sm:text-2xl font-bold text-red-600">
                  {stats.overdue}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t("page.statOverdue")}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Board View */}
      {viewMode === "board" && <KanbanBoard onAddTask={handleAddTask} />}

      {/* List View */}
      {viewMode === "list" && (
        <>
          {/* Filter presets */}
          <FilterPresetBar />

          {/* Filter bar with chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 py-1.5 pl-8 pr-3 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
            </div>
            <FilterChip
              label={t("page.filterStatus")}
              value={statusFilter}
              options={[
                { value: "active", label: t("page.filterActive") },
                { value: "all", label: t("filters.all") },
                { value: "backlog", label: t("status.backlog") },
                { value: "todo", label: t("status.todo") },
                { value: "in_progress", label: t("status.in_progress") },
                { value: "done", label: t("status.done") },
              ]}
              activeColor="bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
              onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            />
            <FilterChip
              label={t("filters.priority")}
              value={priorityFilter}
              options={[
                { value: "all", label: t("filters.all") },
                { value: "urgent", label: t("priority.urgent") },
                { value: "high", label: t("priority.high") },
                { value: "medium", label: t("priority.medium") },
                { value: "low", label: t("priority.low") },
              ]}
              activeColor="bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
              onChange={(v) => setPriorityFilter(v as typeof priorityFilter)}
            />
            <FilterChip
              label={t("filters.client")}
              value={clientFilter}
              options={[
                { value: "all", label: t("filters.allClients") },
                { value: "_none", label: t("taskForm.noClient") },
                ...((
                  clients as
                    | {
                        id: string;
                        name: string;
                        isArchived?: boolean;
                      }[]
                    | undefined
                )
                  ?.filter((c) => !c.isArchived)
                  .map((c) => ({ value: c.id, label: c.name })) ?? []),
              ]}
              activeColor="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
              onChange={setClientFilter}
            />
            <FilterChip
              label={t("filters.deadline")}
              value={deadlineFilter}
              options={[
                { value: "all", label: t("filters.all") },
                { value: "overdue", label: t("filters.overdue") },
                { value: "this_week", label: t("filters.thisWeek") },
                { value: "this_month", label: t("filters.thisMonth") },
              ]}
              activeColor="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
              onChange={(v) => setDeadlineFilter(v as typeof deadlineFilter)}
            />
            {isTeam && (
              <FilterChip
                label={t("filters.assignee")}
                value={effectiveAssigneeFilter}
                options={[
                  { value: "all", label: t("filters.all") },
                  { value: "mine", label: t("filters.mine") },
                  { value: "_none", label: t("filters.unassigned") },
                  ...(orgMembers ?? []).map((m) => ({
                    value: m.userId,
                    label: m.name,
                  })),
                ]}
                activeColor="bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
                onChange={setAssigneeFilter}
              />
            )}
            <div className="flex-1" />
            <select
              value={listGroupBy}
              onChange={(e) =>
                setListGroupBy(e.target.value as typeof listGroupBy)
              }
              className="rounded-full px-3 py-1 text-[11px] font-medium border-0 cursor-pointer appearance-none bg-no-repeat bg-[length:12px] bg-[right_6px_center] pr-5 focus:outline-none focus:ring-1 focus:ring-brand-500/30 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              }}
            >
              <option value="none">{t("page.groupBy")}</option>
              <option value="client">{t("filters.client")}</option>
              <option value="project">{t("filters.project")}</option>
              <option value="priority">{t("filters.priority")}</option>
              <option value="status">{t("page.filterStatus")}</option>
            </select>
            <DensityToggle value={listDensity} onChange={setListDensity} />
            <ColumnConfigPopover
              visibleColumns={listColumns}
              onChange={setListColumns}
              density={listDensity}
            />
          </div>

          {/* Task table */}
          <TaskListTable
            tasks={(filteredTasks as TaskForList[]) ?? []}
            isLoading={isLoading}
            onTaskClick={(task) => setListSidePanelTask(task.id)}
            onContextMenu={(e, task) => {
              const x = Math.min(e.clientX, window.innerWidth - 200);
              const y = Math.min(e.clientY, window.innerHeight - 300);
              setListContextMenu({ task, x, y });
            }}
            selectedTasks={selectedTasks}
            onSelectionChange={setSelectedTasks}
            onMarkDone={(id) => markDoneMutation.mutate({ id })}
            onUpdateTask={(taskId, updates) => {
              updateTaskMutation.mutate({ id: taskId, ...updates });
            }}
            onEditTask={(task) => {
              setEditingTask({
                id: task.id,
                title: task.title,
                description: task.description,
                projectId: task.project?.id || null,
                clientId: task.client?.id || null,
                status: task.status,
                statusId: task.statusId,
                priority: task.priority,
                deadline: task.deadline,
                estimatedMinutes: task.estimatedMinutes,
              });
              setModalOpen(true);
            }}
          />

          {/* Context menu for list view */}
          {listContextMenu && (
            <div
              className="fixed z-50 min-w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
              style={{ left: listContextMenu.x, top: listContextMenu.y }}
            >
              <button
                type="button"
                onClick={() => {
                  setListSidePanelTask(listContextMenu.task.id);
                  setListContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {t("page.showDetails")}
              </button>
              <Link
                href={`/dashboard/tasks/${listContextMenu.task.id}`}
                onClick={() => setListContextMenu(null)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {t("page.openTask")}
              </Link>
              <button
                type="button"
                onClick={() => {
                  setListContextMenu(null);
                  setEditingTask({
                    id: listContextMenu.task.id,
                    title: listContextMenu.task.title,
                    description: listContextMenu.task.description,
                    projectId: listContextMenu.task.project?.id || null,
                    clientId: listContextMenu.task.client?.id || null,
                    status: listContextMenu.task.status,
                    statusId: listContextMenu.task.statusId,
                    priority: listContextMenu.task.priority,
                    deadline: listContextMenu.task.deadline,
                    estimatedMinutes: listContextMenu.task.estimatedMinutes,
                  });
                  setModalOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {t("page.edit")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTemplateTask(listContextMenu.task);
                  setListContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <Bookmark className="h-3.5 w-3.5" />
                {t("page.saveAsTemplate")}
              </button>
              <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmTask({
                    id: listContextMenu.task.id,
                    title: listContextMenu.task.title,
                    snapshot: {
                      title: listContextMenu.task.title,
                      description: listContextMenu.task.description,
                      projectId: listContextMenu.task.project?.id,
                      clientId: listContextMenu.task.client?.id,
                      status: listContextMenu.task.status,
                      priority: listContextMenu.task.priority,
                      deadline: listContextMenu.task.deadline,
                      estimatedMinutes: listContextMenu.task.estimatedMinutes,
                    },
                  });
                  setListContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                {tc("delete")}
              </button>
            </div>
          )}

          {/* Bulk actions */}
          {selectedTasks.size > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {t("page.selected", { count: selectedTasks.size })}
              </span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowBulkActions(!showBulkActions)}
                  className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
                >
                  {t("page.actions", { count: selectedTasks.size })}
                  <ChevronDown className="h-4 w-4" />
                </button>

                {showBulkActions && (
                  <div className="absolute right-0 z-10 mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    <div className="py-1">
                      {/* Status change */}
                      <div className="px-4 py-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                        {t("page.changeStatus")}
                      </div>
                      {(
                        Object.entries(statusConfig) as [
                          string,
                          (typeof statusConfig)[keyof typeof statusConfig],
                        ][]
                      ).map(([key, cfg]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            bulkUpdateMutation.mutate({
                              taskIds: Array.from(selectedTasks),
                              updates: {
                                status: key as
                                  | "backlog"
                                  | "todo"
                                  | "in_progress"
                                  | "done",
                              },
                            });
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                          <cfg.icon
                            className={`h-4 w-4 ${cfg.color.split(" ")[0]}`}
                          />
                          {t(`status.${key}`)}
                        </button>
                      ))}

                      <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                      {/* Priority change */}
                      <div className="px-4 py-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                        {t("page.changePriority")}
                      </div>
                      {(
                        Object.entries(priorityConfig) as [
                          string,
                          (typeof priorityConfig)[keyof typeof priorityConfig],
                        ][]
                      ).map(([key, cfg]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            bulkUpdateMutation.mutate({
                              taskIds: Array.from(selectedTasks),
                              updates: {
                                priority: key as
                                  | "low"
                                  | "medium"
                                  | "high"
                                  | "urgent",
                              },
                            });
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${cfg.bg}`}
                          />
                          {key === "medium"
                            ? t("taskForm.priorityMedium")
                            : t(`priority.${key as "low" | "high" | "urgent"}`)}
                        </button>
                      ))}

                      <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                      {/* Client assignment */}
                      <div className="px-4 py-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                        {t("page.assignClient")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          bulkUpdateMutation.mutate({
                            taskIds: Array.from(selectedTasks),
                            updates: { clientId: null },
                          });
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-500 italic hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700"
                      >
                        {t("page.removeClient")}
                      </button>
                      {clients?.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => {
                            bulkUpdateMutation.mutate({
                              taskIds: Array.from(selectedTasks),
                              updates: { clientId: client.id },
                            });
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                          {client.name}
                        </button>
                      ))}

                      <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={() => setShowBulkDeleteConfirm(true)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("page.deleteSelected", {
                          count: selectedTasks.size,
                        })}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stats */}
          {filteredTasks && filteredTasks.length > 0 && (
            <Card padding="sm">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {t.rich("page.showing", {
                  shown: filteredTasks.length,
                  total: tasks?.length ?? 0,
                  b: (chunks) => (
                    <span className="font-medium text-gray-900 dark:text-white">
                      {chunks}
                    </span>
                  ),
                })}
              </div>
            </Card>
          )}

          {/* Side panel for list view */}
          <TaskSidePanel
            taskId={listSidePanelTask}
            onClose={() => setListSidePanelTask(null)}
          />
        </>
      )}

      {/* Task Form Modal (Phase 3) */}
      <TaskFormModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingTask(null);
        }}
        task={editingTask}
        defaultStatus={modalDefaultStatus}
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmDialog
        isOpen={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        onConfirm={() => {
          bulkDeleteMutation.mutate({
            taskIds: Array.from(selectedTasks),
          });
          setShowBulkDeleteConfirm(false);
        }}
        title={t("page.bulkDeleteTitle")}
        description={t("page.bulkDeleteConfirm", { count: selectedTasks.size })}
        confirmLabel={t("page.deleteSelected", { count: selectedTasks.size })}
        variant="danger"
        isLoading={bulkDeleteMutation.isPending}
      />

      {/* Single Task Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirmTask}
        onClose={() => setDeleteConfirmTask(null)}
        onConfirm={() => {
          if (deleteConfirmTask) {
            const { snapshot } = deleteConfirmTask;
            deleteMutation.mutate(
              { id: deleteConfirmTask.id },
              { onSuccess: () => showUndoToast(snapshot) },
            );
            setDeleteConfirmTask(null);
          }
        }}
        title={t("page.deleteTitle")}
        description={t("page.deleteConfirm", {
          title: deleteConfirmTask?.title ?? "",
        })}
        confirmLabel={tc("delete")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />

      {/* Mark as Irrelevant Dialog (email tasks) */}
      <MarkIrrelevantDialog
        taskId={irrelevantTask?.id || ""}
        taskTitle={irrelevantTask?.title || ""}
        open={!!irrelevantTask}
        onClose={() => setIrrelevantTask(null)}
      />

      {/* Save as Template Modal */}
      <SaveAsTemplateModal
        isOpen={!!templateTask}
        onClose={() => setTemplateTask(null)}
        defaultTemplateType="task"
        defaultName={templateTask?.title || ""}
        defaultDescription={templateTask?.description || ""}
        defaultProjectId={templateTask?.project?.id}
        defaultClientId={templateTask?.client?.id}
      />

      {/* Click outside to close bulk actions */}
      {showBulkActions && (
        <button
          type="button"
          className="fixed inset-0 z-0"
          onClick={() => setShowBulkActions(false)}
          aria-label={t("page.closeMenu")}
        />
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <ModuleGuard module="tasks">
      <TasksPageContent />
    </ModuleGuard>
  );
}
