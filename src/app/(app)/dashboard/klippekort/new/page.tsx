"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, BookmarkPlus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

type PackageSchemaMessages = {
  nameMin: string;
  selectClient: string;
  enterHours: string;
  selectPurchaseDate: string;
};

const createPackageSchema = (m: PackageSchemaMessages) =>
  z.object({
    name: z.string().min(2, m.nameMin),
    clientId: z.string().uuid(m.selectClient),
    totalHours: z.string().min(1, m.enterHours),
    // One of these must be set - validation handled in onSubmit
    totalPrice: z.string().optional(),
    hourlyRate: z.string().optional(),
    purchaseDate: z.string().min(1, m.selectPurchaseDate),
    expiryDate: z.string().optional(),
    description: z.string().optional(),
    clipSizeMinutes: z.string().optional(),
    overdraftPolicy: z.enum(["block", "allow", "invoice"]).optional(),
    overdraftRate: z.string().optional(),
  });

type PackageForm = z.infer<ReturnType<typeof createPackageSchema>>;

type PriceMode = "package" | "hourly";

export default function NewPackagePage() {
  const t = useTranslations("klippekort");
  const tc = useTranslations("common");
  const locale = useLocale();
  const packageSchema = useMemo(
    () =>
      createPackageSchema({
        nameMin: t("form.nameMin"),
        selectClient: t("form.selectClient"),
        enterHours: t("form.enterHours"),
        selectPurchaseDate: t("form.selectPurchaseDate"),
      }),
    [t],
  );
  const router = useRouter();
  // Forudfyldning (#90): ?clientId=…&hours=…&rate=…&name=… fra kundesiden
  // og klippekort-forslagene. Kun gyldige værdier bruges.
  const searchParams = useSearchParams();
  const positive = (key: string) => {
    const value = searchParams.get(key);
    return value && Number(value) > 0 ? value : undefined;
  };
  const prefill = {
    clientId: searchParams.get("clientId") ?? undefined,
    hours: positive("hours"),
    rate: positive("rate"),
    name: searchParams.get("name")?.slice(0, 100) || undefined,
  };
  const [error, setError] = useState("");
  const [priceMode, setPriceMode] = useState<PriceMode>(
    prefill.rate ? "hourly" : "package",
  );
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const utils = trpc.useUtils();
  const { data: clients } = trpc.clients.list.useQuery();
  const { data: templates } = trpc.prepaid.listTemplates.useQuery();

  const createMutation = trpc.prepaid.create.useMutation({
    onSuccess: () => {
      utils.prepaid.invalidate();
      router.push("/dashboard/klippekort");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const createTemplateMutation = trpc.prepaid.createTemplate.useMutation({
    onSuccess: () => {
      utils.prepaid.listTemplates.invalidate();
      setShowSaveTemplate(false);
      setTemplateName("");
      toast.success(t("form.templateSaved"));
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [showDeleteTemplateConfirm, setShowDeleteTemplateConfirm] =
    useState(false);

  const deleteTemplateMutation = trpc.prepaid.deleteTemplate.useMutation({
    onSuccess: () => {
      utils.prepaid.listTemplates.invalidate();
      setSelectedTemplateId("");
      toast.success(t("form.templateDeleted"));
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PackageForm>({
    resolver: zodResolver(packageSchema),
    defaultValues: {
      purchaseDate: toLocalDateStr(new Date()),
      clientId: prefill.clientId,
      totalHours: prefill.hours,
      hourlyRate: prefill.rate,
      name: prefill.name,
    },
  });

  const totalHours = parseFloat(watch("totalHours") || "0");
  const totalPrice = parseFloat(watch("totalPrice") || "0");
  const hourlyRate = parseFloat(watch("hourlyRate") || "0");

  // Derived values based on price mode
  const calculatedHourlyRate =
    priceMode === "package" && totalHours > 0 && totalPrice > 0
      ? totalPrice / totalHours
      : hourlyRate;
  const calculatedTotalValue =
    priceMode === "hourly" ? totalHours * hourlyRate : totalPrice;

  const handleTemplateSelect = (templateId: string) => {
    if (!templateId) return;
    const template = templates?.find((tpl) => tpl.id === templateId);
    if (!template) return;

    setValue("totalHours", template.totalHours);
    if (template.hourlyRate) {
      setValue("hourlyRate", template.hourlyRate);
      setPriceMode("hourly");
    }
    if (template.clipSizeMinutes) {
      setValue("clipSizeMinutes", template.clipSizeMinutes.toString());
    } else {
      setValue("clipSizeMinutes", "");
    }
    if (template.description) {
      setValue("description", template.description);
    }
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;

    const hours = parseFloat(watch("totalHours") || "0");
    if (hours <= 0) {
      toast.error(t("form.fillHoursFirst"));
      return;
    }

    let rate: number | undefined;
    if (priceMode === "hourly") {
      rate = parseFloat(watch("hourlyRate") || "0");
      if (rate <= 0) rate = undefined;
    } else {
      const price = parseFloat(watch("totalPrice") || "0");
      if (price > 0 && hours > 0) {
        rate = Math.round((price / hours) * 100) / 100;
      }
    }

    const clipSize = watch("clipSizeMinutes")
      ? parseInt(watch("clipSizeMinutes") || "0", 10)
      : null;

    createTemplateMutation.mutate({
      name: templateName.trim(),
      totalHours: hours,
      hourlyRate: rate,
      clipSizeMinutes: clipSize && clipSize > 0 ? clipSize : null,
      description: watch("description") || undefined,
    });
  };

  const onSubmit = async (data: PackageForm) => {
    setError("");
    const hours = parseFloat(data.totalHours);
    let rate: number;

    if (priceMode === "package") {
      const price = parseFloat(data.totalPrice || "0");
      if (!price || price <= 0) {
        setError(t("form.enterPackagePrice"));
        return;
      }
      rate = price / hours;
    } else {
      rate = parseFloat(data.hourlyRate || "0");
      if (!rate || rate <= 0) {
        setError(t("form.enterHourlyRate"));
        return;
      }
    }

    const clipSize = data.clipSizeMinutes
      ? parseInt(data.clipSizeMinutes, 10)
      : null;
    try {
      await createMutation.mutateAsync({
        name: data.name,
        clientId: data.clientId,
        totalHours: hours,
        hourlyRate: Math.round(rate * 100) / 100,
        purchaseDate: data.purchaseDate,
        expiryDate: data.expiryDate || undefined,
        description: data.description || undefined,
        clipSizeMinutes: clipSize && clipSize > 0 ? clipSize : null,
        overdraftPolicy: data.overdraftPolicy || "block",
        overdraftRate:
          data.overdraftPolicy === "invoice" && data.overdraftRate
            ? Number.parseFloat(data.overdraftRate)
            : null,
      });
    } catch {
      // Fejlen vises af mutationens onError.
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link
          href="/dashboard/klippekort"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("form.back")}
        </Link>

        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
          {t("form.newTitle")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("form.newSubtitle")}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Template selector */}
      {templates && templates.length > 0 && (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <label
            htmlFor="templateSelect"
            className="block text-xs font-medium text-gray-700 dark:text-gray-300"
          >
            {t("form.fromTemplate")}
          </label>
          <div className="mt-1 flex items-center gap-2">
            <select
              id="templateSelect"
              value={selectedTemplateId}
              onChange={(e) => {
                setSelectedTemplateId(e.target.value);
                handleTemplateSelect(e.target.value);
              }}
              className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              <option value="">{t("form.chooseTemplate")}</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.hourlyRate
                    ? t("form.templateOptionRate", {
                        name: tpl.name,
                        hours: tpl.totalHours,
                        rate: tpl.hourlyRate,
                      })
                    : t("form.templateOption", {
                        name: tpl.name,
                        hours: tpl.totalHours,
                      })}
                </option>
              ))}
            </select>
            {selectedTemplateId && (
              <button
                type="button"
                aria-label={t("form.deleteTemplateSelected")}
                title={t("form.deleteTemplateSelected")}
                onClick={() => setShowDeleteTemplateConfirm(true)}
                disabled={deleteTemplateMutation.isPending}
                className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("form.templateHint")}
          </p>

          <ConfirmDialog
            isOpen={showDeleteTemplateConfirm}
            onClose={() => setShowDeleteTemplateConfirm(false)}
            onConfirm={() => {
              deleteTemplateMutation.mutate({ id: selectedTemplateId });
              setShowDeleteTemplateConfirm(false);
            }}
            title={t("form.deleteTemplateTitle")}
            description={t("form.deleteTemplateConfirm", {
              name:
                templates.find((tpl) => tpl.id === selectedTemplateId)?.name ??
                "",
            })}
            confirmLabel={tc("delete")}
            variant="danger"
            isLoading={deleteTemplateMutation.isPending}
          />
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
            {t("form.about")}
          </h2>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="name"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.name")}
              </label>
              <input
                id="name"
                type="text"
                {...register("name")}
                placeholder={t("form.namePlaceholder")}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="clientId"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.client")}
              </label>
              <ClientSearchCombobox
                clients={clients}
                value={watch("clientId") || ""}
                onChange={(id) => setValue("clientId", id)}
                placeholder={t("form.clientPlaceholder")}
              />
              {errors.clientId && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.clientId.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="totalHours"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.hours")}
              </label>
              <input
                id="totalHours"
                type="number"
                step="0.5"
                min="0.5"
                {...register("totalHours")}
                placeholder="50"
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
              {errors.totalHours && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.totalHours.message}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
            {t("form.pricing")}
          </h2>

          {/* Price mode toggle */}
          <div className="mb-4 flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
            <button
              type="button"
              onClick={() => setPriceMode("package")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                priceMode === "package"
                  ? "bg-tt-gran text-tt-paa-gran"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              {t("form.fixedPrice")}
            </button>
            <button
              type="button"
              onClick={() => setPriceMode("hourly")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                priceMode === "hourly"
                  ? "bg-tt-gran text-tt-paa-gran"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              {t("form.hourlyRate")}
            </button>
          </div>

          {priceMode === "package" ? (
            <div>
              <label
                htmlFor="totalPrice"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.packagePriceLabel")}
              </label>
              <input
                id="totalPrice"
                type="number"
                step="1"
                min="1"
                {...register("totalPrice")}
                placeholder={t("form.packagePricePlaceholder")}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("form.packagePriceHintNew")}
              </p>
            </div>
          ) : (
            <div>
              <label
                htmlFor="hourlyRate"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.hourlyRateLabel")}
              </label>
              <input
                id="hourlyRate"
                type="number"
                step="1"
                min="0"
                {...register("hourlyRate")}
                placeholder="800"
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("form.hourlyRateHint")}
              </p>
            </div>
          )}

          {/* Price summary */}
          {totalHours > 0 && calculatedTotalValue > 0 && (
            <div className="mt-4 rounded-lg bg-brand-50 dark:bg-tt-gran-lys p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">
                    {t("form.amountKr", {
                      amount: calculatedTotalValue.toLocaleString(
                        toIntlLocale(locale),
                      ),
                    })}
                  </p>
                  <p className="text-xs text-brand-700 dark:text-brand-300">
                    {t("form.totalPackagePrice")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">
                    {t("form.rateKrPerHour", {
                      rate: calculatedHourlyRate.toFixed(0),
                    })}
                  </p>
                  <p className="text-xs text-brand-700 dark:text-brand-300">
                    {priceMode === "package"
                      ? t("form.calculatedRate")
                      : t("form.hourlyRate")}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs text-brand-600 dark:text-brand-400">
                {t("form.formula", {
                  hours: totalHours,
                  rate: calculatedHourlyRate.toFixed(0),
                  total: calculatedTotalValue.toLocaleString(
                    toIntlLocale(locale),
                  ),
                })}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
            {t("form.settings")}
          </h2>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="clipSizeMinutes"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.clipSize")}
              </label>
              <select
                id="clipSizeMinutes"
                {...register("clipSizeMinutes")}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              >
                <option value="">{t("form.clipNone")}</option>
                <option value="15">
                  {t("form.clipMinutes", { minutes: 15 })}
                </option>
                <option value="20">
                  {t("form.clipMinutes", { minutes: 20 })}
                </option>
                <option value="30">
                  {t("form.clipMinutes", { minutes: 30 })}
                </option>
                <option value="60">{t("form.clip60")}</option>
                <option value="120">{t("form.clip120")}</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("form.clipHintNew")}
              </p>
            </div>

            {/* Overtræks-politik (#93) */}
            <div>
              <label
                htmlFor="overdraftPolicy"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.overdraftLabel")}
              </label>
              <select
                id="overdraftPolicy"
                {...register("overdraftPolicy")}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              >
                <option value="block">{t("form.overdraftBlock")}</option>
                <option value="allow">{t("form.overdraftAllow")}</option>
                <option value="invoice">{t("form.overdraftInvoice")}</option>
              </select>
              {watch("overdraftPolicy") === "invoice" && (
                <div className="mt-2">
                  <label
                    htmlFor="overdraftRate"
                    className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("form.overdraftRateLabel")}
                  </label>
                  <input
                    id="overdraftRate"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={t("form.overdraftRatePlaceholder")}
                    {...register("overdraftRate")}
                    className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="purchaseDate"
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("form.purchaseDate")}
                </label>
                <input
                  id="purchaseDate"
                  type="date"
                  {...register("purchaseDate")}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
                {errors.purchaseDate && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.purchaseDate.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="expiryDate"
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("form.expiryDate")}
                </label>
                <input
                  id="expiryDate"
                  type="date"
                  {...register("expiryDate")}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("form.expiryHint")}
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="description"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("form.description")}
              </label>
              <textarea
                id="description"
                {...register("description")}
                rows={3}
                placeholder={t("form.descriptionPlaceholderNew")}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3">
          <Link
            href="/dashboard/klippekort"
            className="text-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {tc("cancel")}
          </Link>

          {/* Save as template toggle */}
          {!showSaveTemplate ? (
            <button
              type="button"
              onClick={() => setShowSaveTemplate(true)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <BookmarkPlus className="h-4 w-4" />
              {t("form.saveAsTemplate")}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder={t("form.templateNamePlaceholder")}
                aria-label={t("form.templateNamePlaceholder")}
                className="w-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSaveTemplate();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={
                  !templateName.trim() || createTemplateMutation.isPending
                }
                className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {createTemplateMutation.isPending
                  ? t("form.saving")
                  : tc("save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSaveTemplate(false);
                  setTemplateName("");
                }}
                className="rounded-lg p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                aria-label={t("form.cancelSaveTemplate")}
                title={t("form.undo")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex-1 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {createMutation.isPending
              ? t("form.creating")
              : t("form.createPackage")}
          </button>
        </div>
      </form>
    </div>
  );
}
