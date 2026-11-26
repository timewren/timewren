"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  FileText,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

const createInvoiceSchema = (t: (key: string) => string) =>
  z.object({
    clientId: z.string().min(1, t("new.pickClient")),
    amount: z.string().min(1, t("new.enterAmount")),
    issueDate: z.string().min(1, t("new.pickIssueDate")),
    dueDate: z.string().optional(),
    templateId: z.string().optional(),
    notes: z.string().optional(),
    status: z.enum(["draft", "sent"]),
  });

type InvoiceForm = z.infer<ReturnType<typeof createInvoiceSchema>>;

export default function NewInvoicePage() {
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const invoiceSchema = useMemo(() => createInvoiceSchema(t), [t]);
  const router = useRouter();
  // ?clientId=… fra kundesiden / "Fakturér nu"-dialogen forvælger kunden
  const initialClientId = useSearchParams().get("clientId") ?? "";
  const [selectedClientId, setSelectedClientId] = useState(initialClientId);
  const [selectedTimeEntries, setSelectedTimeEntries] = useState<Set<string>>(
    new Set(),
  );

  const utils = trpc.useUtils();
  const { data: clients } = trpc.clients.list.useQuery();
  const { data: templates } = trpc.invoiceTemplates.list.useQuery();
  const { data: nextInvoiceNumber } =
    trpc.invoices.getNextInvoiceNumber.useQuery();
  // Timer-first (#91): virksomhedsoplysninger kræves først ved første faktura
  const { data: companyProfile } = trpc.onboarding.getCompanyProfile.useQuery();
  const { data: activation } = trpc.onboarding.activationStatus.useQuery(
    undefined,
    { enabled: companyProfile === null },
  );
  const missingCompanyProfile =
    companyProfile === null && activation?.hasInvoice === false;
  const { data: timeEntries } = trpc.invoices.getUninvoicedTimeEntries.useQuery(
    { clientId: selectedClientId },
    { enabled: !!selectedClientId },
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<InvoiceForm>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      status: "draft",
      issueDate: toLocalDateStr(new Date()),
      clientId: initialClientId || undefined,
    },
  });

  const clientId = watch("clientId");

  useEffect(() => {
    if (clientId) {
      setSelectedClientId(clientId);
      // Reset selected entries when client changes
      setSelectedTimeEntries(new Set());
    }
  }, [clientId]);

  const createMutation = trpc.invoices.create.useMutation({
    onSuccess: (data) => {
      utils.invoices.invalidate();
      router.push(`/dashboard/invoices/${data.id}`);
    },
    onError: (error) => {
      toast.error(error.message || t("new.createFailed"));
    },
  });

  const onSubmit = async (data: InvoiceForm) => {
    try {
      await createMutation.mutateAsync({
        ...data,
        dueDate: data.dueDate || undefined,
        templateId: data.templateId || undefined,
        timeEntryIds: Array.from(selectedTimeEntries),
      });
    } catch {
      // Fejlen vises af mutationens onError.
    }
  };

  // Auto-calculate amount when selected entries change
  useEffect(() => {
    if (timeEntries && selectedTimeEntries.size > 0) {
      const selectedEntryList = timeEntries.filter((entry) =>
        selectedTimeEntries.has(entry.id),
      );
      const total = selectedEntryList.reduce((sum, entry) => {
        const hours = Number.parseFloat(entry.hours);
        const rate = Number.parseFloat(entry.billableRate || "0");
        return sum + hours * rate;
      }, 0);
      setValue("amount", total.toFixed(2));
    } else if (timeEntries && selectedTimeEntries.size === 0) {
      // If no entries selected, show total of all entries
      const total = timeEntries.reduce((sum, entry) => {
        const hours = Number.parseFloat(entry.hours);
        const rate = Number.parseFloat(entry.billableRate || "0");
        return sum + hours * rate;
      }, 0);
      setValue("amount", total.toFixed(2));
    }
  }, [selectedTimeEntries, timeEntries, setValue]);

  const handleSelectAll = () => {
    if (timeEntries) {
      setSelectedTimeEntries(new Set(timeEntries.map((e) => e.id)));
    }
  };

  const handleDeselectAll = () => {
    setSelectedTimeEntries(new Set());
  };

  const handleToggleEntry = (entryId: string) => {
    const newSelected = new Set(selectedTimeEntries);
    if (newSelected.has(entryId)) {
      newSelected.delete(entryId);
    } else {
      newSelected.add(entryId);
    }
    setSelectedTimeEntries(newSelected);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/invoices"
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("new.back")}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
          {t("new.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("new.description")}
        </p>
      </div>

      {missingCompanyProfile && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
        >
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {t("new.companyTitle")}
          </p>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            {t("new.companyBody")}
          </p>
          <Link
            href="/dashboard/settings/company?from=invoice"
            className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-tt-gran px-4 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            {t("new.companyCta")}
          </Link>
        </div>
      )}

      {/* Next Invoice Number */}
      {nextInvoiceNumber && (
        <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-4">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {t("new.nextNumber")}
              </p>
              <p className="text-lg font-bold tabular-nums text-brand-600 dark:text-brand-400">
                {nextInvoiceNumber}
              </p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Basic Information */}
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
            {t("new.about")}
          </h2>
          <div className="space-y-4">
            {/* Client Selection */}
            <div>
              <label
                htmlFor="clientId"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("new.client")}
              </label>
              <ClientSearchCombobox
                clients={clients}
                value={watch("clientId") || ""}
                onChange={(id) => setValue("clientId", id)}
                placeholder={t("new.selectClient")}
              />
              {errors.clientId && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {errors.clientId.message}
                </p>
              )}
            </div>

            {/* Amount */}
            <div>
              <label
                htmlFor="amount"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("new.amount")}
              </label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  id="amount"
                  step="0.01"
                  {...register("amount")}
                  className="block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 pl-10 pr-3 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder={t("new.amountPlaceholder")}
                />
              </div>
              {errors.amount && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {errors.amount.message}
                </p>
              )}
            </div>

            {/* Issue Date */}
            <div>
              <label
                htmlFor="issueDate"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("new.issueDate")}
              </label>
              <div className="relative mt-1">
                <Calendar className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  type="date"
                  id="issueDate"
                  {...register("issueDate")}
                  className="block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 pl-10 pr-3 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
              {errors.issueDate && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {errors.issueDate.message}
                </p>
              )}
            </div>

            {/* Due Date */}
            <div>
              <label
                htmlFor="dueDate"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("new.dueDate")}
              </label>
              <div className="relative mt-1">
                <Calendar className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  type="date"
                  id="dueDate"
                  {...register("dueDate")}
                  className="block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 pl-10 pr-3 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
              {errors.dueDate && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {errors.dueDate.message}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("new.dueDateHint")}
              </p>
            </div>

            {/* Template (#201) */}
            {templates && templates.length > 0 && (
              <div>
                <label
                  htmlFor="templateId"
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("new.template")}
                </label>
                <select
                  id="templateId"
                  {...register("templateId")}
                  className="mt-1 block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 px-3 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                >
                  <option value="">{t("new.defaultTemplate")}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                      {tpl.isDefault ? t("new.defaultSuffix") : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Status */}
            <div>
              <label
                htmlFor="status"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("new.status")}
              </label>
              <select
                id="status"
                {...register("status")}
                className="mt-1 block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              >
                <option value="draft">{t("new.statusDraft")}</option>
                <option value="sent">{t("list.markSent")}</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label
                htmlFor="notes"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("new.notes")}
              </label>
              <textarea
                id="notes"
                rows={4}
                {...register("notes")}
                className="mt-1 block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder={t("new.notesPlaceholder")}
              />
            </div>
          </div>
        </div>

        {/* Uninvoiced Time Entries */}
        {selectedClientId && timeEntries && timeEntries.length > 0 && (
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("new.uninvoicedTitle", { count: timeEntries.length })}
              </h2>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                >
                  {t("new.selectAll")}
                </button>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  {t("new.deselectAll")}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {timeEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selectedTimeEntries.has(entry.id)
                      ? "border-brand-300 dark:border-brand-700 bg-brand-50 dark:bg-tt-gran-lys"
                      : "border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedTimeEntries.has(entry.id)}
                    onChange={() => handleToggleEntry(entry.id)}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {entry.description || t("new.noDescription")}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t("new.entryMeta", {
                        date: new Date(entry.date).toLocaleDateString(
                          toIntlLocale(locale),
                        ),
                        hours: entry.hours,
                      })}
                      {entry.project &&
                        ` • ${(Array.isArray(entry.project) ? entry.project[0] : entry.project)?.name}`}
                    </p>
                  </div>
                  <div className="text-sm font-medium tabular-nums text-gray-900 dark:text-white">
                    {t("new.amountKr", {
                      amount: (
                        Number.parseFloat(entry.hours) *
                        Number.parseFloat(entry.billableRate || "0")
                      ).toFixed(2),
                    })}
                  </div>
                </div>
              ))}
              <div className="mt-4 flex items-center justify-between border-t border-gray-200 dark:border-gray-800 pt-4">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {selectedTimeEntries.size > 0
                    ? t("new.selectedOf", {
                        selected: selectedTimeEntries.size,
                        total: timeEntries.length,
                      })
                    : t("new.totalAmount")}
                </span>
                <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                  {t("new.amountKr", {
                    amount:
                      selectedTimeEntries.size > 0
                        ? timeEntries
                            .filter((entry) =>
                              selectedTimeEntries.has(entry.id),
                            )
                            .reduce((sum, entry) => {
                              const hours = Number.parseFloat(entry.hours);
                              const rate = Number.parseFloat(
                                entry.billableRate || "0",
                              );
                              return sum + hours * rate;
                            }, 0)
                            .toFixed(2)
                        : timeEntries
                            .reduce((sum, entry) => {
                              const hours = Number.parseFloat(entry.hours);
                              const rate = Number.parseFloat(
                                entry.billableRate || "0",
                              );
                              return sum + hours * rate;
                            }, 0)
                            .toFixed(2),
                  })}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Error display */}
        {createMutation.error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-400">
            {createMutation.error.message}
          </div>
        )}

        {/* Form Actions */}
        <div className="flex items-center justify-end gap-4">
          <Link
            href="/dashboard/invoices"
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {tc("cancel")}
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || missingCompanyProfile}
            className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {t("new.creating")}
              </>
            ) : (
              <>
                <FileText className="h-5 w-5" />
                {t("new.create")}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
