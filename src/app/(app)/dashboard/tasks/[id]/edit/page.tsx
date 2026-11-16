"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { use, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ProjectSelect } from "@/components/ui/ProjectSelect";
import { useModules } from "@/hooks/useModules";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

type TaskSchemaMessages = { titleMin: string };

const createTaskSchema = (m: TaskSchemaMessages) =>
  z.object({
    title: z.string().min(2, m.titleMin),
    description: z.string().optional(),
    projectId: z.string().uuid().optional().or(z.literal("")),
    clientId: z.string().uuid().optional().or(z.literal("")),
    status: z.enum(["backlog", "todo", "in_progress", "done"]),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    deadline: z.string().optional(),
  });

type TaskForm = z.infer<ReturnType<typeof createTaskSchema>>;

export default function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const taskSchema = useMemo(
    () => createTaskSchema({ titleMin: t("taskPage.titleMin") }),
    [t],
  );
  const router = useRouter();

  const { data: task, isLoading } = trpc.tasks.getById.useQuery({ id });
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: projects } = trpc.projects.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("projects"),
  });
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });

  const formValues = task
    ? {
        title: task.title,
        description: task.description || "",
        projectId: task.projectId || "",
        clientId: task.clientId || "",
        status: task.status as TaskForm["status"],
        priority: (task.priority || "medium") as TaskForm["priority"],
        deadline: task.deadline ? toLocalDateStr(new Date(task.deadline)) : "",
      }
    : undefined;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TaskForm>({
    resolver: zodResolver(taskSchema),
    values: formValues,
    // En refetch (fx efter global invalidering fra en anden mutation) må ikke
    // overskrive det brugeren er i gang med at taste.
    resetOptions: { keepDirtyValues: true },
  });

  const selectedProjectId = watch("projectId");

  // Auto-select client when project is selected
  const selectedProject = projects?.find((p) => p.id === selectedProjectId);

  const updateMutation = trpc.tasks.update.useMutation({
    onSuccess: () => {
      router.push(`/dashboard/tasks/${id}`);
    },
  });

  const onSubmit = async (data: TaskForm) => {
    try {
      const submitData = {
        id,
        title: data.title,
        description: data.description,
        projectId: data.projectId || null,
        clientId: data.clientId || selectedProject?.clientId || null,
        status: data.status,
        priority: data.priority,
        deadline: data.deadline ? new Date(data.deadline) : null,
      };
      await updateMutation.mutateAsync(submitData);
    } catch (_error) {
      // Error handled by mutation
    }
  };

  if (isLoading) {
    return <LoadingScreen message={t("taskPage.loading")} />;
  }

  if (!task) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-600 dark:text-gray-400">
          {t("taskPage.notFound")}
        </p>
        <Link
          href="/dashboard/tasks"
          className="mt-4 inline-flex items-center gap-2 text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("taskPage.backToTasks")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href={`/dashboard/tasks/${id}`}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("taskPage.backToTask")}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
          {t("taskPage.editTitle")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("taskPage.editSubtitle")}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-6 text-sm font-semibold text-gray-900 dark:text-white">
            {t("taskPage.about")}
          </h2>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="title"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("taskPage.titleLabel")}{" "}
                <span className="text-red-600">*</span>
              </label>
              <input
                {...register("title")}
                id="title"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                placeholder={t("taskPage.titlePlaceholder")}
              />
              {errors.title && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.title.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="description"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("taskPage.description")}
              </label>
              <textarea
                {...register("description")}
                id="description"
                rows={4}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                placeholder={t("taskPage.descriptionPlaceholder")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="projectId"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("taskPage.project")}
                </label>
                <ProjectSelect
                  id="projectId"
                  projects={projects}
                  value={selectedProjectId || null}
                  onChange={(v) => setValue("projectId", v ?? "")}
                  placeholder={t("taskPage.noProject")}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
                {selectedProject && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {t("taskPage.clientIs", {
                      name:
                        (Array.isArray(selectedProject.client)
                          ? selectedProject.client[0]
                          : selectedProject.client
                        )?.name ?? "",
                    })}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="clientId"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("taskPage.client")}
                </label>
                <select
                  {...register("clientId")}
                  id="clientId"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  disabled={!!selectedProjectId}
                >
                  <option value="">{t("taskPage.noClient")}</option>
                  {clients?.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
                {selectedProjectId && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {t("taskPage.clientAuto")}
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="status"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("taskPage.status")}
                </label>
                <select
                  {...register("status")}
                  id="status"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="backlog">{t("status.backlog")}</option>
                  <option value="todo">{t("status.todo")}</option>
                  <option value="in_progress">{t("status.in_progress")}</option>
                  <option value="done">{t("status.done")}</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="priority"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("taskPage.priority")}
                </label>
                <select
                  {...register("priority")}
                  id="priority"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="low">{t("priority.low")}</option>
                  <option value="medium">{t("taskPage.priorityMedium")}</option>
                  <option value="high">{t("priority.high")}</option>
                  <option value="urgent">{t("priority.urgent")}</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="deadline"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("taskPage.deadline")}
                </label>
                <input
                  {...register("deadline")}
                  id="deadline"
                  type="date"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {updateMutation.error && (
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-400">
              {updateMutation.error.message}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("taskPage.saving")}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {t("taskPage.saveChanges")}
                </>
              )}
            </button>
            <Link
              href={`/dashboard/tasks/${id}`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {tc("cancel")}
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
