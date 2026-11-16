"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button, Input, Textarea } from "@/components/ui";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { useModules } from "@/hooks/useModules";
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
  });

type ProjectForm = z.infer<ReturnType<typeof createProjectSchema>>;

function NewProjectPageContent() {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const projectSchema = useMemo(() => createProjectSchema(t), [t]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const {
    orgProfile,
    isPlaceholder,
    isEnabled: isModuleEnabled,
  } = useModules();
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: !isPlaceholder && isModuleEnabled("clients"),
  });
  // Enterprise-profil: projekter kan være interne uden kunde (#467)
  const clientOptional = !isPlaceholder && orgProfile === "enterprise";

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
  });

  // Prefill client when arriving via "Nyt projekt" from a client page
  // (/dashboard/projects/new?clientId=...)
  const prefillClientId = searchParams.get("clientId");
  useEffect(() => {
    if (prefillClientId && !watch("clientId")) {
      setValue("clientId", prefillClientId);
    }
  }, [prefillClientId, setValue, watch]);

  const createMutation = trpc.projects.create.useMutation({
    onSuccess: () => {
      utils.projects.invalidate();
      toast.success(t("form.created"));
      router.push("/dashboard/projects");
    },
    onError: (error) => {
      toast.error(error.message || t("form.createFailed"));
    },
  });

  const onSubmit = async (data: ProjectForm) => {
    if (!clientOptional && !data.clientId) {
      setError("clientId", { message: t("form.pickClient") });
      return;
    }
    try {
      await createMutation.mutateAsync({
        ...data,
        clientId: data.clientId || null,
      });
    } catch {
      // Fejlen vises af mutationens onError.
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href="/dashboard/projects"
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("form.back")}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
          {t("form.newTitle")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("form.newDescription")}
        </p>
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
                {t("form.clientNew", {
                  suffix: clientOptional ? t("form.clientOptionalHint") : "*",
                })}
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
                <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                  {errors.clientId.message}
                </p>
              )}
            </div>

            <Input
              label={`${t("form.name")} *`}
              {...register("name")}
              placeholder={t("form.namePlaceholder")}
              error={errors.name?.message}
            />

            <Textarea
              label={t("form.description")}
              {...register("description")}
              rows={4}
              placeholder={t("form.descriptionPlaceholder")}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("form.hourlyRate")}
                {...register("hourlyRate")}
                type="number"
                placeholder="750"
                hint={t("form.hourlyRateHint")}
              />

              <Input
                label={t("form.fixedPrice")}
                {...register("fixedPrice")}
                type="number"
                placeholder="50000"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("form.budgetHours")}
                {...register("budgetHours")}
                type="number"
                step="0.5"
                min="0"
                placeholder="10"
                hint={t("form.budgetHoursHintNew")}
              />
              <Input
                label={t("form.monthlyBudget")}
                {...register("monthlyBudgetHours")}
                type="number"
                step="0.5"
                min="0"
                placeholder="20"
                hint={t("form.monthlyBudgetHintNew")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("form.startDate")}
                {...register("startDate")}
                type="date"
              />

              <Input
                label={t("form.endDate")}
                {...register("endDate")}
                type="date"
              />
            </div>

            <div>
              <label
                htmlFor="status"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.status")}
              </label>
              <select
                {...register("status")}
                id="status"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              >
                <option value="active">{t("form.statusActive")}</option>
                <option value="completed">{t("form.statusCompleted")}</option>
                <option value="on_hold">{t("form.statusOnHold")}</option>
                <option value="archived">{t("form.statusArchived")}</option>
              </select>
            </div>
          </div>

          {createMutation.error && (
            <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-400">
              {createMutation.error.message}
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
            <Link
              href="/dashboard/projects"
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {tc("cancel")}
            </Link>
            <Button
              type="submit"
              disabled={isSubmitting}
              isLoading={isSubmitting}
              leftIcon={
                !isSubmitting ? <Save className="h-4 w-4" /> : undefined
              }
            >
              {isSubmitting ? t("form.savingShort") : t("form.saveNew")}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={null}>
      <NewProjectPageContent />
    </Suspense>
  );
}
