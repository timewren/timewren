"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Calendar, CheckSquare, Clock, FileText, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useModules } from "@/hooks/useModules";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

type TemplateSchemaMessages = {
  nameMin: string;
  descriptionRequired: string;
  hoursRequired: string;
  frequencyRequired: string;
  startRequired: string;
};

const createTemplateSchema = (m: TemplateSchemaMessages) =>
  z
    .object({
      name: z.string().min(2, m.nameMin),
      templateType: z.enum(["time_entry", "task", "both"]),
      clientId: z.string().optional(),
      projectId: z.string().optional(),
      clientIds: z
        .array(
          z.object({
            clientId: z.string(),
            projectId: z.string().nullable().optional(),
          }),
        )
        .optional(),
      description: z.string().min(1, m.descriptionRequired),
      hours: z.string().optional(),
      isRecurring: z.boolean(),
      frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
      dayOfWeek: z.string().optional(),
      dayOfMonth: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      isPrepaid: z.boolean(),
      prepaidPackageId: z.string().optional(),
    })
    .refine(
      (data) => {
        if (
          data.templateType !== "task" &&
          (!data.hours || data.hours.length === 0)
        )
          return false;
        return true;
      },
      {
        message: m.hoursRequired,
        path: ["hours"],
      },
    )
    .refine(
      (data) => {
        if (data.isRecurring && !data.frequency) return false;
        return true;
      },
      {
        message: m.frequencyRequired,
        path: ["frequency"],
      },
    )
    .refine(
      (data) => {
        if (data.isRecurring && !data.startDate) return false;
        return true;
      },
      {
        message: m.startRequired,
        path: ["startDate"],
      },
    );

export type TemplateFormValues = z.infer<
  ReturnType<typeof createTemplateSchema>
>;

interface TemplateFormProps {
  mode: "create" | "edit";
  defaultValues?: Partial<TemplateFormValues>;
  onSubmit: (data: TemplateFormValues) => Promise<void>;
  isSubmitting: boolean;
  layout?: "page" | "modal";
}

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

const iconInputClass =
  "block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 pl-9 pr-3 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-200";

export function TemplateForm({
  mode,
  defaultValues,
  onSubmit,
  isSubmitting,
  layout = "page",
}: TemplateFormProps) {
  const t = useTranslations("templates");
  const templateSchema = useMemo(
    () =>
      createTemplateSchema({
        nameMin: t("form.nameMin"),
        descriptionRequired: t("form.descriptionRequired"),
        hoursRequired: t("form.hoursRequired"),
        frequencyRequired: t("form.frequencyRequired"),
        startRequired: t("form.startRequired"),
      }),
    [t],
  );
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: clientsList } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });
  const { data: projectsList } = trpc.projects.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("projects"),
  });

  const [selectedClients, setSelectedClients] = useState<
    Array<{ clientId: string; projectId?: string | null }>
  >(defaultValues?.clientIds ?? []);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      frequency: "weekly",
      isPrepaid: false,
      isRecurring: false,
      templateType: "time_entry",
      startDate: toLocalDateStr(new Date()),
      ...defaultValues,
    },
  });

  const isRecurring = watch("isRecurring");
  const frequency = watch("frequency");
  const templateType = watch("templateType");

  useEffect(() => {
    setValue("clientIds", selectedClients);
    if (selectedClients.length === 1) {
      setValue("clientId", selectedClients[0].clientId);
      setValue("projectId", selectedClients[0].projectId ?? undefined);
    } else if (selectedClients.length === 0) {
      setValue("clientId", undefined);
      setValue("projectId", undefined);
    }
  }, [selectedClients, setValue]);

  const toggleClient = (clientId: string) => {
    setSelectedClients((prev) => {
      const exists = prev.find((c) => c.clientId === clientId);
      if (exists) return prev.filter((c) => c.clientId !== clientId);
      return [...prev, { clientId, projectId: null }];
    });
  };

  const setClientProject = (clientId: string, projectId: string | null) => {
    setSelectedClients((prev) =>
      prev.map((c) => (c.clientId === clientId ? { ...c, projectId } : c)),
    );
  };

  const getProjectsForClient = (clientId: string) => {
    return (
      projectsList?.filter((p) => {
        if (p.status !== "active") return false;
        const pc = Array.isArray(p.client) ? p.client[0] : p.client;
        return pc?.id === clientId;
      }) ?? []
    );
  };

  const activeClients = clientsList?.filter((c) => !c.isArchived) ?? [];
  const isModal = layout === "modal";
  const sectionClass = isModal
    ? "space-y-3"
    : "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm";
  const headingClass = isModal
    ? "text-sm font-semibold text-gray-900 dark:text-white mb-2"
    : "mb-4 text-lg font-semibold text-gray-900 dark:text-white";

  const basicInfoSection = (
    <div className={sectionClass}>
      <h2 className={headingClass}>{t("form.basics")}</h2>
      <div className="space-y-3">
        <div>
          <label htmlFor="name" className={labelClass}>
            {t("form.name")}
          </label>
          <input
            type="text"
            id="name"
            {...register("name")}
            className={inputClass}
            placeholder={t("form.namePlaceholder")}
            // biome-ignore lint/a11y/noAutofocus: feltet vises som følge af brugerens handling (inline-redigering/dialog), så fokus flytter forventeligt
            autoFocus={isModal}
          />
          {errors.name && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {errors.name.message}
            </p>
          )}
        </div>

        <div>
          <span className={labelClass}>{t("form.type")}</span>
          <div className="mt-1 flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
            {[
              {
                value: "time_entry" as const,
                label: t("form.typeTime"),
                icon: <Clock className="h-3.5 w-3.5" />,
              },
              {
                value: "task" as const,
                label: t("form.typeTask"),
                icon: <CheckSquare className="h-3.5 w-3.5" />,
              },
              {
                value: "both" as const,
                label: t("form.typeBoth"),
                icon: (
                  <>
                    <Clock className="h-3.5 w-3.5" />
                    <CheckSquare className="h-3.5 w-3.5" />
                  </>
                ),
              },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setValue("templateType", option.value)}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  templateType === option.value
                    ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="description" className={labelClass}>
            {t("form.description")}
          </label>
          <textarea
            id="description"
            rows={isModal ? 2 : 3}
            {...register("description")}
            className={inputClass}
            placeholder={t("form.descriptionPlaceholder")}
          />
          {errors.description && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {errors.description.message}
            </p>
          )}
        </div>

        {templateType !== "task" && (
          <div>
            <label htmlFor="hours" className={labelClass}>
              {t("form.hours")}
            </label>
            <div className="relative mt-1">
              <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="number"
                id="hours"
                step="0.25"
                {...register("hours")}
                className={iconInputClass}
                placeholder="0.00"
              />
            </div>
            {errors.hours && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.hours.message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const clientSection = (
    <div className={sectionClass}>
      <h2 className={headingClass}>
        {t("form.clients")}{" "}
        <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
          {t("form.optional")}
        </span>
      </h2>
      <div
        className={`space-y-1.5 ${isModal ? "max-h-40 overflow-y-auto" : ""}`}
      >
        {activeClients.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("form.noClients")}
          </p>
        ) : (
          activeClients.map((client) => {
            const isSelected = selectedClients.some(
              (c) => c.clientId === client.id,
            );
            const clientProjects = getProjectsForClient(client.id);
            const selectedEntry = selectedClients.find(
              (c) => c.clientId === client.id,
            );

            return (
              <div
                key={client.id}
                className={`rounded-lg border p-2 transition-colors ${
                  isSelected
                    ? "border-brand-300 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleClient(client.id)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {client.name}
                  </span>
                </label>

                {isSelected && clientProjects.length > 0 && (
                  <div className="mt-1.5 ml-6">
                    <select
                      value={selectedEntry?.projectId ?? ""}
                      onChange={(e) =>
                        setClientProject(client.id, e.target.value || null)
                      }
                      className={inputClass}
                    >
                      <option value="">{t("form.noProject")}</option>
                      {clientProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const recurrenceSection = (
    <div className={sectionClass}>
      <div className="flex items-center justify-between mb-2">
        <h2 className={headingClass}>{t("form.recurrence")}</h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            {...register("isRecurring")}
            className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
          />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
            {t("form.active")}
          </span>
        </label>
      </div>

      {isRecurring ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="frequency" className={labelClass}>
              {t("form.frequency")}
            </label>
            <select
              id="frequency"
              {...register("frequency")}
              className={inputClass}
            >
              <option value="daily">{t("form.daily")}</option>
              <option value="weekly">{t("form.weekly")}</option>
              <option value="monthly">{t("form.monthly")}</option>
            </select>
            {errors.frequency && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.frequency.message}
              </p>
            )}
          </div>

          {frequency === "weekly" && (
            <div>
              <label htmlFor="dayOfWeek" className={labelClass}>
                {t("form.weekday")}
              </label>
              <select
                id="dayOfWeek"
                {...register("dayOfWeek")}
                className={inputClass}
              >
                <option value="">{t("form.chooseDay")}</option>
                <option value="1">{t("form.mon")}</option>
                <option value="2">{t("form.tue")}</option>
                <option value="3">{t("form.wed")}</option>
                <option value="4">{t("form.thu")}</option>
                <option value="5">{t("form.fri")}</option>
                <option value="6">{t("form.sat")}</option>
                <option value="0">{t("form.sun")}</option>
              </select>
            </div>
          )}

          {frequency === "monthly" && (
            <div>
              <label htmlFor="dayOfMonth" className={labelClass}>
                {t("form.dayOfMonth")}
              </label>
              <input
                type="number"
                id="dayOfMonth"
                min="1"
                max="31"
                {...register("dayOfMonth")}
                className={inputClass}
                placeholder="1-31"
              />
            </div>
          )}

          <div className={isModal ? "grid grid-cols-2 gap-2" : "space-y-3"}>
            <div>
              <label htmlFor="startDate" className={labelClass}>
                {t("form.start")}
              </label>
              <div className="relative mt-1">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="date"
                  id="startDate"
                  {...register("startDate")}
                  className={iconInputClass}
                />
              </div>
              {errors.startDate && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {errors.startDate.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="endDate" className={labelClass}>
                {t("form.end")}
              </label>
              <div className="relative mt-1">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="date"
                  id="endDate"
                  {...register("endDate")}
                  className={iconInputClass}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("form.manualHint")}
        </p>
      )}
    </div>
  );

  const submitButton = (
    <div
      className={isModal ? "flex gap-2" : "flex items-center justify-end gap-4"}
    >
      <button
        type="submit"
        disabled={isSubmitting}
        className={`inline-flex items-center justify-center gap-2 rounded-lg bg-tt-gran font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50 ${
          isModal ? "flex-1 px-4 py-2 text-sm" : "px-6 py-2.5"
        }`}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {mode === "create" ? t("form.creating") : t("form.saving")}
          </>
        ) : (
          <>
            <FileText className="h-4 w-4" />
            {mode === "create" ? t("form.create") : t("form.saveChanges")}
          </>
        )}
      </button>
    </div>
  );

  if (isModal) {
    return (
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">{basicInfoSection}</div>
          <div className="space-y-4">
            {clientSection}
            {recurrenceSection}
          </div>
        </div>
        <div className="mt-4">{submitButton}</div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {basicInfoSection}
      {clientSection}
      {recurrenceSection}
      {submitButton}
    </form>
  );
}
