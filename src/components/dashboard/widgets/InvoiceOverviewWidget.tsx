"use client";

import {
  AlertCircle,
  CheckCircle2,
  FileEdit,
  Receipt,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { formatCurrency } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function InvoiceOverviewWidget() {
  const t = useTranslations("dashboard.widgets.invoiceOverview");
  const { data, isLoading } = trpc.invoices.getStats.useQuery();

  if (isLoading || !data) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<Receipt className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  const totalInvoiced = parseFloat(data.totalInvoiced);
  const totalPaid = parseFloat(data.totalPaid);
  const hasOverdue = data.overdue > 0;

  const statusCards = [
    {
      label: t("draft"),
      count: data.draft,
      icon: FileEdit,
      color: "text-gray-500 dark:text-gray-400",
      bg: "bg-gray-50 dark:bg-gray-800/50",
      border: "border-gray-200 dark:border-gray-600",
    },
    {
      label: t("sent"),
      count: data.sent,
      icon: Send,
      color: "text-tt-graa",
      bg: "bg-tt-flade",
      border: "border-blue-200 dark:border-blue-800",
    },
    {
      label: t("paid"),
      count: data.paid,
      icon: CheckCircle2,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-50 dark:bg-green-900/20",
      border: "border-green-200 dark:border-green-800",
      amount: totalPaid,
    },
    {
      label: t("overdue"),
      count: data.overdue,
      icon: AlertCircle,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-900/20",
      border: "border-red-200 dark:border-red-800",
      amount: parseFloat(data.totalPending),
    },
  ];

  return (
    <DashboardWidget
      title={t("title")}
      icon={<Receipt className="h-5 w-5 text-tt-graa" />}
      variant={hasOverdue ? "danger" : "default"}
      actions={
        <Link
          href="/dashboard/invoices"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("seeInvoices")}
        </Link>
      }
    >
      <div className="flex flex-col h-full">
        {/* Total invoiced */}
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2 mb-3 text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("totalInvoiced")}
          </p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {formatCurrency(totalInvoiced)}
          </p>
        </div>

        {/* 2×2 grid */}
        <div className="grid grid-cols-2 gap-2 flex-1">
          {statusCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className={`rounded-lg border ${card.border} ${card.bg} p-2 flex flex-col items-center justify-center text-center`}
              >
                <Icon className={`h-4 w-4 ${card.color} mb-1`} />
                <p className={`text-lg font-bold ${card.color}`}>
                  {card.count}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {card.label}
                </p>
                {card.amount !== undefined && card.amount > 0 && (
                  <p className={`text-xs font-medium ${card.color} mt-0.5`}>
                    {formatCurrency(card.amount)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </DashboardWidget>
  );
}
