"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Loader2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { ModalWithFooter } from "@/components/ui/Modal";
import { ProjectSelect } from "@/components/ui/ProjectSelect";
import { useModules } from "@/hooks/useModules";
import { toLocalDateStr } from "@/lib/format";
import { formLaneId } from "@/lib/kanban/lane-category";
import { trpc } from "@/providers/trpc-provider";
import { useTaskPreferencesStore } from "@/stores/taskPreferencesStore";

const createTaskModalSchema = (titleRequired: string) =>
  z.object({
    title: z.string().min(1, titleRequired).max(255),
    description: z.string().optional(),
    projectId: z.string().uuid().optional().or(z.literal("")),
    clientId: z.string().uuid().optional().or(z.literal("")),
    status: z.enum(["backlog", "todo", "in_progress", "done"]),
    // Kolonnen (egen status) på tavlen; tom, til kolonnerne er hentet.
    laneId: z.string(),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    deadline: z.string().optional(),
    estimatedMinutes: z.number().int().positive().optional().nullable(),
  });

type TaskModalForm = z.infer<ReturnType<typeof createTaskModalSchema>>;

export interface TaskModalData {
  id: string;
  title: string;
  description?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  status: string;
  statusId?: string | null;
  priority?: string | null;
  deadline?: Date | null;
  estimatedMinutes?: number | null;
}

const LEGACY_STATUSES = ["backlog", "todo", "in_progress", "done"] as const;

function asLegacyStatus(value: string | undefined) {
  return (LEGACY_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as TaskModalForm["status"])
    : undefined;
}

interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  task?: TaskModalData | null;
  /** Gammel status eller en kolonnes id (fra tavlens "+"). */
  defaultStatus?: string;
  defaultProjectId?: string | null;
  defaultClientId?: string | null;
}

export function TaskFormModal({
  isOpen,
  onClose,
  task,
  defaultStatus,
  defaultProjectId,
  defaultClientId,
}: TaskFormModalProps) {
  const fid = useId();
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const taskModalSchema = useMemo(
    () => createTaskModalSchema(t("taskForm.titleRequired")),
    [t],
  );
  const [showDescription, setShowDescription] = useState(!!task?.description);
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const utils = trpc.useUtils();
  const { lastProjectId, lastClientId, setLastContext } =
    useTaskPreferencesStore();

  const { data: projects } = trpc.projects.list.useQuery(undefined, {
    enabled: isOpen && !modulesPlaceholder && isModuleEnabled("projects"),
  });
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: isOpen && !modulesPlaceholder && isModuleEnabled("clients"),
  });

  // Status-vælgeren viser arbejdsområdets egne statusser (tavlens kolonner).
  const { data: lanes } = trpc.taskStatuses.listForContext.useQuery(
    { projectId: null },
    { enabled: isOpen },
  );

  const isEditing = !!task;

  // Kolonnen, opgaven står i nu (eller den nye opgave starter i).
  const initialLaneId = useMemo(
    () => (lanes?.length ? (formLaneId(lanes, task, defaultStatus) ?? "") : ""),
    [lanes, task, defaultStatus],
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TaskModalForm>({
    resolver: zodResolver(taskModalSchema),
    defaultValues: {
      title: "",
      description: "",
      status: "todo",
      laneId: "",
      priority: "medium",
      projectId: "",
      clientId: "",
      deadline: "",
    },
  });

  // Reset form when modal opens/task changes
  useEffect(() => {
    if (isOpen) {
      if (task) {
        reset({
          title: task.title,
          description: task.description || "",
          status: asLegacyStatus(task.status) ?? "todo",
          laneId: "",
          priority: (task.priority as TaskModalForm["priority"]) || "medium",
          projectId: task.projectId || "",
          clientId: task.clientId || "",
          deadline: task.deadline
            ? toLocalDateStr(new Date(task.deadline))
            : "",
          estimatedMinutes: task.estimatedMinutes || undefined,
        });
        setShowDescription(!!task.description);
      } else {
        reset({
          title: "",
          description: "",
          status: asLegacyStatus(defaultStatus) ?? "todo",
          laneId: "",
          priority: "medium",
          projectId: defaultProjectId || lastProjectId || "",
          clientId: defaultClientId || lastClientId || "",
          deadline: "",
        });
        setShowDescription(false);
      }
    }
  }, [
    isOpen,
    task,
    defaultStatus,
    defaultProjectId,
    defaultClientId,
    lastProjectId,
    lastClientId,
    reset,
  ]);

  // Kolonnerne kan komme efter formularen er åbnet; vælg da opgavens
  // kolonne uden at nulstille det, der allerede er skrevet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: task skifter formularens opgave
  useEffect(() => {
    if (isOpen && initialLaneId && !getValues("laneId")) {
      setValue("laneId", initialLaneId);
    }
  }, [isOpen, task, initialLaneId, getValues, setValue]);

  const selectedProjectId = watch("projectId");
  const selectedClientId = watch("clientId");
  const selectedProject = projects?.find((p) => p.id === selectedProjectId);

  const createMutation = trpc.tasks.create.useMutation({
    onSuccess: (newTask) => {
      toast.success(t("taskForm.created"), { description: newTask.title });
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
      // Remember context
      if (newTask.projectId || newTask.clientId) {
        setLastContext(newTask.projectId || null, newTask.clientId || null);
      }
      onClose();
    },
    onError: (error) => {
      toast.error(t("taskForm.createFailed"), {
        description: error.message,
      });
    },
  });

  const updateMutation = trpc.tasks.update.useMutation({
    onSuccess: () => {
      toast.success(t("taskForm.updated"));
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
      utils.tasks.getById.invalidate();
      onClose();
    },
    onError: (error) => {
      toast.error(t("taskForm.updateFailed"), {
        description: error.message,
      });
    },
  });

  const moveMutation = trpc.tasks.move.useMutation({
    onError: (error) => {
      toast.error(t("board.statusUpdateFailed"), {
        description: error.message,
      });
    },
  });

  const onSubmit = async (data: TaskModalForm) => {
    const projectId =
      data.projectId || selectedProject?.clientId ? data.projectId : undefined;
    const clientId =
      data.clientId ||
      (selectedProject
        ? (selectedProject as { clientId?: string }).clientId
        : undefined);

    if (isEditing && task) {
      // Med kolonner sættes status ved at flytte opgaven til kolonnen (som
      // på tavlen), så den egne status og kategorien følger med.
      if (data.laneId && data.laneId !== initialLaneId) {
        try {
          await moveMutation.mutateAsync({
            taskId: task.id,
            statusId: data.laneId,
          });
        } catch {
          return;
        }
      }
      updateMutation.mutate({
        id: task.id,
        title: data.title,
        description: data.description || null,
        projectId: projectId || null,
        clientId: clientId || null,
        status: data.laneId ? undefined : data.status,
        priority: data.priority,
        deadline: data.deadline ? new Date(data.deadline) : null,
        estimatedMinutes: data.estimatedMinutes || null,
      });
    } else {
      createMutation.mutate({
        title: data.title,
        description: data.description || undefined,
        projectId: projectId || undefined,
        clientId: clientId || undefined,
        status: data.status,
        statusId: data.laneId || undefined,
        priority: data.priority,
        deadline: data.deadline ? new Date(data.deadline) : undefined,
        estimatedMinutes: data.estimatedMinutes || undefined,
      });
    }
  };

  const isPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    moveMutation.isPending;

  const footer = (
    <div className="flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
      >
        {tc("cancel")}
      </button>
      <button
        type="submit"
        form="task-modal-form"
        disabled={isPending || isSubmitting}
        className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("taskForm.saving")}
          </>
        ) : (
          <>
            <Save className="h-4 w-4" />
            {isEditing ? t("taskForm.save") : t("taskForm.create")}
          </>
        )}
      </button>
    </div>
  );

  return (
    <ModalWithFooter
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? t("taskForm.editTitle") : t("taskForm.newTitle")}
      size="lg"
      footer={footer}
    >
      <form
        id="task-modal-form"
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-4"
      >
        {/* Title */}
        <div>
          <input
            {...register("title")}
            placeholder={t("taskForm.titlePlaceholder")}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-base font-medium text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
          {errors.title && (
            <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
          )}
        </div>

        {/* Description - collapsible */}
        {showDescription ? (
          <div>
            <textarea
              {...register("description")}
              rows={3}
              placeholder={t("taskForm.descriptionPlaceholder")}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDescription(true)}
            className="text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400"
          >
            {t("taskForm.addDescription")}
          </button>
        )}

        {/* Status + Priority + Deadline row */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
              {t("taskForm.statusLabel")}
            </span>
            <div className="relative">
              {lanes?.length ? (
                <select
                  {...register("laneId")}
                  className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  {lanes.map((lane) => (
                    <option key={lane.id} value={lane.id}>
                      {lane.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  {...register("status")}
                  className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  <option value="backlog">{t("status.backlog")}</option>
                  <option value="todo">{t("status.todo")}</option>
                  <option value="in_progress">{t("status.in_progress")}</option>
                  <option value="done">{t("status.done")}</option>
                </select>
              )}
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            </div>
          </div>
          <div>
            <label
              htmlFor={`${fid}-f1`}
              className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
            >
              {t("taskForm.priorityLabel")}
            </label>
            <div className="relative">
              <select
                id={`${fid}-f1`}
                {...register("priority")}
                className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="low">{t("priority.low")}</option>
                <option value="medium">{t("taskForm.priorityMedium")}</option>
                <option value="high">{t("priority.high")}</option>
                <option value="urgent">{t("taskForm.priorityUrgent")}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            </div>
          </div>
          <div>
            <label
              htmlFor={`${fid}-f2`}
              className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
            >
              {t("taskForm.deadline")}
            </label>
            <input
              id={`${fid}-f2`}
              {...register("deadline")}
              type="date"
              className="w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
        </div>

        {/* Project + Client row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
              {t("taskForm.project")}
            </span>
            <ProjectSelect
              projects={projects}
              value={selectedProjectId || null}
              onChange={(v) => {
                setValue("projectId", v ?? "");
                const proj = projects?.find((p) => p.id === v);
                if (proj) {
                  const projClientId = (proj as { clientId?: string }).clientId;
                  if (projClientId) {
                    setValue("clientId", projClientId);
                  }
                }
              }}
              placeholder={t("taskForm.noProject")}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
              {t("taskForm.client")}
            </span>
            <ClientSearchCombobox
              clients={clients}
              value={selectedClientId || ""}
              onChange={(v) => setValue("clientId", v)}
              disabled={!!selectedProjectId}
              placeholder={t("taskForm.noClient")}
              allowClear
            />
          </div>
        </div>
      </form>
    </ModalWithFooter>
  );
}
