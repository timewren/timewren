"use client";

import {
  Calendar,
  CheckCircle2,
  CircleDot,
  Clock,
  ExternalLink,
  Flag,
  FolderOpen,
  Loader2,
  Play,
  Plus,
  User,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useModules } from "@/hooks/useModules";
import { toIntlLocale } from "@/i18n/format-locale";
import { parseLocalDateStr, toLocalDateStr } from "@/lib/format";
import { resolveTaskLaneId } from "@/lib/kanban/lane-category";
import { trpc } from "@/providers/trpc-provider";
import { useTimerStore } from "@/stores/timerStore";
import { InlineEdit } from "./InlineEdit";
import { PillOption, PropertyPill } from "./PropertyPill";
import { PRIORITY_CONFIG, type PriorityKey } from "./priority-config";
import { SubtasksSection } from "./SubtasksSection";

const TaskNotes = dynamic(
  () => import("./TaskNotes").then((m) => m.TaskNotes),
  { ssr: false },
);

interface TaskSidePanelProps {
  taskId: string | null;
  onClose: () => void;
}

const STATUS_OPTIONS = [
  {
    value: "backlog",
    color: "text-gray-600 dark:text-gray-400",
    bgColor: "bg-gray-100 dark:bg-gray-700",
  },
  {
    value: "todo",
    color: "text-amber-700 dark:text-amber-300",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
  },
  {
    value: "in_progress",
    color: "text-blue-700 dark:text-blue-300",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
  },
  {
    value: "done",
    color: "text-green-700 dark:text-green-300",
    bgColor: "bg-green-50 dark:bg-green-900/20",
  },
] as const;

type TasksT = ReturnType<typeof useTranslations<"tasks">>;

function formatMinutes(mins: number, t: TasksT) {
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  const h = t("timeUnits.hour");
  const m = t("timeUnits.minute");
  if (hours > 0) return `${hours}${h}${rest > 0 ? ` ${rest}${m}` : ""}`;
  return `${rest}${m}`;
}

function formatDate(
  date: Date | string | null,
  t: TasksT,
  locale: string,
): string {
  if (!date) return t("sidePanel.noDeadline");
  const d = new Date(date);
  return d.toLocaleDateString(toIntlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function TaskSidePanel({ taskId, onClose }: TaskSidePanelProps) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true, taskId);
  const {
    startTimerFromTask,
    resumeAsSegment,
    isRunning,
    taskId: currentTaskId,
  } = useTimerStore();
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const utils = trpc.useUtils();

  // Fetch full task data by ID
  const { data: task, isLoading } = trpc.tasks.getById.useQuery(
    // biome-ignore lint/style/noNonNullAssertion: guarded by enabled
    { id: taskId! },
    { enabled: !!taskId },
  );

  // Fetch time entries for this task
  const { data: taskEntries } = trpc.time.list.useQuery(
    // biome-ignore lint/style/noNonNullAssertion: guarded by enabled
    { taskId: taskId!, limit: 50 },
    { enabled: !!taskId },
  );

  // Fetch clients and projects for pill selectors
  const { data: clientsList } = trpc.clients.list.useQuery(undefined, {
    enabled: !!taskId && !modulesPlaceholder && isModuleEnabled("clients"),
  });
  const { data: projectsList } = trpc.projects.list.useQuery(undefined, {
    enabled: !!taskId && !modulesPlaceholder && isModuleEnabled("projects"),
  });

  // Auto-save mutation
  const updateMutation = trpc.tasks.update.useMutation({
    onSuccess: () => {
      utils.tasks.listByStatus.invalidate();
      utils.tasks.list.invalidate();
      utils.tasks.getStats.invalidate();
      if (taskId) {
        utils.tasks.getById.invalidate({ id: taskId });
      }
    },
    onError: () => {
      toast.error(t("sidePanel.saveFailed"));
    },
  });

  // Tavlens kolonner er status-vælgerens muligheder (egne statusser).
  const { data: boardLanes } = trpc.taskStatuses.listForContext.useQuery(
    { projectId: null },
    { enabled: !!taskId },
  );
  const moveMutation = trpc.tasks.move.useMutation({
    onSuccess: () => {
      utils.tasks.listByStatus.invalidate();
      utils.tasks.list.invalidate();
      utils.tasks.getStats.invalidate();
      if (taskId) utils.tasks.getById.invalidate({ id: taskId });
    },
    onError: (err) => {
      toast.error(err.message || t("board.statusUpdateFailed"));
    },
  });

  // Team members for task assignment (only relevant for teams).
  const { data: orgMembers } = trpc.organization.getMembers.useQuery();
  const isTeam = (orgMembers?.length ?? 0) > 1;
  const setAssigneeMutation = trpc.tasks.setAssignee.useMutation({
    onSuccess: () => {
      utils.tasks.listByStatus.invalidate();
      utils.tasks.list.invalidate();
      if (taskId) utils.tasks.getById.invalidate({ id: taskId });
    },
    onError: () => toast.error(t("sidePanel.assignFailed")),
  });

  // Escape key to close
  useEffect(() => {
    if (!taskId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [taskId, onClose]);

  // Backdrop click to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  // Timer handler
  const handleStartTimer = useCallback(() => {
    if (!task) return;
    if (isRunning && currentTaskId === task.id) {
      toast.info(t("sidePanel.timerAlreadyRunning"));
      return;
    }
    const project = Array.isArray(task.project)
      ? task.project[0]
      : task.project;
    const client = Array.isArray(task.client) ? task.client[0] : task.client;
    if (project?.id || client?.id) {
      startTimerFromTask({
        id: task.id,
        title: task.title,
        projectId: project?.id || null,
        clientId: client?.id || null,
      });
      toast.success(t("sidePanel.timerStarted", { title: task.title }));
    } else {
      toast.error(t("sidePanel.noProjectOrClient"));
    }
  }, [task, isRunning, currentTaskId, startTimerFromTask, t]);

  if (!taskId) return null;

  // Normalize Drizzle relation types
  const project = task
    ? Array.isArray(task.project)
      ? task.project[0]
      : task.project
    : null;
  const client = task
    ? Array.isArray(task.client)
      ? task.client[0]
      : task.client
    : null;
  const subtasks = task?.subtasks ?? [];

  // Determine current status styling
  const currentStatus =
    STATUS_OPTIONS.find((s) => s.value === task?.status) ?? STATUS_OPTIONS[0];
  const currentLaneId =
    task && boardLanes?.length ? resolveTaskLaneId(task, boardLanes) : null;
  const currentLane = boardLanes?.find((l) => l.id === currentLaneId);
  const currentPriority =
    PRIORITY_CONFIG[(task?.priority || "medium") as PriorityKey] ??
    PRIORITY_CONFIG.medium;

  // Filter projects by client if client is set
  const filteredProjects = client?.id
    ? projectsList?.filter((p) => !p.client || p.client.id === client.id)
    : projectsList;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss pattern
    <div
      className="fixed inset-0 z-40 bg-black/20"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t("sidePanel.dialogLabel")}
        className="fixed right-0 top-0 bottom-0 z-50 w-[420px] max-w-[90vw] bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-xl overflow-y-auto"
      >
        {isLoading || !task ? (
          // Loading skeleton
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("sidePanel.loading")}
            </span>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex-1 min-w-0">
                <InlineEdit
                  value={task.title}
                  onSave={(title) =>
                    updateMutation.mutate({ id: task.id, title })
                  }
                  className="font-semibold text-lg"
                  displayClassName="text-gray-900 dark:text-white"
                  placeholder={t("taskForm.titlePlaceholder")}
                />
              </div>
              <div className="flex items-center gap-1 shrink-0 pt-1">
                <Link
                  href={`/dashboard/tasks/${task.id}`}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:text-brand-300 dark:hover:bg-tt-gran-lys"
                  title={t("sidePanel.openFull")}
                >
                  <ExternalLink className="h-3 w-3" />
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* PillBar */}
              <div className="flex flex-wrap gap-2">
                {/* Status pill: tavlens egne kolonner, ellers de fire faste */}
                {boardLanes && currentLane ? (
                  <PropertyPill
                    icon={
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: currentLane.color }}
                      />
                    }
                    label={currentLane.name}
                    ariaLabel={`${t("columns.status")}: ${currentLane.name}`}
                  >
                    {(close) => (
                      <>
                        {boardLanes.map((lane) => (
                          <PillOption
                            key={lane.id}
                            label={lane.name}
                            selected={lane.id === currentLane.id}
                            icon={
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: lane.color }}
                              />
                            }
                            onClick={() => {
                              if (lane.id !== currentLane.id) {
                                moveMutation.mutate({
                                  taskId: task.id,
                                  statusId: lane.id,
                                });
                              }
                              close();
                            }}
                          />
                        ))}
                      </>
                    )}
                  </PropertyPill>
                ) : (
                  <PropertyPill
                    icon={<CircleDot className="h-3 w-3" />}
                    label={t(`status.${currentStatus.value}`)}
                    ariaLabel={`${t("columns.status")}: ${t(`status.${currentStatus.value}`)}`}
                    color={currentStatus.color}
                    bgColor={currentStatus.bgColor}
                  >
                    {(close) => (
                      <>
                        {STATUS_OPTIONS.map((opt) => (
                          <PillOption
                            key={opt.value}
                            label={t(`status.${opt.value}`)}
                            selected={task.status === opt.value}
                            onClick={() => {
                              updateMutation.mutate({
                                id: task.id,
                                status: opt.value,
                              });
                              close();
                            }}
                          />
                        ))}
                      </>
                    )}
                  </PropertyPill>
                )}

                {/* Priority pill */}
                <PropertyPill
                  icon={<Flag className="h-3 w-3" />}
                  label={t(
                    `priority.${(task?.priority || "medium") as PriorityKey}`,
                  )}
                  color={currentPriority.textColor}
                  bgColor={currentPriority.bg}
                >
                  {(close) => (
                    <>
                      {(
                        Object.entries(PRIORITY_CONFIG) as [
                          PriorityKey,
                          (typeof PRIORITY_CONFIG)[PriorityKey],
                        ][]
                      ).map(([key, cfg]) => (
                        <PillOption
                          key={key}
                          label={t(`priority.${key}`)}
                          selected={task.priority === key}
                          icon={
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: cfg.color }}
                            />
                          }
                          onClick={() => {
                            updateMutation.mutate({
                              id: task.id,
                              priority: key,
                            });
                            close();
                          }}
                        />
                      ))}
                    </>
                  )}
                </PropertyPill>

                {/* Assignee pill (teams only) */}
                {isTeam && (
                  <PropertyPill
                    icon={<User className="h-3 w-3" />}
                    label={
                      orgMembers?.find(
                        (m) => m.userId === task.assignedToUserId,
                      )?.name ?? t("sidePanel.unassigned")
                    }
                  >
                    {(close) => (
                      <>
                        <PillOption
                          label={t("sidePanel.unassigned")}
                          selected={!task.assignedToUserId}
                          onClick={() => {
                            setAssigneeMutation.mutate({
                              id: task.id,
                              assignedToUserId: null,
                            });
                            close();
                          }}
                        />
                        {orgMembers?.map((m) => (
                          <PillOption
                            key={m.userId}
                            label={m.name}
                            selected={task.assignedToUserId === m.userId}
                            icon={<User className="h-3 w-3 text-gray-400" />}
                            onClick={() => {
                              setAssigneeMutation.mutate({
                                id: task.id,
                                assignedToUserId: m.userId,
                              });
                              close();
                            }}
                          />
                        ))}
                      </>
                    )}
                  </PropertyPill>
                )}

                {/* Deadline pill */}
                <PropertyPill
                  icon={<Calendar className="h-3 w-3" />}
                  label={formatDate(task.deadline, t, locale)}
                  popoverRole="dialog"
                >
                  {(close) => (
                    <div className="p-2 space-y-2">
                      <input
                        type="date"
                        defaultValue={
                          task.deadline
                            ? toLocalDateStr(new Date(task.deadline))
                            : ""
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) {
                            updateMutation.mutate({
                              id: task.id,
                              deadline: parseLocalDateStr(val),
                            });
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                      />
                      {task.deadline && (
                        <button
                          type="button"
                          onClick={() => {
                            updateMutation.mutate({
                              id: task.id,
                              deadline: null,
                            });
                            close();
                          }}
                          className="w-full text-xs text-red-500 hover:text-red-600 py-1"
                        >
                          {t("sidePanel.removeDeadline")}
                        </button>
                      )}
                    </div>
                  )}
                </PropertyPill>

                {/* Estimate pill */}
                <PropertyPill
                  icon={<Clock className="h-3 w-3" />}
                  label={
                    task.estimatedMinutes
                      ? formatMinutes(task.estimatedMinutes, t)
                      : t("sidePanel.noEstimate")
                  }
                  popoverRole="dialog"
                >
                  {(close) => (
                    <EstimatePopover
                      currentMinutes={task.estimatedMinutes}
                      onSave={(mins) => {
                        updateMutation.mutate({
                          id: task.id,
                          estimatedMinutes: mins,
                        });
                        close();
                      }}
                    />
                  )}
                </PropertyPill>

                {/* Client pill */}
                <PropertyPill
                  icon={<User className="h-3 w-3" />}
                  label={client?.name || t("sidePanel.noClient")}
                >
                  {(close) => (
                    <>
                      <PillOption
                        label={t("sidePanel.noClient")}
                        selected={!client}
                        onClick={() => {
                          updateMutation.mutate({
                            id: task.id,
                            clientId: null,
                          });
                          close();
                        }}
                      />
                      {clientsList
                        ?.filter((c) => !c.isArchived)
                        .map((c) => (
                          <PillOption
                            key={c.id}
                            label={c.name}
                            selected={client?.id === c.id}
                            onClick={() => {
                              updateMutation.mutate({
                                id: task.id,
                                clientId: c.id,
                              });
                              close();
                            }}
                          />
                        ))}
                    </>
                  )}
                </PropertyPill>

                {/* Project pill */}
                <PropertyPill
                  icon={<FolderOpen className="h-3 w-3" />}
                  label={project?.name || t("sidePanel.noProject")}
                >
                  {(close) => (
                    <>
                      <PillOption
                        label={t("sidePanel.noProject")}
                        selected={!project}
                        onClick={() => {
                          updateMutation.mutate({
                            id: task.id,
                            projectId: null,
                          });
                          close();
                        }}
                      />
                      {filteredProjects?.map((p) => (
                        <PillOption
                          key={p.id}
                          label={p.name}
                          selected={project?.id === p.id}
                          onClick={() => {
                            updateMutation.mutate({
                              id: task.id,
                              projectId: p.id,
                            });
                            close();
                          }}
                        />
                      ))}
                    </>
                  )}
                </PropertyPill>
              </div>

              {/* Separator */}
              <div className="border-t border-gray-200 dark:border-gray-700" />

              {/* Description */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {t("sidePanel.description")}
                </span>
                <InlineEdit
                  value={task.description || ""}
                  as="textarea"
                  placeholder={t("sidePanel.addDescription")}
                  onSave={(description) =>
                    updateMutation.mutate({ id: task.id, description })
                  }
                />
              </div>

              {/* Separator */}
              <div className="border-t border-gray-200 dark:border-gray-700" />

              {/* Notes */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1 block">
                  {t("sidePanel.notes")}
                </span>
                <TaskNotes
                  content={task.notes ?? null}
                  onSave={(notes) =>
                    updateMutation.mutate({ id: task.id, notes })
                  }
                />
              </div>

              {/* Separator */}
              <div className="border-t border-gray-200 dark:border-gray-700" />

              {/* Subtasks */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1 block">
                  {t("sidePanel.subtasks")}
                </span>
                <SubtasksSection taskId={task.id} subtasks={subtasks} />
              </div>

              {/* Tid section */}
              {taskEntries?.entries && taskEntries.entries.length > 0 && (
                <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      {t("sidePanel.time")}
                    </h4>
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatMinutes(
                          taskEntries.entries.reduce(
                            (sum, e) => sum + Math.round(Number(e.hours) * 60),
                            0,
                          ),
                          t,
                        )}
                      </span>
                      {task?.estimatedMinutes && (
                        <span className="text-xs text-gray-400">
                          / {formatMinutes(task.estimatedMinutes, t)}
                        </span>
                      )}
                    </div>
                  </div>

                  {task?.estimatedMinutes && (
                    <div className="mb-2 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className="h-full rounded-full bg-brand-500 transition-all"
                        style={{
                          width: `${Math.min(100, (taskEntries.entries.reduce((s, e) => s + Math.round(Number(e.hours) * 60), 0) / task.estimatedMinutes) * 100)}%`,
                        }}
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    {taskEntries.entries.slice(0, 5).map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400"
                      >
                        <span>
                          {new Date(entry.date).toLocaleDateString(
                            toIntlLocale(locale),
                            {
                              day: "numeric",
                              month: "short",
                            },
                          )}
                        </span>
                        <span>
                          {t("sidePanel.hoursShort", {
                            hours: Number(entry.hours).toFixed(1),
                          })}
                        </span>
                      </div>
                    ))}
                    {taskEntries.entries.length > 5 && (
                      <p className="text-xs text-gray-400">
                        {t("sidePanel.moreEntries", {
                          count: taskEntries.entries.length - 5,
                        })}
                      </p>
                    )}
                  </div>

                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const latest = taskEntries.entries[0];
                        if (latest && taskId) {
                          resumeAsSegment({
                            entryId: latest.id,
                            projectId: latest.project?.id,
                            clientId: latest.client?.id,
                            description:
                              latest.description || task?.title || "",
                            taskId,
                          });
                          toast.success(t("sidePanel.resumed"));
                        }
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-green-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                    >
                      <Play className="h-3 w-3" />
                      {t("sidePanel.resume")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (task) {
                          startTimerFromTask({
                            id: task.id,
                            title: task.title,
                            projectId: task.projectId,
                            clientId: task.clientId,
                          });
                          toast.success(t("sidePanel.timerStartedForTask"));
                        }
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      <Plus className="h-3 w-3" />
                      {t("sidePanel.newEntry")}
                    </button>
                  </div>
                </div>
              )}

              {/* Separator */}
              <div className="border-t border-gray-200 dark:border-gray-700" />

              {/* Action bar */}
              <div className="flex gap-2">
                {(project?.id || client?.id) && task.status !== "done" && (
                  <button
                    type="button"
                    onClick={handleStartTimer}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-tt-gran text-tt-paa-gran text-xs font-medium hover:bg-tt-gran-moerk transition-colors"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {t("sidePanel.startTimer")}
                  </button>
                )}
                {task.status !== "done" && (
                  <button
                    type="button"
                    disabled={updateMutation.isPending}
                    onClick={() =>
                      updateMutation.mutate({ id: task.id, status: "done" })
                    }
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-xs font-medium hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors ${
                      updateMutation.isPending
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t("sidePanel.markDone")}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Small popover content for editing the estimate in minutes.
 */
function EstimatePopover({
  currentMinutes,
  onSave,
}: {
  currentMinutes: number | null;
  onSave: (mins: number | null) => void;
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [value, setValue] = useState(currentMinutes?.toString() ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSave = () => {
    const num = Number.parseInt(value, 10);
    if (!value.trim()) {
      onSave(null);
    } else if (!Number.isNaN(num) && num > 0) {
      onSave(num);
    }
  };

  return (
    <div className="p-2 space-y-2">
      <label className="text-xs text-gray-500 dark:text-gray-400 block">
        {t("sidePanel.estimateMinutes")}
        <input
          ref={inputRef}
          type="number"
          min="1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          placeholder={t("sidePanel.estimatePlaceholder")}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 rounded-md bg-tt-gran px-2 py-1 text-xs font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
        >
          {tc("save")}
        </button>
        {currentMinutes != null && (
          <button
            type="button"
            onClick={() => onSave(null)}
            className="text-xs text-red-500 hover:text-red-600 px-2 py-1"
          >
            {t("sidePanel.remove")}
          </button>
        )}
      </div>
    </div>
  );
}
