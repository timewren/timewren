"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Building2, Save, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  checkClientTaxId,
  isDanishClient,
  normalizeClientTaxId,
} from "@/components/clients/client-tax-id";
import { Button, Input, Textarea } from "@/components/ui";
import { useModules } from "@/hooks/useModules";
import { defaultClientCountry } from "@/lib/org/region";
import { trpc } from "@/providers/trpc-provider";

const createClientSchema = (t: (key: string) => string) =>
  z
    .object({
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
      isInternal: z.boolean().optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable()
        .optional(),
    })
    .superRefine((data, ctx) =>
      checkClientTaxId(data, ctx, {
        vatInvalid: t("form.vatInvalid"),
        tooLong: t("form.taxIdTooLong"),
      }),
    );

type ClientForm = z.infer<ReturnType<typeof createClientSchema>>;

export default function NewClientPage() {
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const clientSchema = useMemo(() => createClientSchema(t), [t]);
  const router = useRouter();
  const [cvrNumber, setCvrNumber] = useState("");
  const [cvrError, setCvrError] = useState("");
  const locale = useLocale();
  // Landet starter som organisationens: Danmark for TimeTrack og en dansk
  // TimeWren-bruger, ellers brugerens eget eller tomt (fund 19).
  const { region, isPlaceholder: regionPending } = useModules();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    getFieldState,
    formState: { errors, isSubmitting },
  } = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: { country: defaultClientCountry(region, locale) },
  });

  useEffect(() => {
    if (regionPending || getFieldState("country").isDirty) return;
    setValue("country", defaultClientCountry(region, locale));
  }, [region, regionPending, locale, getFieldState, setValue]);

  // CVR-opslag og CVR-format kun for danske kunder; ellers momsnummer.
  const isDanish = isDanishClient(watch("country"));

  const createMutation = trpc.clients.create.useMutation({
    onSuccess: () => {
      router.push("/dashboard/clients");
    },
    onError: (_error) => {
      // Error will be displayed by form
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
    // Strip whitespace-only strings so we don't store "   " as a value.
    const trim = (v?: string) => {
      if (!v) return v;
      const trimmed = v.trim();
      return trimmed === "" ? undefined : trimmed;
    };
    const { isInternal, ...rest } = data;
    try {
      await createMutation.mutateAsync({
        ...rest,
        defaultBillable: !isInternal,
        email: trim(data.email),
        phone: trim(data.phone),
        company: trim(data.company),
        address: trim(data.address),
        city: trim(data.city),
        postalCode: trim(data.postalCode),
        country: trim(data.country),
        cvrNumber: normalizeClientTaxId(data.country, data.cvrNumber),
        notes: trim(data.notes),
        color: data.color || undefined,
      });
    } catch {
      // Fejlen vises af mutationens onError.
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/clients"
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("form.backToClients")}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
          {t("form.newTitle")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("form.newDescription")}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Company Search (CVR, kun danske kunder) */}
        {isDanish && (
          <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-6">
            <div className="flex items-start gap-4">
              <Building2 className="h-6 w-6 shrink-0 text-brand-600 dark:text-brand-400" />
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {t("form.searchTitle")}
                </h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t("form.searchHint")}
                </p>
                <div className="mt-4 flex gap-2">
                  <Input
                    type="text"
                    value={cvrNumber}
                    onChange={(e) => {
                      setCvrNumber(e.target.value);
                      setCvrError("");
                    }}
                    placeholder={t("form.searchPlaceholder")}
                  />
                  <Button
                    type="button"
                    onClick={handleCVRLookup}
                    disabled={cvrLookupMutation.isPending || !cvrNumber}
                    isLoading={cvrLookupMutation.isPending}
                    leftIcon={
                      !cvrLookupMutation.isPending ? (
                        <Search className="h-4 w-4" />
                      ) : undefined
                    }
                  >
                    {cvrLookupMutation.isPending
                      ? t("form.searching")
                      : t("form.searchButton")}
                  </Button>
                </div>
                {cvrError && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                    {cvrError}
                  </p>
                )}
                {cvrLookupMutation.data && !cvrError && (
                  <p className="mt-2 text-sm text-green-600 dark:text-green-400">
                    {t("form.found", {
                      name: cvrLookupMutation.data.name,
                      cvr: cvrLookupMutation.data.cvrNumber,
                    })}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Client Form */}
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="mb-6 text-sm font-semibold text-gray-900 dark:text-white">
            {t("form.sectionTitle")}
          </h2>

          <div className="space-y-4">
            <Input
              label={`${t("form.name")} *`}
              {...register("name")}
              placeholder={t("form.namePlaceholder")}
              error={errors.name?.message}
            />

            <Input
              label={t("form.email")}
              type="email"
              {...register("email")}
              placeholder={t("form.emailPlaceholder")}
              error={errors.email?.message}
            />

            <Input
              label={t("form.phone")}
              type="tel"
              {...register("phone")}
              placeholder="+45 12 34 56 78"
            />

            <Input
              label={t("form.company")}
              {...register("company")}
              placeholder={t("form.companyPlaceholder")}
            />

            <Input
              label={t("form.address")}
              {...register("address")}
              placeholder={t("form.addressPlaceholder")}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("form.postalCode")}
                {...register("postalCode")}
                placeholder="1000"
              />

              <Input
                label={t("form.city")}
                {...register("city")}
                placeholder={t("form.cityPlaceholder")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("form.country")}
                {...register("country")}
                placeholder={t("form.countryPlaceholder")}
              />

              <Input
                label={isDanish ? t("form.cvr") : t("form.vatNumber")}
                {...register("cvrNumber")}
                placeholder={isDanish ? "12345678" : "DE123456789"}
                maxLength={isDanish ? 8 : 20}
                error={errors.cvrNumber?.message}
              />
            </div>

            <Input
              label={t("form.hourlyRate")}
              type="number"
              {...register("defaultHourlyRate")}
              placeholder="750"
              hint={t("form.hourlyRateHint")}
            />

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
                {t("form.internalHintNew")}
              </p>
            </div>

            {/* Client Color */}
            <div>
              <label
                htmlFor="color"
                className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
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
                    className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {t("form.colorReset")}
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("form.colorHintNew")}
              </p>
            </div>

            <Textarea
              label={t("form.notes")}
              {...register("notes")}
              rows={4}
              placeholder={t("form.notesPlaceholder")}
            />
          </div>

          {createMutation.error && (
            <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-400">
              {createMutation.error.message}
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
            <Link
              href="/dashboard/clients"
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
              {isSubmitting ? t("form.savingShort") : t("form.saveClient")}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
