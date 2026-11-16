"use client";

import { AlertTriangle, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency, formatTimeHuman } from "@/lib/format";
import type { InvoicePreviewPeriod } from "@/lib/invoicing/invoice-preview";
import { trpc } from "@/providers/trpc-provider";

export type InvoiceNowOrigin =
  | "invoice_nudge"
  | "client_page"
  | "dashboard"
  | "invoices_page";

const PERIODS: {
  value: InvoicePreviewPeriod;
  labelKey: "periodAll" | "periodThisMonth" | "periodLastMonth";
}[] = [
  { value: "all", labelKey: "periodAll" },
  { value: "this_month", labelKey: "periodThisMonth" },
  { value: "last_month", labelKey: "periodLastMonth" },
];

/** "yyyy-MM-dd" → "3. sep. 2026" uden at browserens tidszone flytter datoen. */
function formatDay(dateStr: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

/**
 * "Fakturér nu" (#89): én kunde, én knap. Viser periodens ufakturerede tid
 * grupperet pr. projekt og laver en fakturakladde via den eksisterende
 * invoices.generateFromTimeEntries. Intet sendes til kunden herfra.
 */
export function InvoiceNowDialog({
  clientId,
  clientName,
  isOpen,
  onClose,
  origin,
}: {
  clientId: string;
  clientName?: string;
  isOpen: boolean;
  onClose: () => void;
  origin: InvoiceNowOrigin;
}) {
  const router = useRouter();
  const t = useTranslations("billing.adoption.invoiceNow");
  const intlLocale = toIntlLocale(useLocale());
  const [period, setPeriod] = useState<InvoicePreviewPeriod>("all");

  const {
    data: preview,
    isLoading,
    isError,
  } = trpc.invoices.previewFromTimeEntries.useQuery(
    { clientId, period },
    { enabled: isOpen, refetchOnMount: "always" },
  );

  const generate = trpc.invoices.generateFromTimeEntries.useMutation({
    onSuccess: (result) => {
      toast.success(
        t("draftCreated", { amount: formatCurrency(result.totalAmount) }),
      );
      onClose();
      router.push(`/dashboard/invoices/${result.invoice.id}`);
    },
    onError: (error) => {
      toast.error(error.message || t("createFailed"));
    },
  });

  const name = preview?.clientName ?? clientName ?? t("clientFallback");
  const hasEntries = !!preview && preview.entryCount > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={t("title", { name })}
      description={t("description")}
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="sr-only">{t("period")}</legend>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
            {PERIODS.map((p) => (
              <label
                key={p.value}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${
                  period === p.value
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                }`}
              >
                <input
                  type="radio"
                  name="invoice-now-period"
                  value={p.value}
                  checked={period === p.value}
                  onChange={() => setPeriod(p.value)}
                  className="sr-only"
                />
                {t(p.labelKey)}
              </label>
            ))}
          </div>
        </fieldset>

        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            {t("loadError")}
          </p>
        ) : !hasEntries ? (
          <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
            {t("noUnbilled", { name })}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-800/60">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("entries")}
                </p>
                <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">
                  {preview.entryCount}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("time")}
                </p>
                <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">
                  {formatTimeHuman(preview.totalHours)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("amountExVat")}
                </p>
                <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">
                  {formatCurrency(preview.totalAmount)}
                </p>
              </div>
              {preview.firstDate && preview.lastDate && (
                <p className="col-span-3 text-xs text-gray-500 dark:text-gray-400">
                  {preview.firstDate === preview.lastDate
                    ? formatDay(preview.firstDate, intlLocale)
                    : `${formatDay(preview.firstDate, intlLocale)}–${formatDay(preview.lastDate, intlLocale)}`}
                </p>
              )}
            </div>

            <table className="w-full text-sm">
              <caption className="sr-only">{t("timePerProject")}</caption>
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                  <th scope="col" className="pb-1 font-medium">
                    {t("project")}
                  </th>
                  <th scope="col" className="pb-1 text-right font-medium">
                    {t("time")}
                  </th>
                  <th scope="col" className="pb-1 text-right font-medium">
                    {t("amount")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {preview.groups.map((g) => (
                  <tr key={g.key}>
                    <td className="py-2 pr-2 text-gray-900 dark:text-gray-100">
                      <span className="block truncate">{g.label}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {t("entryCount", { count: g.entryCount })}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {formatTimeHuman(g.hours)}
                    </td>
                    <td className="py-2 pl-2 text-right tabular-nums text-gray-900 dark:text-gray-100">
                      {formatCurrency(g.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {preview.hoursWithoutRate > 0 && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                {t("noRate", {
                  time: formatTimeHuman(preview.hoursWithoutRate),
                })}
              </p>
            )}

            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("footnote")}
            </p>
          </>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
          <Link
            href={`/dashboard/invoices/new?clientId=${clientId}`}
            className="text-sm text-gray-600 underline-offset-2 hover:underline dark:text-gray-400"
          >
            {t("pickEntries")}
          </Link>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              leftIcon={<FileText className="h-4 w-4" />}
              disabled={!hasEntries || generate.isPending}
              isLoading={generate.isPending}
              onClick={() => {
                if (!preview) return;
                generate.mutate({
                  clientId,
                  timeEntryIds: preview.entryIds,
                  origin,
                });
              }}
            >
              {hasEntries
                ? t("createDraftAmount", {
                    amount: formatCurrency(preview.totalAmount),
                  })
                : t("createDraft")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
