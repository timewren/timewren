"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  Paperclip,
  PlayCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  type ComponentProps,
  type KeyboardEvent,
  use,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/dashboard-nav";
import { SubtasksSection } from "@/components/tasks/SubtasksSection";
import { TaskAttachments } from "@/components/tasks/TaskAttachments";

const TaskNotes = dynamic(
  () => import("@/components/tasks/TaskNotes").then((m) => m.TaskNotes),
  { ssr: false },
);

const TaskComments = dynamic(
  () => import("@/components/tasks/TaskComments").then((m) => m.TaskComments),
  { ssr: false },
);

import { TimeIntervalsOverview } from "@/components/time/TimeIntervalsOverview";
import { ConfirmDialog } from "@/components/ui";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useModules } from "@/hooks/useModules";
import { useTaskDeleteUndo } from "@/hooks/useTaskDeleteUndo";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import { clockRangeHours, clockRangeToInstants } from "@/lib/time/clock-range";
import { trpc } from "@/providers/trpc-provider";

const statusConfig = {
  backlog: {
    icon: Circle,
    color: "text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-700",
  },
  todo: {
    icon: Clock,
    color: "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30",
  },
  in_progress: {
    icon: PlayCircle,
    color:
      "text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30",
  },
  done: {
    icon: CheckCircle2,
    color:
      "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30",
  },
};

const priorityConfig = {
  low: {
    color: "text-gray-600 dark:text-gray-400",
    bg: "bg-gray-100 dark:bg-gray-700",
  },
  medium: {
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-900/30",
  },
  high: {
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-100 dark:bg-orange-900/30",
  },
  urgent: {
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-900/30",
  },
};

const statusKeys = ["backlog", "todo", "in_progress", "done"] as const;
const priorityKeys = ["low", "medium", "high", "urgent"] as const;

type TabId = "activity" | "attachments" | "time" | "email";

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const locale = useLocale();
  const intlLocale = toIntlLocale(locale);
  const priorityLabel = (key: (typeof priorityKeys)[number]) =>
    key === "medium" ? t("taskForm.priorityMedium") : t(`priority.${key}`);
  const router = useRouter();

  // Inline editing states
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("activity");

  const utils = trpc.useUtils();

  const { data: task, isLoading } = trpc.tasks.getById.useQuery({ id });
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });
  const { data: emailThread } = trpc.emailTasks.getThreadForTask.useQuery(
    { taskId: id },
    { enabled: !!id },
  );
  const { data: attachments } = trpc.emailTasks.getAttachments.useQuery(
    { taskId: id },
    { enabled: !!id },
  );

  // Fetch time entries linked to this task
  const { data: timeEntriesData } = trpc.time.list.useQuery(
    { taskId: id },
    { enabled: !!id },
  );
  // Normalize relations that Drizzle might return as arrays
  const timeEntries = timeEntriesData?.entries?.map((entry) => ({
    ...entry,
    project: Array.isArray(entry.project) ? entry.project[0] : entry.project,
    client: Array.isArray(entry.client) ? entry.client[0] : entry.client,
  }));

  const { showUndoToast } = useTaskDeleteUndo();
  const deleteMutation = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      // Fortryd-toast med snapshot vises af onConfirm-flowet
      router.push("/dashboard/tasks");
    },
    onError: (error) => toast.error(error.message || t("detail.deleteFailed")),
  });

  const markDoneMutation = trpc.tasks.markDone.useMutation({
    onSuccess: () => {
      utils.tasks.getById.invalidate({ id });
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
      toast.success(t("detail.markedDone"));
    },
  });

  const updateMutation = trpc.tasks.update.useMutation({
    onSuccess: () => {
      utils.tasks.getById.invalidate({ id });
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
      setEditingField(null);
    },
    onError: (error) => {
      toast.error(t("detail.updateFailed"), { description: error.message });
    },
  });

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const handleMarkDone = () => {
    markDoneMutation.mutate({ id });
  };

  const handleReopen = () => {
    updateMutation.mutate({ id, status: "todo" });
  };

  const handleStartTimer = () => {
    const params = new URLSearchParams();
    if (task?.projectId) params.set("projectId", task.projectId);
    if (task?.clientId) params.set("clientId", task.clientId);
    params.set("description", task?.title || "");
    router.push(`/dashboard/time/new?${params.toString()}`);
  };

  // Inline edit handlers
  const startEditTitle = () => {
    if (!task) return;
    setEditTitle(task.title);
    setEditingField("title");
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  };

  const saveTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== task?.title) {
      updateMutation.mutate({ id, title: trimmed });
    } else {
      setEditingField(null);
    }
  };

  const startEditDescription = () => {
    if (!task) return;
    setEditDescription(task.description || "");
    setEditingField("description");
    setTimeout(() => descriptionRef.current?.focus(), 0);
  };

  const saveDescription = () => {
    const val = editDescription.trim();
    if (val !== (task?.description || "")) {
      updateMutation.mutate({ id, description: val || null });
    } else {
      setEditingField(null);
    }
  };

  const handleStatusChange = (newStatus: string) => {
    updateMutation.mutate({
      id,
      status: newStatus as "backlog" | "todo" | "in_progress" | "done",
    });
  };

  const handlePriorityChange = (newPriority: string) => {
    updateMutation.mutate({
      id,
      priority: newPriority as "low" | "medium" | "high" | "urgent",
    });
  };

  const startEditDeadline = () => {
    if (!task) return;
    setEditDeadline(
      task.deadline ? toLocalDateStr(new Date(task.deadline)) : "",
    );
    setEditingField("deadline");
  };

  const saveDeadline = () => {
    const newDeadline = editDeadline ? new Date(editDeadline) : null;
    const currentDeadline = task?.deadline
      ? toLocalDateStr(new Date(task.deadline))
      : "";
    if (editDeadline !== currentDeadline) {
      updateMutation.mutate({ id, deadline: newDeadline });
    } else {
      setEditingField(null);
    }
  };

  // Check if deadline is overdue or approaching
  const getDeadlineStatus = (deadline: Date | null, status: string) => {
    if (!deadline || status === "done") return null;

    const now = new Date();
    const deadlineDate = new Date(deadline);
    const daysUntil = Math.ceil(
      (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntil < 0) {
      return {
        kind: "overdue" as const,
        label: "",
        color: "text-red-600",
        urgent: true,
      };
    } else if (daysUntil === 0) {
      return {
        kind: "today" as const,
        label: "",
        color: "text-red-600",
        urgent: true,
      };
    } else if (daysUntil <= 3) {
      return {
        kind: "soon" as const,
        label: t("deadline.inDays", { count: daysUntil }),
        color: "text-yellow-600",
        urgent: true,
      };
    }
    return {
      kind: "later" as const,
      label: deadlineDate.toLocaleDateString(intlLocale),
      color: "text-gray-600",
      urgent: false,
    };
  };

  if (isLoading) {
    return <LoadingScreen message={t("detail.loading")} />;
  }

  if (!task) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-600 dark:text-gray-400">
          {t("detail.notFound")}
        </p>
        <Link
          href="/dashboard/tasks"
          className="mt-4 inline-flex items-center gap-2 text-brand-600 dark:text-brand-400"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("detail.backToTasks")}
        </Link>
      </div>
    );
  }

  const status = statusConfig[task.status as keyof typeof statusConfig];
  const priority =
    priorityConfig[(task.priority || "medium") as keyof typeof priorityConfig];
  const StatusIcon = status.icon;
  const deadlineStatus = getDeadlineStatus(task.deadline, task.status);

  const taskProject = task.project
    ? Array.isArray(task.project)
      ? task.project[0]
      : task.project
    : null;
  const taskClient = task.client
    ? Array.isArray(task.client)
      ? task.client[0]
      : task.client
    : null;

  const tabs: { id: TabId; label: string; count?: number; hidden?: boolean }[] =
    [
      { id: "activity", label: t("detail.tabActivity") },
      {
        id: "attachments",
        label: t("detail.tabAttachments"),
        count: attachments?.length || 0,
      },
      {
        id: "time",
        label: t("detail.tabTime"),
        count: timeEntries?.length || 0,
      },
      {
        id: "email",
        label: t("detail.tabEmail"),
        count: emailThread?.length || 0,
        hidden: !emailThread || emailThread.length === 0,
      },
    ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Click outside to close dropdowns */}
      {(editingField === "status" ||
        editingField === "priority" ||
        editingField === "client") && (
        <button
          type="button"
          className="fixed inset-0 z-0"
          onClick={() => setEditingField(null)}
          aria-label={t("detail.closeDropdown")}
        />
      )}

      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: t("page.title"), href: "/dashboard/tasks" },
          { label: task.title },
        ]}
      />

      {/* Top section: 2-column grid */}
      <div className="grid gap-8" style={{ gridTemplateColumns: "1fr 280px" }}>
        {/* Left column */}
        <div className="min-w-0">
          {/* Title */}
          {editingField === "title" ? (
            <div className="flex items-center gap-2">
              <input
                ref={titleInputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") setEditingField(null);
                }}
                onBlur={saveTitle}
                className="w-full rounded-lg border border-brand-400 bg-white px-3 py-1.5 text-2xl font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-brand-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
          ) : (
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              <button
                type="button"
                onClick={startEditTitle}
                className="cursor-pointer rounded-lg px-1 py-0.5 text-left font-bold transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                title={t("detail.clickToEdit")}
              >
                {task.title}
              </button>
            </h1>
          )}

          {/* Project & Client links */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm">
            {taskProject && (
              <Link
                href={`/dashboard/projects/${taskProject.id}`}
                className="text-gray-600 hover:text-brand-600 dark:text-gray-400 dark:hover:text-brand-400"
              >
                {taskProject.name}
              </Link>
            )}
            {taskProject && taskClient && (
              <span className="text-gray-300 dark:text-gray-600">/</span>
            )}
            {taskClient && (
              <span className="text-gray-500 dark:text-gray-400">
                {taskClient.name}
              </span>
            )}
          </div>

          {/* Description */}
          <div className="mt-4 px-1">
            {editingField === "description" ? (
              <div>
                <textarea
                  ref={descriptionRef}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  onBlur={saveDescription}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditingField(null);
                  }}
                  rows={4}
                  className="w-full rounded-lg border border-brand-400 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-brand-600 dark:bg-gray-700 dark:text-white"
                />
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={saveDescription}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-tt-gran-lys"
                  >
                    <Check className="h-3 w-3" /> {tc("save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingField(null)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <X className="h-3 w-3" /> {tc("cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={startEditDescription}
                className="block w-full cursor-pointer rounded-lg p-2 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                title={t("detail.clickToEdit")}
              >
                {task.description ? (
                  <span className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                    {task.description}
                  </span>
                ) : (
                  <span className="italic text-gray-400 dark:text-gray-500">
                    {t("sidePanel.addDescription")}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Notes */}
          <div className="mt-6 px-1">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t("sidePanel.notes")}
            </h3>
            <TaskNotes
              content={task.notes ?? null}
              onSave={(notes) => updateMutation.mutate({ id, notes })}
            />
          </div>

          {/* Subtasks */}
          {(task.subtasks?.length > 0 || task.status !== "done") && (
            <div className="mt-6 px-1">
              <SubtasksSection taskId={id} subtasks={task.subtasks ?? []} />
            </div>
          )}

          {/* Deadline Warning */}
          {deadlineStatus?.urgent && (
            <div
              className={`mt-4 flex items-center gap-2 rounded-lg border ${
                deadlineStatus.color === "text-red-600"
                  ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
                  : "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20"
              } p-4`}
            >
              <AlertCircle className={`h-5 w-5 ${deadlineStatus.color}`} />
              <div>
                <p className={`font-medium ${deadlineStatus.color}`}>
                  {deadlineStatus.kind === "overdue"
                    ? t("detail.deadlineOverdue")
                    : deadlineStatus.kind === "today"
                      ? t("detail.deadlineToday")
                      : t("detail.deadlineIn", { days: deadlineStatus.label })}
                </p>
                {task.deadline && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {new Date(task.deadline).toLocaleDateString(intlLocale, {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="min-[900px]:sticky min-[900px]:top-20 min-[900px]:self-start">
          <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-900/50">
            {/* Property list */}
            <div className="space-y-3">
              {/* Status */}
              <div className="relative flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("detail.status")}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEditingField(editingField === "status" ? null : "status")
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80 ${status.color}`}
                  title={t("detail.changeStatus")}
                >
                  <StatusIcon className="h-3.5 w-3.5" />
                  {t(`status.${task.status as keyof typeof statusConfig}`)}
                </button>
                {editingField === "status" && (
                  <div className="absolute right-0 top-full z-10 mt-1 min-w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    {statusKeys.map((s) => {
                      const cfg = statusConfig[s];
                      const Icon = cfg.icon;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => handleStatusChange(s)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                            task.status === s
                              ? "font-medium text-brand-600"
                              : "text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          <Icon
                            className={`h-4 w-4 ${cfg.color.split(" ")[0]}`}
                          />
                          {t(`status.${s}`)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Priority */}
              <div className="relative flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("detail.priority")}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEditingField(
                      editingField === "priority" ? null : "priority",
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80 ${priority.color} ${priority.bg}`}
                  title={t("detail.changePriority")}
                >
                  {priorityLabel(
                    (task.priority ||
                      "medium") as (typeof priorityKeys)[number],
                  )}
                </button>
                {editingField === "priority" && (
                  <div className="absolute right-0 top-full z-10 mt-1 min-w-32 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    {priorityKeys.map((p) => {
                      const cfg = priorityConfig[p];
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handlePriorityChange(p)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                            task.priority === p
                              ? "font-medium text-brand-600"
                              : "text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${cfg.bg}`}
                          />
                          {priorityLabel(p)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Deadline */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("detail.deadline")}
                </span>
                {editingField === "deadline" ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={editDeadline}
                      onChange={(e) => setEditDeadline(e.target.value)}
                      className="rounded border border-brand-400 bg-white px-2 py-0.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-brand-600 dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={saveDeadline}
                      className="rounded p-0.5 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-tt-gran-lys"
                      aria-label={t("detail.saveDeadline")}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingField(null)}
                      className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                      aria-label={tc("cancel")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startEditDeadline}
                    className="text-xs text-gray-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-400"
                    title={t("detail.changeDeadline")}
                  >
                    {task.deadline ? (
                      new Date(task.deadline).toLocaleDateString(intlLocale)
                    ) : (
                      <span className="text-xs italic text-gray-400">
                        {t("detail.none")}
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* Kunde */}
              <div className="relative flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("detail.client")}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEditingField(editingField === "client" ? null : "client")
                  }
                  className="max-w-[160px] truncate text-xs text-gray-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-400"
                  title={
                    taskClient ? taskClient.name : t("detail.changeClient")
                  }
                >
                  {taskClient ? (
                    taskClient.name
                  ) : (
                    <span className="italic text-gray-400">
                      {t("detail.none")}
                    </span>
                  )}
                </button>
                {editingField === "client" && (
                  <div className="absolute right-0 top-full z-10 mt-1 min-w-48 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    <button
                      type="button"
                      onClick={() => {
                        updateMutation.mutate({ id, clientId: null });
                        setEditingField(null);
                      }}
                      className={`flex w-full items-center px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        !task.clientId
                          ? "font-medium text-brand-600"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {t("detail.noClient")}
                    </button>
                    {clients?.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          updateMutation.mutate({ id, clientId: c.id });
                          setEditingField(null);
                        }}
                        className={`flex w-full items-center px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                          task.clientId === c.id
                            ? "font-medium text-brand-600"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Projekt */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("detail.project")}
                </span>
                <span className="max-w-[160px] truncate text-xs text-gray-900 dark:text-white">
                  {taskProject ? (
                    <Link
                      href={`/dashboard/projects/${taskProject.id}`}
                      className="hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      {taskProject.name}
                    </Link>
                  ) : (
                    <span className="italic text-gray-400">
                      {t("detail.none")}
                    </span>
                  )}
                </span>
              </div>

              {/* Oprettet */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("detail.created")}
                </span>
                <span className="text-xs text-gray-900 dark:text-white">
                  {new Date(task.createdAt).toLocaleDateString(intlLocale, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>

              {/* Opdateret */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("detail.updated")}
                </span>
                <span className="text-xs text-gray-900 dark:text-white">
                  {new Date(task.updatedAt).toLocaleDateString(intlLocale, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>

              {/* Afsluttet (if done) */}
              {task.completedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t("detail.completed")}
                  </span>
                  <span className="text-xs text-gray-900 dark:text-white">
                    {new Date(task.completedAt).toLocaleDateString(intlLocale, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleStartTimer}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-tt-gran px-3 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
              >
                <Clock className="h-4 w-4" />
                {t("detail.startTimer")}
              </button>
              {task.status === "done" ? (
                <button
                  type="button"
                  onClick={handleReopen}
                  disabled={updateMutation.isPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                >
                  <Circle className="h-4 w-4" />
                  {t("detail.reopen")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleMarkDone}
                  disabled={markDoneMutation.isPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-green-600 bg-white px-3 py-2 text-sm font-medium text-green-600 hover:bg-green-50 disabled:opacity-50 dark:bg-gray-700"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {t("detail.markDone")}
                </button>
              )}
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-4 w-4" />
                {tc("delete")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom section: Full-width tabs */}
      <div>
        {/* Tab bar */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav
            className="-mb-px flex gap-6 overflow-x-auto"
            aria-label={t("detail.sectionsLabel")}
          >
            {tabs
              .filter((tab) => !tab.hidden)
              .map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-selected={activeTab === tab.id}
                  role="tab"
                  className={`whitespace-nowrap pb-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? "border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                      : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  }`}
                >
                  {tab.label}
                  {tab.count ? ` (${tab.count})` : ""}
                </button>
              ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="pt-6">
          {/* Aktivitet tab */}
          {activeTab === "activity" && <TaskComments taskId={id} />}

          {/* Vedhæftninger tab */}
          {activeTab === "attachments" && (
            <div className="space-y-6">
              {/* Task attachments (images etc.) */}
              <TaskAttachments taskId={id} />

              {/* Email attachments */}
              {attachments && attachments.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("detail.emailAttachments")}
                  </h3>
                  <div className="space-y-2">
                    {attachments.map((att) => (
                      <a
                        key={att.id}
                        href={`/api/attachments/${att.id}`}
                        className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                      >
                        <Download className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                            {att.filename}
                          </p>
                          <p className="text-xs text-gray-500">
                            {att.sizeBytes < 1024
                              ? `${att.sizeBytes} B`
                              : att.sizeBytes < 1024 * 1024
                                ? `${Math.round(att.sizeBytes / 1024)} KB`
                                : `${(att.sizeBytes / (1024 * 1024)).toFixed(1)} MB`}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {(!attachments || attachments.length === 0) && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Paperclip className="h-10 w-10 text-gray-300 dark:text-gray-600" />
                  <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    {t("detail.noAttachments")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Tid tab */}
          {activeTab === "time" && (
            <TimeTab
              taskId={id}
              task={task}
              timeEntries={timeEntries}
              onStartTimer={handleStartTimer}
              onTimeAdded={() => {
                utils.time.list.invalidate();
                utils.tasks.getById.invalidate({ id });
              }}
            />
          )}

          {/* Email tab */}
          {activeTab === "email" && emailThread && emailThread.length > 0 && (
            <div className="space-y-4">
              {emailThread.map((message) => (
                <div
                  key={message.id}
                  className="rounded-lg border border-gray-100 p-4 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {message.fromName || message.fromEmail}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(message.receivedDate).toLocaleString(
                        intlLocale,
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {t("detail.from", { email: message.fromEmail })}
                  </div>
                  <div className="mt-2 font-medium text-gray-900 dark:text-white">
                    {message.subject}
                  </div>
                  {message.bodyText && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200">
                      {message.bodyText}
                    </p>
                  )}
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="mt-3 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                      <div className="font-medium text-gray-700 dark:text-gray-200">
                        {t("detail.tabAttachments")}
                      </div>
                      {message.attachments.map((attachment, idx) =>
                        // Uden storagePath er kun metadata gemt (standard),
                        // og der er intet at hente.
                        attachment.storagePath ? (
                          <a
                            // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                            key={`${message.id}-${attachment.filename}-${idx}`}
                            href={`/api/email-attachments/${message.id}/${idx}`}
                            className="block text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                          >
                            {attachment.filename}{" "}
                            <span className="text-gray-400">
                              ({Math.round((attachment.size || 0) / 1024)} KB)
                            </span>
                          </a>
                        ) : (
                          <span
                            // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                            key={`${message.id}-${attachment.filename}-${idx}`}
                            className="block"
                          >
                            {attachment.filename}{" "}
                            <span className="text-gray-400">
                              ({Math.round((attachment.size || 0) / 1024)} KB)
                            </span>
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={async () => {
          const snapshot = task
            ? {
                title: task.title,
                description: task.description,
                projectId: task.projectId,
                clientId: task.clientId,
                status: task.status,
                priority: task.priority,
                deadline: task.deadline,
                estimatedMinutes: task.estimatedMinutes,
              }
            : null;
          try {
            await deleteMutation.mutateAsync({ id });
            if (snapshot) showUndoToast(snapshot);
          } catch {
            // fejl vises som toast via mutationens onError
          } finally {
            setShowDeleteConfirm(false);
          }
        }}
        title={t("page.deleteTitle")}
        description={t("detail.deleteDescription")}
        confirmLabel={tc("delete")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function TimeTab({
  taskId,
  task,
  timeEntries,
  onStartTimer,
  onTimeAdded,
}: {
  taskId: string;
  task: { projectId: string | null; clientId: string | null; title: string };
  timeEntries:
    | ComponentProps<typeof TimeIntervalsOverview>["entries"]
    | undefined;
  onStartTimer: () => void;
  onTimeAdded: () => void;
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [showAddForm, setShowAddForm] = useState(false);
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(toLocalDateStr(new Date()));
  const [useTimeRange, setUseTimeRange] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const calcHoursFromRange = (start: string, end: string): number => {
    if (!start || !end) return 0;
    return clockRangeHours(date, start, end);
  };

  const handleTimeRangeChange = (start: string, end: string) => {
    setStartTime(start);
    setEndTime(end);
    const h = calcHoursFromRange(start, end);
    if (h > 0) setHours(h.toString());
  };

  const createMutation = trpc.time.create.useMutation({
    onSuccess: () => {
      toast.success(t("detail.timeRegistered"));
      setShowAddForm(false);
      setHours("");
      setDescription("");
      setDate(toLocalDateStr(new Date()));
      setStartTime("");
      setEndTime("");
      setUseTimeRange(false);
      onTimeAdded();
    },
    onError: (error) => {
      toast.error(error.message || t("detail.timeFailed"));
    },
  });

  const handleSubmit = () => {
    const h = parseFloat(hours);
    if (!h || h <= 0) {
      toast.error(t("detail.enterHours"));
      return;
    }

    const payload = {
      taskId,
      projectId: task.projectId || undefined,
      clientId: task.clientId || undefined,
      description: description.trim() || task.title,
      hours: h,
      date,
    };

    if (useTimeRange && startTime && endTime) {
      if (startTime === endTime) {
        toast.error(t("detail.endAfterStart"));
        return;
      }
      const range = clockRangeToInstants(date, startTime, endTime);
      createMutation.mutate({
        ...payload,
        startTime: range.start.toISOString(),
        endTime: range.end.toISOString(),
      });
      return;
    }

    createMutation.mutate(payload);
  };

  const totalHours =
    timeEntries?.reduce((sum, e) => sum + parseFloat(e.hours || "0"), 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("detail.loggedTime")}
          </h3>
          {totalHours > 0 && (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400">
              {Math.floor(totalHours)}
              {t("timeUnits.hour")} {Math.round((totalHours % 1) * 60)}
              {t("timeUnits.minute")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("detail.addTime")}
          </button>
          <button
            type="button"
            onClick={onStartTimer}
            className="inline-flex items-center gap-1.5 rounded-lg bg-tt-gran px-3 py-1.5 text-xs font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            <Clock className="h-3.5 w-3.5" />
            {t("detail.startTimerShort")}
          </button>
        </div>
      </div>

      {/* Inline add form */}
      {showAddForm && (
        <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-600 dark:bg-tt-gran-lys">
          <div className="space-y-3">
            {/* Description */}
            <div>
              <label
                htmlFor="time-desc"
                className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("detail.description")}
              </label>
              <input
                id="time-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                placeholder={task.title}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                // biome-ignore lint/a11y/noAutofocus: feltet vises som følge af brugerens handling (inline-redigering/dialog), så fokus flytter forventeligt
                autoFocus
              />
            </div>

            {/* Date + Hours row */}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label
                  htmlFor="time-date"
                  className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("detail.date")}
                </label>
                <input
                  id="time-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
              <div className="w-24">
                <label
                  htmlFor="time-hours"
                  className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("detail.hours")}
                </label>
                <input
                  id="time-hours"
                  type="number"
                  step="0.25"
                  min="0.01"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit();
                  }}
                  placeholder="1.5"
                  readOnly={useTimeRange && !!startTime && !!endTime}
                  className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 ${useTimeRange && startTime && endTime ? "bg-gray-50 dark:bg-gray-600 text-gray-500" : ""}`}
                />
              </div>
            </div>

            {/* Optional time range toggle */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useTimeRange}
                  onChange={(e) => {
                    setUseTimeRange(e.target.checked);
                    if (!e.target.checked) {
                      setStartTime("");
                      setEndTime("");
                    }
                  }}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                />
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {t("detail.useTimeRange")}
                </span>
              </label>

              {useTimeRange && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1">
                    <label
                      htmlFor="time-start"
                      className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                    >
                      {t("detail.from_")}
                    </label>
                    <input
                      id="time-start"
                      type="time"
                      value={startTime}
                      onChange={(e) =>
                        handleTimeRangeChange(e.target.value, endTime)
                      }
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                    />
                  </div>
                  <span className="mt-5 text-gray-400">–</span>
                  <div className="flex-1">
                    <label
                      htmlFor="time-end"
                      className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                    >
                      {t("detail.to")}
                    </label>
                    <input
                      id="time-end"
                      type="time"
                      value={endTime}
                      onChange={(e) =>
                        handleTimeRangeChange(startTime, e.target.value)
                      }
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                    />
                  </div>
                  {startTime &&
                    endTime &&
                    calcHoursFromRange(startTime, endTime) > 0 && (
                      <span className="mt-5 whitespace-nowrap rounded bg-brand-100 px-2 py-1 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400">
                        {calcHoursFromRange(startTime, endTime)}
                        {t("timeUnits.hour")}
                      </span>
                    )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-tt-gran px-4 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
            >
              {createMutation.isPending
                ? t("detail.saving")
                : t("detail.saveTime")}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Time entries list */}
      {timeEntries && timeEntries.length > 0 ? (
        <TimeIntervalsOverview
          entries={timeEntries}
          title=""
          showProject={true}
          maxDates={10}
        />
      ) : !showAddForm ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Clock className="h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">
            {t("detail.noTime")}
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t("detail.noTimeHint")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
