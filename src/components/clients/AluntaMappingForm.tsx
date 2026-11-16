"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ModalWithFooter } from "@/components/ui/Modal";
import { trpc } from "@/providers/trpc-provider";

const createMappingSchema = (t: (key: string) => string) =>
  z.object({
    aluntaPlanUuid: z.string().min(1, t("aluntaMapping.form.planUuidRequired")),
    aluntaPlanName: z.string().min(1, t("aluntaMapping.form.planNameRequired")),
    hoursPerPeriod: z.number().positive(t("aluntaMapping.form.mustBePositive")),
    hourlyRate: z.number().positive(t("aluntaMapping.form.mustBePositive")),
    renewalBehavior: z.enum(["parallel", "transfer", "archive"]),
    clipSizeMinutes: z.number().int().positive().nullable().optional(),
  });

type MappingForm = z.infer<ReturnType<typeof createMappingSchema>>;

interface AluntaMappingFormProps {
  clientId: string;
  existingMapping?: {
    id: string;
    aluntaPlanUuid: string;
    aluntaPlanName: string;
    hoursPerPeriod: string;
    hourlyRate: string;
    renewalBehavior: string;
    clipSizeMinutes: number | null;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AluntaMappingForm({
  clientId,
  existingMapping,
  open,
  onOpenChange,
}: AluntaMappingFormProps) {
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const utils = trpc.useUtils();
  const isEditing = !!existingMapping;
  const mappingSchema = useMemo(() => createMappingSchema(t), [t]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MappingForm>({
    resolver: zodResolver(mappingSchema),
    defaultValues: {
      aluntaPlanUuid: "",
      aluntaPlanName: "",
      hoursPerPeriod: undefined as unknown as number,
      hourlyRate: undefined as unknown as number,
      renewalBehavior: "parallel",
      clipSizeMinutes: null,
    },
  });

  // Reset form when modal opens or mapping changes
  useEffect(() => {
    if (open) {
      if (existingMapping) {
        reset({
          aluntaPlanUuid: existingMapping.aluntaPlanUuid,
          aluntaPlanName: existingMapping.aluntaPlanName,
          hoursPerPeriod: Number.parseFloat(existingMapping.hoursPerPeriod),
          hourlyRate: Number.parseFloat(existingMapping.hourlyRate),
          renewalBehavior:
            (existingMapping.renewalBehavior as MappingForm["renewalBehavior"]) ||
            "parallel",
          clipSizeMinutes: existingMapping.clipSizeMinutes ?? null,
        });
      } else {
        reset({
          aluntaPlanUuid: "",
          aluntaPlanName: "",
          hoursPerPeriod: undefined as unknown as number,
          hourlyRate: undefined as unknown as number,
          renewalBehavior: "parallel",
          clipSizeMinutes: null,
        });
      }
    }
  }, [open, existingMapping, reset]);

  const createMutation = trpc.aluntaKlippekort.createMapping.useMutation({
    onSuccess: () => {
      toast.success(t("aluntaMapping.form.created"));
      utils.aluntaKlippekort.getMappingForClient.invalidate({ clientId });
      utils.aluntaKlippekort.listMappings.invalidate();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(t("aluntaMapping.form.createFailed"), {
        description: error.message,
      });
    },
  });

  const updateMutation = trpc.aluntaKlippekort.updateMapping.useMutation({
    onSuccess: () => {
      toast.success(t("aluntaMapping.form.updated"));
      utils.aluntaKlippekort.getMappingForClient.invalidate({ clientId });
      utils.aluntaKlippekort.listMappings.invalidate();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(t("aluntaMapping.updateFailed"), {
        description: error.message,
      });
    },
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (data: MappingForm) => {
    const clipSize = data.clipSizeMinutes ? Number(data.clipSizeMinutes) : null;

    if (isEditing && existingMapping) {
      updateMutation.mutate({
        id: existingMapping.id,
        aluntaPlanUuid: data.aluntaPlanUuid,
        aluntaPlanName: data.aluntaPlanName,
        hoursPerPeriod: data.hoursPerPeriod,
        hourlyRate: data.hourlyRate,
        renewalBehavior: data.renewalBehavior,
        clipSizeMinutes: clipSize,
      });
    } else {
      createMutation.mutate({
        clientId,
        aluntaPlanUuid: data.aluntaPlanUuid,
        aluntaPlanName: data.aluntaPlanName,
        hoursPerPeriod: data.hoursPerPeriod,
        hourlyRate: data.hourlyRate,
        renewalBehavior: data.renewalBehavior,
        clipSizeMinutes: clipSize,
      });
    }
  };

  return (
    <ModalWithFooter
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={
        isEditing
          ? t("aluntaMapping.form.titleEdit")
          : t("aluntaMapping.form.titleCreate")
      }
      description={t("aluntaMapping.form.description")}
      footer={
        <>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {tc("cancel")}
          </button>
          <button
            type="submit"
            form="alunta-mapping-form"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-tt-paa-gran bg-tt-gran rounded-lg hover:bg-tt-gran-moerk transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isEditing
              ? t("aluntaMapping.form.submitEdit")
              : t("aluntaMapping.form.submitCreate")}
          </button>
        </>
      }
    >
      <form
        id="alunta-mapping-form"
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-4"
      >
        {/* Alunta Plan UUID */}
        <div>
          <label
            htmlFor="aluntaPlanUuid"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("aluntaMapping.form.planUuidLabel")}
          </label>
          <input
            id="aluntaPlanUuid"
            type="text"
            {...register("aluntaPlanUuid")}
            placeholder={t("aluntaMapping.form.planUuidPlaceholder")}
            aria-describedby={
              errors.aluntaPlanUuid
                ? "aluntaPlanUuid-error"
                : "aluntaPlanUuid-help"
            }
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
          />
          <p id="aluntaPlanUuid-help" className="mt-1 text-xs text-gray-400">
            {t("aluntaMapping.form.planUuidHelp")}
          </p>
          {errors.aluntaPlanUuid && (
            <p
              id="aluntaPlanUuid-error"
              className="mt-1 text-sm text-danger-500"
              role="alert"
            >
              {errors.aluntaPlanUuid.message}
            </p>
          )}
        </div>

        {/* Alunta Plan Navn */}
        <div>
          <label
            htmlFor="aluntaPlanName"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("aluntaMapping.form.planNameLabel")}
          </label>
          <input
            id="aluntaPlanName"
            type="text"
            {...register("aluntaPlanName")}
            placeholder={t("aluntaMapping.form.planNamePlaceholder")}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
          />
          {errors.aluntaPlanName && (
            <p className="mt-1 text-sm text-danger-500" role="alert">
              {errors.aluntaPlanName.message}
            </p>
          )}
        </div>

        {/* Timer pr. periode + Timepris side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="hoursPerPeriod"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("aluntaMapping.form.hoursLabel")}
            </label>
            <input
              id="hoursPerPeriod"
              type="number"
              step="0.5"
              min="0.5"
              {...register("hoursPerPeriod", { valueAsNumber: true })}
              placeholder="10"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
            />
            {errors.hoursPerPeriod && (
              <p className="mt-1 text-sm text-danger-500" role="alert">
                {errors.hoursPerPeriod.message}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="hourlyRate"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("aluntaMapping.form.rateLabel")}
            </label>
            <input
              id="hourlyRate"
              type="number"
              step="1"
              min="1"
              {...register("hourlyRate", { valueAsNumber: true })}
              placeholder="950"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
            />
            {errors.hourlyRate && (
              <p className="mt-1 text-sm text-danger-500" role="alert">
                {errors.hourlyRate.message}
              </p>
            )}
          </div>
        </div>

        {/* Ved fornyelse */}
        <div>
          <label
            htmlFor="renewalBehavior"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("aluntaMapping.form.renewalLabel")}
          </label>
          <select
            id="renewalBehavior"
            {...register("renewalBehavior")}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
          >
            <option value="parallel">
              {t("aluntaMapping.renewal.parallel")}
            </option>
            <option value="transfer">
              {t("aluntaMapping.renewal.transfer")}
            </option>
            <option value="archive">
              {t("aluntaMapping.renewal.archive")}
            </option>
          </select>
          {errors.renewalBehavior && (
            <p className="mt-1 text-sm text-danger-500" role="alert">
              {errors.renewalBehavior.message}
            </p>
          )}
        </div>

        {/* Klipstørrelse */}
        <div>
          <label
            htmlFor="clipSizeMinutes"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("aluntaMapping.form.clipSizeLabel")}{" "}
            <span className="text-gray-400 font-normal">
              {t("aluntaMapping.form.optional")}
            </span>
          </label>
          <input
            id="clipSizeMinutes"
            type="number"
            step="1"
            min="1"
            {...register("clipSizeMinutes", {
              setValueAs: (v: string | number | null) =>
                v === "" || v === null || v === undefined ? null : Number(v),
            })}
            placeholder={t("aluntaMapping.form.clipSizePlaceholder")}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
          />
          <p className="mt-1 text-xs text-gray-400">
            {t("aluntaMapping.form.clipSizeHelp")}
          </p>
        </div>
      </form>
    </ModalWithFooter>
  );
}
