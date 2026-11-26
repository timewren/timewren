"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { use, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import {
  overdraftUpdateFromForm,
  toOverdraftPolicy,
} from "@/lib/prepaid/overdraft-form";
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

export default function EditPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
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
  const [priceMode, setPriceMode] = useState<PriceMode>("hourly");
  const [error, setError] = useState("");

  const utils = trpc.useUtils();
  const { data: pkg, isLoading } = trpc.prepaid.getById.useQuery({ id });
  const { data: clients } = trpc.clients.list.useQuery();
  const updateMutation = trpc.prepaid.update.useMutation({
    onSuccess: () => {
      utils.prepaid.invalidate();
      router.push(`/dashboard/klippekort/${id}`);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const formValues = pkg
    ? {
        name: pkg.name,
        clientId: pkg.clientId,
        totalHours: pkg.totalHours,
        hourlyRate: pkg.hourlyRate,
        totalPrice: pkg.totalValue,
        purchaseDate: toLocalDateStr(new Date(pkg.purchaseDate)),
        expiryDate: pkg.expiryDate
          ? toLocalDateStr(new Date(pkg.expiryDate))
          : "",
        description: pkg.description || "",
        clipSizeMinutes: pkg.clipSizeMinutes
          ? pkg.clipSizeMinutes.toString()
          : "",
        overdraftPolicy: toOverdraftPolicy(pkg.overdraftPolicy),
        overdraftRate: pkg.overdraftRate ?? "",
      }
    : undefined;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PackageForm>({
    resolver: zodResolver(packageSchema),
    values: formValues,
    // En refetch (fx efter global invalidering fra en anden mutation) må ikke
    // overskrive det brugeren er i gang med at taste.
    resetOptions: { keepDirtyValues: true },
  });

  const totalHours = parseFloat(watch("totalHours") || "0");
  const totalPrice = parseFloat(watch("totalPrice") || "0");
  const hourlyRate = parseFloat(watch("hourlyRate") || "0");

  const calculatedHourlyRate =
    priceMode === "package" && totalHours > 0 && totalPrice > 0
      ? totalPrice / totalHours
      : hourlyRate;
  const calculatedTotalValue =
    priceMode === "hourly" ? totalHours * hourlyRate : totalPrice;

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
      await updateMutation.mutateAsync({
        id,
        data: {
          name: data.name,
          clientId: data.clientId,
          totalHours: hours,
          hourlyRate: Math.round(rate * 100) / 100,
          purchaseDate: data.purchaseDate,
          expiryDate: data.expiryDate || undefined,
          description: data.description || undefined,
          clipSizeMinutes: clipSize && clipSize > 0 ? clipSize : null,
          ...overdraftUpdateFromForm(data.overdraftPolicy, data.overdraftRate),
        },
      });
    } catch {
      // Fejlen vises af mutationens onError.
    }
  };

  if (isLoading) {
    return <LoadingScreen message={t("form.loading")} />;
  }

  if (!pkg) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-600 dark:text-gray-400">{t("form.notFound")}</p>
        <Link
          href="/dashboard/klippekort"
          className="mt-4 inline-flex items-center gap-2 text-brand-600 dark:text-brand-400"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("form.back")}
        </Link>
      </div>
    );
  }

  const usedHours = parseFloat(pkg.usedHours || "0");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link
          href={`/dashboard/klippekort/${id}`}
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("form.back")}
        </Link>

        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
          {t("form.editTitle")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("form.editSubtitle")}
        </p>
      </div>

      {usedHours > 0 && (
        <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 p-4">
          <p className="text-sm text-orange-900 dark:text-orange-200">
            {t.rich("form.usedWarning", {
              used: usedHours.toFixed(2),
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
          <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
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
                onChange={(newId) => setValue("clientId", newId)}
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

          <div className="mb-4 flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
            <button
              type="button"
              onClick={() => setPriceMode("package")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                priceMode === "package"
                  ? "bg-tt-gran text-tt-paa-gran"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
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
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
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
                {t("form.packagePriceHintEdit")}
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
            </div>
          )}

          {totalHours > 0 && calculatedTotalValue > 0 && (
            <div className="mt-4 rounded-lg bg-brand-50 dark:bg-tt-gran-lys p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-brand-900 dark:text-brand-200">
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
                  <p className="text-sm font-semibold text-brand-900 dark:text-brand-200">
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
              {usedHours > 0 && (
                <p className="mt-2 text-xs text-brand-600 dark:text-brand-400">
                  {t("form.usedLeft", {
                    used: usedHours.toFixed(2),
                    left: (totalHours - usedHours).toFixed(2),
                  })}
                </p>
              )}
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
                {t("form.clipHintEdit")}
              </p>
            </div>

            {/* Overtræks-politik (#93), også på et eksisterende kort (#1319) */}
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
                aria-describedby="overdraftPolicyHint"
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              >
                <option value="block">{t("form.overdraftBlock")}</option>
                <option value="allow">{t("form.overdraftAllow")}</option>
                <option value="invoice">{t("form.overdraftInvoice")}</option>
              </select>
              <p
                id="overdraftPolicyHint"
                className="mt-1 text-xs text-gray-500 dark:text-gray-400"
              >
                {t("form.overdraftHintEdit")}
              </p>
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
                placeholder={t("form.descriptionPlaceholderEdit")}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="flex-1 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {updateMutation.isPending
              ? t("form.saving")
              : t("form.saveChanges")}
          </button>
          <Link
            href={`/dashboard/klippekort/${id}`}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {tc("cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}
