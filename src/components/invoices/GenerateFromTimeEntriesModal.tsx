"use client";

import {
  AlertCircle,
  Building2,
  Check,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { toIntlLocale } from "@/i18n/format-locale";
import { dkkCurrencyFormatter } from "@/lib/format";
import { formatInvoiceNumber } from "@/lib/invoices/draft-number";
import { trpc } from "@/providers/trpc-provider";
import {
  CompanyProfileRequired,
  isCompanyProfileRequiredError,
} from "./CompanyProfileRequired";

interface GenerateFromTimeEntriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Organisationen har ingen fakturaer og ingen virksomhedsprofil. Den første
   * faktura kræver profilen, så modalen viser vejen dertil i stedet for
   * kundelisten (samme link som den tomme fakturaliste).
   */
  missingCompanyProfile?: boolean;
}

export function GenerateFromTimeEntriesModal({
  isOpen,
  onClose,
  missingCompanyProfile = false,
}: GenerateFromTimeEntriesModalProps) {
  const fid = useId();
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  // "2,5 timer" på dansk, ikke "2.5".
  const displayHours = (hours: number) =>
    hours.toLocaleString(toIntlLocale(locale), { maximumFractionDigits: 1 });
  const router = useRouter();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [profileRejected, setProfileRejected] = useState(false);

  const { data: uninvoicedSummary, isLoading } =
    trpc.invoices.getUninvoicedSummary.useQuery();

  const generateMutation = trpc.invoices.generateFromTimeEntries.useMutation({
    onSuccess: (result) => {
      toast.success(
        t("generate.created", {
          number: formatInvoiceNumber(
            result.invoice.invoiceNumber,
            t("status.draft"),
          ),
          amount: formatCurrency(result.totalAmount),
        }),
      );
      onClose();
      router.push(`/dashboard/invoices/${result.invoice.id}`);
    },
    onError: (error) => {
      // Sidens profilopslag kan stadig være undervejs (fx ?fraTid=1 på et
      // langsomt net); så vises vejen til oplysningerne, ikke en fejl-toast.
      if (isCompanyProfileRequiredError(error)) {
        setProfileRejected(true);
        return;
      }
      toast.error(error.message || t("generate.createFailed"));
    },
  });

  const selectedClient = uninvoicedSummary?.find(
    (s) => s.client.id === selectedClientId,
  );

  const handleGenerate = () => {
    if (!selectedClient) return;

    generateMutation.mutate({
      clientId: selectedClient.client.id,
      timeEntryIds: selectedClient.entryIds,
      notes: notes || undefined,
      dueDate: dueDate || undefined,
      requireCompanyProfile: true,
    });
  };

  const formatCurrency = (amount: number) =>
    dkkCurrencyFormatter.format(amount);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-brand-500 dark:text-brand-400" />
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t("generate.title")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("generate.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-180px)] overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-brand-500 dark:text-brand-400" />
            </div>
          ) : !uninvoicedSummary || uninvoicedSummary.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 rounded-full bg-gray-100 p-4 dark:bg-gray-700">
                <Clock className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {t("generate.noUnbilled")}
              </h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {t("generate.noUnbilledHint")}
              </p>
            </div>
          ) : missingCompanyProfile || profileRejected ? (
            <CompanyProfileRequired />
          ) : !selectedClientId ? (
            // Client selection
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("generate.chooseClient")}
              </p>
              <div className="space-y-3">
                {uninvoicedSummary.map((summary) => (
                  <button
                    key={summary.client.id}
                    type="button"
                    onClick={() => setSelectedClientId(summary.client.id)}
                    className="w-full rounded-lg border border-gray-200 p-4 text-left transition-all hover:border-brand-300 hover:bg-brand-50 dark:border-gray-700 dark:hover:border-brand-600 dark:hover:bg-tt-gran-lys"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="rounded-full bg-brand-100 p-2 dark:bg-tt-gran-lys">
                          <Building2 className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                            {summary.client.name}
                          </h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {t("generate.entriesHours", {
                              entries: summary.entryCount,
                              hours: displayHours(summary.totalHours),
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {formatCurrency(summary.totalAmount)}
                        </p>
                        <ChevronRight className="ml-auto h-5 w-5 text-gray-400" />
                      </div>
                    </div>

                    {/* Project breakdown */}
                    {summary.projects.length > 0 && (
                      <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
                        <p className="mb-2 text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                          {t("generate.projects")}
                        </p>
                        <div className="space-y-1">
                          {summary.projects.slice(0, 3).map((project) => (
                            <div
                              key={project.id}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="text-gray-600 dark:text-gray-300">
                                {project.name}
                              </span>
                              <span className="text-gray-500 dark:text-gray-400">
                                {t("generate.projectHours", {
                                  hours: displayHours(project.hours),
                                  amount: formatCurrency(project.amount),
                                })}
                              </span>
                            </div>
                          ))}
                          {summary.projects.length > 3 && (
                            <p className="text-xs text-gray-400">
                              {t("generate.moreProjects", {
                                count: summary.projects.length - 3,
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // Confirmation step
            <div className="space-y-6">
              {/* Back button */}
              <button
                type="button"
                onClick={() => setSelectedClientId(null)}
                className="text-sm text-brand-600 hover:underline dark:text-brand-400"
              >
                {t("generate.chooseOther")}
              </button>

              {/* Summary */}
              <div className="rounded-lg bg-brand-50 p-4 dark:bg-tt-gran-lys">
                <h4 className="font-medium text-brand-900 dark:text-brand-100">
                  {selectedClient?.client.name}
                </h4>
                <div className="mt-2 grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-brand-700 dark:text-brand-300">
                      {t("generate.entries")}
                    </p>
                    <p className="text-lg font-semibold text-brand-900 dark:text-brand-100">
                      {selectedClient?.entryCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-brand-700 dark:text-brand-300">
                      {t("generate.hours")}
                    </p>
                    <p className="text-lg font-semibold text-brand-900 dark:text-brand-100">
                      {displayHours(selectedClient?.totalHours ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-brand-700 dark:text-brand-300">
                      {t("generate.amount")}
                    </p>
                    <p className="text-lg font-semibold text-brand-900 dark:text-brand-100">
                      {formatCurrency(selectedClient?.totalAmount || 0)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Optional fields */}
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor={`${fid}-f1`}
                    className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("generate.dueDate")}
                  </label>
                  <input
                    id={`${fid}-f1`}
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${fid}-f2`}
                    className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("generate.notes")}
                  </label>
                  <textarea
                    id={`${fid}-f2`}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder={t("generate.notesPlaceholder")}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  />
                </div>
              </div>

              {/* Info about what happens */}
              <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
                <AlertCircle className="h-5 w-5 text-gray-400" />
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  <p>{t("generate.info")}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button variant="ghost" onClick={onClose}>
            {tc("cancel")}
          </Button>

          {selectedClientId && selectedClient && (
            <Button
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              leftIcon={
                generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )
              }
            >
              {generateMutation.isPending
                ? t("generate.creating")
                : t("generate.generate", {
                    amount: formatCurrency(selectedClient.totalAmount),
                  })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
