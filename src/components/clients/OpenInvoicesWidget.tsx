"use client";

import { AlertTriangle, Clock, ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import { formatInvoiceNumber } from "@/lib/invoices/draft-number";
import { trpc } from "@/providers/trpc-provider";

interface OpenInvoicesWidgetProps {
  clientId: string;
}

export function OpenInvoicesWidget({ clientId }: OpenInvoicesWidgetProps) {
  const t = useTranslations("clients");
  const tInvoices = useTranslations("invoices");
  const { data: invoices, isLoading } = trpc.invoices.list.useQuery({
    clientId,
    limit: 100,
  });

  // Only unpaid invoices (server scoper allerede pr. klient, #186)
  const clientInvoices = invoices?.filter((inv) => inv.status !== "paid") || [];

  // Sort by due date (overdue first, then by date)
  const sortedInvoices = [...clientInvoices].sort((a, b) => {
    // Overdue first
    if (a.status === "overdue" && b.status !== "overdue") return -1;
    if (b.status === "overdue" && a.status !== "overdue") return 1;
    // Then by due date
    const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return dateA - dateB;
  });

  // Calculate days until due or overdue
  const getDueDaysText = (invoice: (typeof clientInvoices)[0]) => {
    if (!invoice.dueDate) return null;

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dueDate = new Date(invoice.dueDate);
    dueDate.setHours(0, 0, 0, 0);

    const diffTime = dueDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        text: t("openInvoices.daysOverdue", { count: Math.abs(diffDays) }),
        isOverdue: true,
      };
    } else if (diffDays === 0) {
      return {
        text: t("openInvoices.dueToday"),
        isOverdue: false,
        isToday: true,
      };
    } else if (diffDays === 1) {
      return { text: t("openInvoices.dueTomorrow"), isOverdue: false };
    } else if (diffDays <= 7) {
      return {
        text: t("openInvoices.daysLeft", { count: diffDays }),
        isOverdue: false,
        isSoon: true,
      };
    } else {
      return {
        text: t("openInvoices.daysLeft", { count: diffDays }),
        isOverdue: false,
      };
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
          <div className="space-y-3">
            <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        </div>
      </div>
    );
  }

  const overdueCount = sortedInvoices.filter(
    (inv) => inv.status === "overdue",
  ).length;
  const totalAmount = sortedInvoices.reduce(
    (sum, inv) => sum + parseFloat(inv.amount || "0"),
    0,
  );

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("openInvoices.title")}
        </h3>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
          <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        </div>
      </div>

      {sortedInvoices.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("openInvoices.empty")}
          </p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">
                {sortedInvoices.length}
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {sortedInvoices.length === 1
                  ? t("openInvoices.countOne")
                  : t("openInvoices.countOther")}
              </span>
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  {t("openInvoices.overdueCount", { count: overdueCount })}
                </span>
              )}
            </div>
            <span className="text-lg font-semibold text-gray-900 dark:text-white">
              {formatCurrency(totalAmount)}
            </span>
          </div>

          {/* Invoice list */}
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {sortedInvoices.slice(0, 5).map((invoice) => {
              const dueInfo = getDueDaysText(invoice);
              const isOverdue =
                invoice.status === "overdue" || dueInfo?.isOverdue;

              return (
                <Link
                  key={invoice.id}
                  href={`/dashboard/invoices/${invoice.id}`}
                  className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                    isOverdue
                      ? "bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30"
                      : "bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        isOverdue
                          ? "bg-red-100 dark:bg-red-900/30"
                          : "bg-gray-200 dark:bg-gray-700"
                      }`}
                    >
                      {isOverdue ? (
                        <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                      ) : (
                        <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatInvoiceNumber(
                          invoice.invoiceNumber,
                          tInvoices("status.draft"),
                        )}
                      </p>
                      {dueInfo && (
                        <p
                          className={`text-xs ${
                            isOverdue
                              ? "text-red-600 dark:text-red-400"
                              : dueInfo.isToday || dueInfo.isSoon
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {dueInfo.text}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        isOverdue
                          ? "text-red-700 dark:text-red-400"
                          : "text-gray-900 dark:text-white"
                      }`}
                    >
                      {formatCurrency(parseFloat(invoice.amount || "0"))}
                    </span>
                    <ExternalLink className="h-4 w-4 text-gray-400" />
                  </div>
                </Link>
              );
            })}
          </div>

          {sortedInvoices.length > 5 && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 text-center">
              <Link
                href={`/dashboard/invoices?clientId=${clientId}`}
                className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
              >
                {t("openInvoices.viewAll", { count: sortedInvoices.length })}{" "}
                &rarr;
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
