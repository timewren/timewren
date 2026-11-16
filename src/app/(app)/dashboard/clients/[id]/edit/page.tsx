"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Building2, Loader2, Save, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { use, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/dashboard-nav";
import { TagPicker } from "@/components/tags/TagPicker";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { trpc } from "@/providers/trpc-provider";

const createClientSchema = (t: (key: string) => string) =>
  z.object({
    name: z.string().min(2, t("form.nameMin")),
    email: z
      .string()
      .email(t("form.invalidEmail"))
      .optional()
      .or(z.literal("")),
    phone: z.string().optional(),
    company: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().optional(),
    cvrNumber: z.string().optional(),
    notes: z.string().optional(),
    defaultHourlyRate: z.string().optional(),
    paymentTermsDays: z.string().optional(),
    monthlyStatusReportEnabled: z.boolean().optional(),
    autoReminderEnabled: z.boolean().optional(),
    monthlyStatusNote: z.string().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
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
    hidePrepaidValue: z.boolean().nullable().optional(),
    isInternal: z.boolean().optional(),
    approvalWorkflow: z
      .enum(["off", "per_entry", "per_period", "per_invoice_draft"])
      .nullable()
      .optional(),
  });

type ClientForm = z.infer<ReturnType<typeof createClientSchema>>;

export default function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const clientSchema = useMemo(() => createClientSchema(t), [t]);
  const router = useRouter();
  const [cvrNumber, setCvrNumber] = useState("");
  const [cvrError, setCvrError] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [useCustomApproval, setUseCustomApproval] = useState(false);
  const [clientApprovalWorkflow, setClientApprovalWorkflow] = useState<
    "off" | "per_entry" | "per_period" | "per_invoice_draft" | null
  >(null);

  const { data: client, isLoading } = trpc.clients.getById.useQuery({ id });

  useEffect(() => {
    if (client?.tags) {
      setTagIds(client.tags.map((t) => t.id));
    }
    if (client) {
      if (client.approvalWorkflow) {
        setUseCustomApproval(true);
        setClientApprovalWorkflow(
          client.approvalWorkflow as
            | "off"
            | "per_entry"
            | "per_period"
            | "per_invoice_draft",
        );
      } else {
        setUseCustomApproval(false);
        setClientApprovalWorkflow(null);
      }
    }
  }, [client]);

  const setTagsForClient = trpc.tags.setForClient.useMutation();
  const utils = trpc.useUtils();
  const formValues = client
    ? {
        name: client.name,
        email: client.email || "",
        phone: client.phone || "",
        company: client.company || "",
        address: client.address || "",
        city: client.city || "",
        postalCode: client.postalCode || "",
        country: client.country || "Danmark",
        cvrNumber: client.cvrNumber || "",
        notes: client.notes || "",
        defaultHourlyRate: client.defaultHourlyRate || "",
        monthlyStatusReportEnabled: client.monthlyStatusReportEnabled,
        autoReminderEnabled: client.autoReminderEnabled,
        monthlyStatusNote: client.monthlyStatusNote ?? "",
        paymentTermsDays:
          client.paymentTermsDays != null
            ? String(client.paymentTermsDays)
            : "",
        color: client.color || null,
        roundingEnabled: client.roundingEnabled ?? null,
        roundingMinutes:
          (client.roundingMinutes as 5 | 10 | 15 | 30 | 60 | null) ?? null,
        roundingMethod:
          (client.roundingMethod as "up" | "nearest" | "down") ?? null,
        hidePrepaidValue: client.hidePrepaidValue ?? null,
        isInternal: client.defaultBillable === false,
      }
    : undefined;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    values: formValues,
    // En refetch (fx efter global invalidering fra en anden mutation) må ikke
    // overskrive det brugeren er i gang med at taste.
    resetOptions: { keepDirtyValues: true },
  });

  const updateMutation = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.clients.invalidate();
    },
  });

  const cvrLookupMutation = trpc.integrations.cvrSearch.useMutation({
    onSuccess: (data) => {
      if (!data) {
        setCvrError(t("form.noCompanyFound"));
        return;
      }
      // Auto-fill form with CVR data
      setValue("name", data.name);
      setValue("company", data.name);
      setValue("email", data.email || "");
      setValue("phone", data.phoneNumber || "");
      setValue("address", data.address);
      setValue("city", data.city);
      setValue("postalCode", data.postalCode);
      setValue("country", data.country);
      setValue("cvrNumber", data.cvrNumber);
      setCvrError("");
    },
    onError: (error) => {
      setCvrError(error.message || t("form.searchFailed"));
    },
  });

  const handleCVRLookup = () => {
    if (!cvrNumber) return;
    cvrLookupMutation.mutate({ query: cvrNumber });
  };

  const onSubmit = async (data: ClientForm) => {
    const { isInternal, ...rest } = data;
    try {
      await updateMutation.mutateAsync({
        id,
        data: {
          ...rest,
          defaultBillable: !isInternal,
          paymentTermsDays: data.paymentTermsDays
            ? Number.parseInt(data.paymentTermsDays, 10)
            : null,
          monthlyStatusReportEnabled: data.monthlyStatusReportEnabled ?? false,
          autoReminderEnabled: data.autoReminderEnabled ?? false,
          monthlyStatusNote: data.monthlyStatusNote?.trim() || null,
          approvalWorkflow: useCustomApproval ? clientApprovalWorkflow : null,
        },
      });
      await setTagsForClient.mutateAsync({ clientId: id, tagIds });
      toast.success(t("form.updated"));
      router.push(`/dashboard/clients/${id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("form.saveFailed"),
      );
    }
  };

  if (isLoading) {
    return <LoadingScreen message={t("form.loading")} />;
  }

  if (!client) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-600 dark:text-gray-400">{t("form.notFound")}</p>
        <Link
          href="/dashboard/clients"
          className="mt-4 inline-flex items-center gap-2 text-brand-600 dark:text-brand-400"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("form.backToClients")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div>
        <PageHeader
          title={t("form.editTitle")}
          description={t("form.editDescription", { name: client.name })}
          dynamicLabels={{ [id]: client.name }}
        />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Company Search */}
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-6 dark:border-brand-600 dark:bg-tt-gran-lys">
          <div className="flex items-start gap-4">
            <Building2 className="h-6 w-6 shrink-0 text-brand-600 dark:text-brand-400" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("form.searchTitle")}
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {t("form.searchHint")}
              </p>
              <div className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={cvrNumber}
                  onChange={(e) => {
                    setCvrNumber(e.target.value);
                    setCvrError("");
                  }}
                  placeholder={t("form.searchPlaceholder")}
                  className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
                <button
                  type="button"
                  onClick={handleCVRLookup}
                  disabled={cvrLookupMutation.isPending || !cvrNumber}
                  className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cvrLookupMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("form.searching")}
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" />
                      {t("form.searchButton")}
                    </>
                  )}
                </button>
              </div>
              {cvrError && (
                <p className="mt-2 text-sm text-red-600">{cvrError}</p>
              )}
              {cvrLookupMutation.data && !cvrError && (
                <p className="mt-2 text-sm text-green-600">
                  {t("form.found", {
                    name: cvrLookupMutation.data.name,
                    cvr: cvrLookupMutation.data.cvrNumber,
                  })}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Client Form */}
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="mb-6 text-sm font-semibold text-gray-900 dark:text-white">
            {t("form.sectionTitle")}
          </h2>

          <div className="space-y-4">
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
                htmlFor="email"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.email")}
              </label>
              <input
                id="email"
                type="email"
                {...register("email")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder={t("form.emailPlaceholder")}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="phone"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.phone")}
              </label>
              <input
                id="phone"
                type="tel"
                {...register("phone")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder="+45 12 34 56 78"
              />
            </div>

            <div>
              <label
                htmlFor="company"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.company")}
              </label>
              <input
                id="company"
                {...register("company")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder={t("form.companyPlaceholder")}
              />
            </div>

            <div>
              <label
                htmlFor="address"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.address")}
              </label>
              <input
                id="address"
                {...register("address")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder={t("form.addressPlaceholder")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="postalCode"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("form.postalCode")}
                </label>
                <input
                  id="postalCode"
                  {...register("postalCode")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder="1000"
                />
              </div>

              <div>
                <label
                  htmlFor="city"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("form.city")}
                </label>
                <input
                  id="city"
                  {...register("city")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder={t("form.cityPlaceholder")}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="country"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("form.country")}
                </label>
                <input
                  id="country"
                  {...register("country")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder={t("form.countryPlaceholder")}
                />
              </div>

              <div>
                <label
                  htmlFor="cvrNumber"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("form.cvr")}
                </label>
                <input
                  id="cvrNumber"
                  {...register("cvrNumber")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder="12345678"
                  maxLength={8}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="defaultHourlyRate"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.hourlyRate")}
              </label>
              <input
                id="defaultHourlyRate"
                type="number"
                {...register("defaultHourlyRate")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder="750"
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("form.hourlyRateHint")}
              </p>
            </div>

            <div>
              <label
                htmlFor="paymentTermsDays"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.paymentTerms")}
              </label>
              <input
                id="paymentTermsDays"
                type="number"
                min={0}
                max={365}
                {...register("paymentTermsDays")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder="14"
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("form.paymentTermsHint")}
              </p>
            </div>

            {/* Intern klient (#541) */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...register("isInternal")}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("form.internalLabel")}
                </span>
              </label>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("form.internalHintEdit")}
              </p>
            </div>

            {/* Automatiske rykkere (#92) */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...register("autoReminderEnabled")}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("form.autoReminderLabel")}
                </span>
              </label>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("form.autoReminderHint")}
              </p>
            </div>

            {/* Månedlig statusrapport (#96) */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...register("monthlyStatusReportEnabled")}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("form.monthlyReportLabel")}
                </span>
              </label>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("form.monthlyReportHint")}
              </p>
              {watch("monthlyStatusReportEnabled") && (
                <div className="mt-3">
                  <label
                    htmlFor="monthlyStatusNote"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    {t("form.monthlyNoteLabel")}
                  </label>
                  <textarea
                    id="monthlyStatusNote"
                    rows={2}
                    maxLength={1000}
                    {...register("monthlyStatusNote")}
                    placeholder={t("form.monthlyNotePlaceholder")}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  />
                </div>
              )}
            </div>

            {/* Client Color */}
            <div>
              <label
                htmlFor="color"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.color")}
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="color"
                  type="color"
                  value={watch("color") || "#3b82f6"}
                  onChange={(e) => setValue("color", e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-gray-200 dark:border-gray-700"
                />
                <div className="flex gap-1.5">
                  {[
                    "#3b82f6",
                    "#10b981",
                    "#f59e0b",
                    "#ef4444",
                    "#8b5cf6",
                    "#ec4899",
                    "#06b6d4",
                    "#84cc16",
                  ].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setValue("color", c)}
                      className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${watch("color") === c ? "border-gray-900 dark:border-white scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                {watch("color") && (
                  <button
                    type="button"
                    onClick={() => setValue("color", null)}
                    className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  >
                    {t("form.colorReset")}
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("form.colorHintEdit")}
              </p>
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
                      {
                        shouldDirty: true,
                      },
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

            {/* Klippekort: skjul beløb pr. kunde */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 p-4">
              <label
                htmlFor="hidePrepaidValueMode"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.prepaidAmount")}
              </label>
              <select
                id="hidePrepaidValueMode"
                value={
                  watch("hidePrepaidValue") === true
                    ? "hide"
                    : watch("hidePrepaidValue") === false
                      ? "show"
                      : "inherit"
                }
                onChange={(e) => {
                  const mode = e.target.value;
                  setValue(
                    "hidePrepaidValue",
                    mode === "inherit" ? null : mode === "hide",
                    { shouldDirty: true },
                  );
                }}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              >
                <option value="inherit">{t("form.roundingInherit")}</option>
                <option value="show">{t("form.prepaidShow")}</option>
                <option value="hide">{t("form.prepaidHide")}</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("form.prepaidHint")}
              </p>
            </div>

            {/* Client Approval Workflow */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 p-4">
              <div className="space-y-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={useCustomApproval}
                    onChange={(e) => {
                      setUseCustomApproval(e.target.checked);
                      if (!e.target.checked) setClientApprovalWorkflow(null);
                      else setClientApprovalWorkflow("off");
                    }}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t("form.customApproval")}
                  </span>
                </label>
                {useCustomApproval && (
                  <select
                    value={clientApprovalWorkflow ?? "off"}
                    onChange={(e) =>
                      setClientApprovalWorkflow(
                        e.target.value as
                          | "off"
                          | "per_entry"
                          | "per_period"
                          | "per_invoice_draft",
                      )
                    }
                    className="block w-64 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  >
                    <option value="off">{t("form.approvalOff")}</option>
                    <option value="per_entry">
                      {t("form.approvalPerEntry")}
                    </option>
                    <option value="per_period">
                      {t("form.approvalPerPeriod")}
                    </option>
                    <option value="per_invoice_draft">
                      {t("form.approvalPerInvoiceDraft")}
                    </option>
                  </select>
                )}
              </div>
            </div>

            <div>
              <label
                htmlFor="notes"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.notes")}
              </label>
              <textarea
                id="notes"
                {...register("notes")}
                rows={4}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder={t("form.notesPlaceholder")}
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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

          {updateMutation.error && (
            <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-400">
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
                  {t("form.saving")}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {t("form.saveChanges")}
                </>
              )}
            </button>
            <Link
              href={`/dashboard/clients/${id}`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {tc("cancel")}
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
