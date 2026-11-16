"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Globe, Loader2, Plus, Save, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { use, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/dashboard-nav";
import { TagPicker } from "@/components/tags/TagPicker";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useModules } from "@/hooks/useModules";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

const createProjectSchema = (t: (key: string) => string) =>
  z.object({
    name: z.string().min(2, t("form.nameMin")),
    description: z.string().optional(),
    // Valgfri for enterprise-orgs (internt projekt, #467); freelance kræver kunde
    clientId: z.string().uuid(t("form.pickClient")).nullable().optional(),
    hourlyRate: z.string().optional(),
    fixedPrice: z.string().optional(),
    monthlyBudgetHours: z.string().optional(),
    budgetHours: z.string().optional(),
    status: z.enum(["active", "completed", "on_hold", "archived"]).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    urlPatterns: z.array(z.string()).optional(),
    roundingEnabled: z.boolean().nullable().optional(),
    roundingMinutes: z
      .union([
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(30),
        z.literal(60),
      ])
      .nullable()
      .optional(),
    roundingMethod: z.enum(["up", "nearest", "down"]).nullable().optional(),
  });

type ProjectForm = z.infer<ReturnType<typeof createProjectSchema>>;

export default function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const projectSchema = useMemo(() => createProjectSchema(t), [t]);
  const router = useRouter();

  const { data: project, isLoading } = trpc.projects.getById.useQuery({ id });
  const {
    orgProfile,
    isPlaceholder,
    isEnabled: isModuleEnabled,
  } = useModules();
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: !isPlaceholder && isModuleEnabled("clients"),
  });

  const formValues = project
    ? {
        name: project.name,
        description: project.description || "",
        clientId: project.clientId,
        hourlyRate: project.hourlyRate || "",
        fixedPrice: project.fixedPrice || "",
        monthlyBudgetHours: project.monthlyBudgetHours || "",
        budgetHours: project.budgetHours || "",
        status: project.status as ProjectForm["status"],
        startDate: project.startDate
          ? toLocalDateStr(new Date(project.startDate))
          : "",
        endDate: project.endDate
          ? toLocalDateStr(new Date(project.endDate))
          : "",
        urlPatterns: (project.urlPatterns as string[]) || [],
        roundingEnabled: project.roundingEnabled ?? null,
        roundingMinutes:
          (project.roundingMinutes as 5 | 10 | 15 | 30 | 60 | null) ?? null,
        roundingMethod:
          (project.roundingMethod as "up" | "nearest" | "down") ?? null,
      }
    : undefined;

  // Enterprise-profil: projekter kan være interne uden kunde (#467)
  const clientOptional = !isPlaceholder && orgProfile === "enterprise";

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
    values: formValues,
    // En refetch (fx efter global invalidering fra en anden mutation) må ikke
    // overskrive det brugeren er i gang med at taste.
    resetOptions: { keepDirtyValues: true },
  });

  // URL patterns state
  const [urlPatterns, setUrlPatterns] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState("");

  // Tags state
  const [tagIds, setTagIds] = useState<string[]>([]);

  useEffect(() => {
    if (project?.tags) {
      setTagIds(project.tags.map((tag) => tag.id));
    }
  }, [project]);

  const setTagsForProject = trpc.tags.setForProject.useMutation();

  // Sync URL patterns from loaded project
  useEffect(() => {
    if (project) {
      setUrlPatterns((project.urlPatterns as string[]) || []);
    }
  }, [project]);

  // Sync URL patterns with form
  useEffect(() => {
    setValue("urlPatterns", urlPatterns);
  }, [urlPatterns, setValue]);

  const addPattern = () => {
    if (newPattern.trim() && !urlPatterns.includes(newPattern.trim())) {
      setUrlPatterns([...urlPatterns, newPattern.trim()]);
      setNewPattern("");
    }
  };

  const removePattern = (pattern: string) => {
    setUrlPatterns(urlPatterns.filter((p) => p !== pattern));
  };

  const utils = trpc.useUtils();
  const updateMutation = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.invalidate();
    },
  });

  const onSubmit = async (data: ProjectForm) => {
    if (!clientOptional && !data.clientId) {
      setError("clientId", { message: t("form.pickClient") });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id,
        data: { ...data, clientId: data.clientId || null },
      });
      await setTagsForProject.mutateAsync({ projectId: id, tagIds });
      toast.success(t("form.updated"));
      router.push(`/dashboard/projects/${id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("form.saveFailed"),
      );
    }
  };

  if (isLoading) {
    return <LoadingScreen message={t("form.loading")} />;
  }

  if (!project) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-600 dark:text-gray-400">{t("form.notFound")}</p>
        <Link
          href="/dashboard/projects"
          className="mt-4 inline-flex items-center gap-2 text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("form.back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <PageHeader
          title={t("form.editTitle")}
          description={t("form.editDescription")}
          dynamicLabels={{ [id]: project?.name || t("form.fallbackName") }}
        />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="mb-6 text-sm font-semibold text-gray-900 dark:text-white">
            {t("form.about")}
          </h2>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="clientId"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.client")}{" "}
                {clientOptional ? (
                  <span className="text-gray-400">
                    {t("form.clientOptionalHint")}
                  </span>
                ) : (
                  <span className="text-red-600">*</span>
                )}
              </label>
              <ClientSearchCombobox
                clients={clients}
                value={watch("clientId") || ""}
                onChange={(id) => setValue("clientId", id || null)}
                placeholder={
                  clientOptional
                    ? t("form.clientInternal")
                    : t("form.clientSelect")
                }
              />
              {errors.clientId && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {errors.clientId.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="name"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.name")} <span className="text-red-600">*</span>
              </label>
              <input
                id="name"
                {...register("name")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder={t("form.namePlaceholder")}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="description"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.description")}
              </label>
              <textarea
                id="description"
                {...register("description")}
                rows={4}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder={t("form.descriptionPlaceholder")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="hourlyRate"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("form.hourlyRate")}
                </label>
                <input
                  id="hourlyRate"
                  {...register("hourlyRate")}
                  type="number"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder="750"
                />
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {t("form.hourlyRateHint")}
                </p>
              </div>

              <div>
                <label
                  htmlFor="fixedPrice"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("form.fixedPrice")}
                </label>
                <input
                  id="fixedPrice"
                  {...register("fixedPrice")}
                  type="number"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder="50000"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="budgetHours"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.budgetHours")}
              </label>
              <input
                id="budgetHours"
                {...register("budgetHours")}
                type="number"
                step="0.5"
                min="0"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder="10"
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("form.budgetHoursHintEdit")}
              </p>
            </div>

            <div>
              <label
                htmlFor="monthlyBudgetHours"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.monthlyBudget")}
              </label>
              <input
                id="monthlyBudgetHours"
                {...register("monthlyBudgetHours")}
                type="number"
                step="0.5"
                min="0"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder="20"
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("form.monthlyBudgetHintEdit")}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="startDate"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("form.startDate")}
                </label>
                <input
                  id="startDate"
                  {...register("startDate")}
                  type="date"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>

              <div>
                <label
                  htmlFor="endDate"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("form.endDate")}
                </label>
                <input
                  id="endDate"
                  {...register("endDate")}
                  type="date"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="status"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.status")}
              </label>
              <select
                id="status"
                {...register("status")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              >
                <option value="active">{t("form.statusActive")}</option>
                <option value="completed">{t("form.statusCompleted")}</option>
                <option value="on_hold">{t("form.statusOnHold")}</option>
                <option value="archived">{t("form.statusArchived")}</option>
              </select>
            </div>

            {/* Time Rounding */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 p-4">
              <label
                htmlFor="roundingMode"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.roundingTitle")}
              </label>
              <select
                id="roundingMode"
                value={
                  watch("roundingEnabled") === true
                    ? "custom"
                    : watch("roundingEnabled") === false
                      ? "never"
                      : "inherit"
                }
                onChange={(e) => {
                  const mode = e.target.value;
                  if (mode === "custom") {
                    setValue("roundingEnabled", true, { shouldDirty: true });
                    setValue(
                      "roundingMinutes",
                      watch("roundingMinutes") ?? 15,
                      {
                        shouldDirty: true,
                      },
                    );
                    setValue(
                      "roundingMethod",
                      watch("roundingMethod") ?? "up",
                      {
                        shouldDirty: true,
                      },
                    );
                  } else {
                    // "inherit" → null, "never" → false
                    setValue(
                      "roundingEnabled",
                      mode === "never" ? false : null,
                      { shouldDirty: true },
                    );
                    setValue("roundingMinutes", null, { shouldDirty: true });
                    setValue("roundingMethod", null, { shouldDirty: true });
                  }
                }}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              >
                <option value="inherit">{t("form.roundingInherit")}</option>
                <option value="never">{t("form.roundingNever")}</option>
                <option value="custom">{t("form.roundingCustom")}</option>
              </select>

              {watch("roundingEnabled") === true && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label
                      htmlFor="roundingMinutes"
                      className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                    >
                      {t("form.roundingNearest")}
                    </label>
                    <select
                      id="roundingMinutes"
                      value={watch("roundingMinutes") ?? 15}
                      onChange={(e) =>
                        setValue(
                          "roundingMinutes",
                          Number.parseInt(e.target.value, 10) as
                            | 5
                            | 10
                            | 15
                            | 30
                            | 60,
                          { shouldDirty: true },
                        )
                      }
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                    >
                      {[5, 10, 15, 30, 60].map((m) => (
                        <option key={m} value={m}>
                          {t("form.minutes", { count: m })}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="roundingMethod"
                      className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                    >
                      {t("form.roundingMethod")}
                    </label>
                    <select
                      id="roundingMethod"
                      value={watch("roundingMethod") ?? "up"}
                      onChange={(e) =>
                        setValue(
                          "roundingMethod",
                          e.target.value as "up" | "nearest" | "down",
                          { shouldDirty: true },
                        )
                      }
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                    >
                      <option value="up">{t("form.roundingUp")}</option>
                      <option value="nearest">
                        {t("form.roundingNearestMethod")}
                      </option>
                      <option value="down">{t("form.roundingDown")}</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div>
              <span className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("form.tags")}
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("form.tagsHint")}
              </p>
              <div className="mt-1">
                <TagPicker
                  selectedTagIds={tagIds}
                  onChange={setTagIds}
                  placeholder={t("form.tagPlaceholder")}
                />
              </div>
            </div>
          </div>
        </div>

        {/* URL Patterns for Browser Extension */}
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <div className="mb-4 flex items-center gap-2">
            <Globe className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("form.extensionTitle")}
            </h2>
          </div>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {t.rich("form.extensionDescription", {
              code: (chunks) => (
                <code className="rounded bg-gray-100 dark:bg-gray-800 px-1 py-0.5">
                  {chunks}
                </code>
              ),
            })}
          </p>

          <div className="space-y-3">
            {/* Existing patterns */}
            {urlPatterns.length > 0 && (
              <div className="space-y-2">
                {urlPatterns.map((pattern) => (
                  <div
                    key={pattern}
                    className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-3 py-2"
                  >
                    <code className="text-sm text-gray-700 dark:text-gray-200">
                      {pattern}
                    </code>
                    <button
                      type="button"
                      onClick={() => removePattern(pattern)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new pattern */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPattern();
                  }
                }}
                placeholder={t("form.patternPlaceholder")}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
              <button
                type="button"
                onClick={addPattern}
                disabled={!newPattern.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {t("form.addPattern")}
              </button>
            </div>

            {/* Help text */}
            <div className="rounded-lg bg-brand-50 dark:bg-tt-gran-lys p-3 text-sm text-brand-700 dark:text-brand-300">
              <strong>{t("form.examples")}</strong>
              <ul className="ml-4 mt-1 list-disc space-y-1">
                <li>
                  <code>github.com/acme/*</code> - {t("form.exampleGithub")}
                </li>
                <li>
                  <code>*.atlassian.net/browse/PROJ-*</code> -{" "}
                  {t("form.exampleJira")}
                </li>
                <li>
                  <code>app.asana.com/*/project/*</code> -{" "}
                  {t("form.exampleAsana")}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-4">
          <Link
            href={`/dashboard/projects/${id}`}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {tc("cancel")}
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {t("form.savingShort")}
              </>
            ) : (
              <>
                <Save className="h-5 w-5" />
                {t("form.saveChanges")}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
