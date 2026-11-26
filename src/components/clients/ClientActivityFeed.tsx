"use client";

import { Activity, CheckCircle, Clock, FileText, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency } from "@/lib/format";
import { formatInvoiceNumber } from "@/lib/invoices/draft-number";
import { trpc } from "@/providers/trpc-provider";

interface TimeEntry {
  id: string;
  date: Date | string;
  description: string | null;
  hours: string;
  billableRate: string | null;
  isBillable: boolean | null;
  isBilled: boolean | null;
  isPrepaid: boolean | null;
  project?: {
    id: string;
    name: string;
  } | null;
}

interface ClientActivityFeedProps {
  clientId: string;
  timeEntries: TimeEntry[];
}

interface ActivityItem {
  id: string;
  type: "time" | "invoice_created" | "invoice_sent" | "invoice_paid";
  date: Date;
  title: string;
  subtitle?: string;
  value?: number;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}

export function ClientActivityFeed({
  clientId,
  timeEntries,
}: ClientActivityFeedProps) {
  const t = useTranslations("clients");
  const tInvoices = useTranslations("invoices");
  const locale = useLocale();
  const { data: invoices } = trpc.invoices.list.useQuery({
    clientId,
    limit: 50,
  });

  // Server scoper pr. klient (#186)
  const clientInvoices = invoices || [];

  // Combine time entries and invoice events into a single feed
  const activities = useMemo(() => {
    const items: ActivityItem[] = [];

    // Add recent time entries (last 10)
    const recentTimeEntries = [...timeEntries]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10);

    for (const entry of recentTimeEntries) {
      const hours = parseFloat(entry.hours || "0");
      const rate = parseFloat(entry.billableRate || "0");
      const value = hours * rate;

      items.push({
        id: `time-${entry.id}`,
        type: "time",
        date: new Date(entry.date),
        title: entry.description || t("activityFeed.timeEntryFallback"),
        subtitle: entry.project?.name,
        value: entry.isBillable && !entry.isPrepaid ? value : undefined,
        icon: Clock,
        iconBg: entry.isPrepaid
          ? "bg-orange-100 dark:bg-orange-900/30"
          : "bg-brand-100 dark:bg-tt-gran-lys",
        iconColor: entry.isPrepaid
          ? "text-orange-600 dark:text-orange-400"
          : "text-brand-600 dark:text-brand-400",
      });
    }

    // Add invoice events
    for (const invoice of clientInvoices) {
      // Invoice created
      items.push({
        id: `invoice-created-${invoice.id}`,
        type: "invoice_created",
        date: new Date(invoice.createdAt),
        title: t("activityFeed.invoiceCreated", {
          number: formatInvoiceNumber(
            invoice.invoiceNumber,
            tInvoices("status.draft"),
          ),
        }),
        value: parseFloat(invoice.amount || "0"),
        icon: FileText,
        iconBg: "bg-purple-100 dark:bg-purple-900/30",
        iconColor: "text-purple-600 dark:text-purple-400",
      });

      // Invoice sent (if status is sent, paid, or overdue)
      if (invoice.status !== "draft" && invoice.issueDate) {
        items.push({
          id: `invoice-sent-${invoice.id}`,
          type: "invoice_sent",
          date: new Date(invoice.issueDate),
          title: t("activityFeed.invoiceSent", {
            number: invoice.invoiceNumber,
          }),
          value: parseFloat(invoice.amount || "0"),
          icon: Send,
          iconBg: "bg-indigo-100 dark:bg-indigo-900/30",
          iconColor: "text-indigo-600 dark:text-indigo-400",
        });
      }

      // Invoice paid
      if (invoice.status === "paid" && invoice.paidDate) {
        items.push({
          id: `invoice-paid-${invoice.id}`,
          type: "invoice_paid",
          date: new Date(invoice.paidDate),
          title: t("activityFeed.invoicePaid", {
            number: invoice.invoiceNumber,
          }),
          value: parseFloat(invoice.amount || "0"),
          icon: CheckCircle,
          iconBg: "bg-green-100 dark:bg-green-900/30",
          iconColor: "text-green-600 dark:text-green-400",
        });
      }
    }

    // Sort by date (newest first) and take top 8
    return items
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 8);
  }, [timeEntries, clientInvoices, t, tInvoices]);

  const formatRelativeDate = (date: Date) => {
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return t("activityFeed.today");
    } else if (diffDays === 1) {
      return t("activityFeed.yesterday");
    } else if (diffDays < 7) {
      return t("activityFeed.daysAgo", { count: diffDays });
    } else {
      return date.toLocaleDateString(toIntlLocale(locale), {
        day: "numeric",
        month: "short",
      });
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("activityFeed.title")}
        </h3>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-900">
          <Activity className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("activityFeed.empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((activity, index) => {
            const Icon = activity.icon;

            return (
              <div key={activity.id} className="flex items-start gap-3">
                {/* Timeline connector */}
                <div className="relative flex flex-col items-center">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${activity.iconBg}`}
                  >
                    <Icon className={`h-4 w-4 ${activity.iconColor}`} />
                  </div>
                  {index < activities.length - 1 && (
                    <div className="w-px h-full bg-gray-200 dark:bg-gray-700 absolute top-8 left-1/2 -translate-x-1/2" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {activity.title}
                      </p>
                      {activity.subtitle && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {activity.subtitle}
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      {activity.value !== undefined && (
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {formatCurrency(activity.value)}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatRelativeDate(activity.date)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
