"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Mail,
  MailOpen,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

const EMAIL_TYPES = [
  "invoice",
  "weekly_summary",
  "monthly_summary",
  "unbilled_reminder",
  "low_balance_alert",
  "expiry_warning",
  "inactivity",
  "first_client",
  "first_project",
  "first_time_entry",
  "first_invoice",
  "password_changed",
  "new_login",
  "organization_invite",
  "welcome",
  "test",
];

const STATUS_CONFIG: Record<string, { color: string; icon: typeof Mail }> = {
  sent: {
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    icon: Mail,
  },
  delivered: {
    color:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    icon: CheckCircle2,
  },
  opened: {
    color:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    icon: MailOpen,
  },
  bounced: {
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    icon: XCircle,
  },
  complained: {
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    icon: XCircle,
  },
  delivery_delayed: {
    color:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    icon: Clock,
  },
};

export function EmailActivityTab() {
  const t = useTranslations("settingsEmailActivity");
  const locale = useLocale();
  const typeLabel = (type: string) =>
    EMAIL_TYPES.includes(type) ? t(`types.${type}`) : type;
  const statusLabel = (status: string) =>
    status in STATUS_CONFIG ? t(`status.${status}`) : status;
  const [emailTypeFilter, setEmailTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 20;

  const { data: stats, isLoading: statsLoading } =
    trpc.emailActivity.getStats.useQuery();

  const { data: emailList, isLoading: listLoading } =
    trpc.emailActivity.list.useQuery({
      emailType: emailTypeFilter || undefined,
      status: statusFilter || undefined,
      limit,
      offset,
    });

  const { data: timeline } = trpc.emailActivity.getTimeline.useQuery(
    { resendEmailId: expandedId || "" },
    { enabled: !!expandedId },
  );

  const formatDate = (date: string | Date | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleString(toIntlLocale(locale), {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      {statsLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      ) : stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t("statSent")}
            value={stats.totalSent}
            icon={
              <Mail className="h-5 w-5 text-brand-500 dark:text-brand-400" />
            }
          />
          <StatCard
            label={t("statDelivered")}
            value={`${stats.deliveryRate}%`}
            icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
          />
          <StatCard
            label={t("statOpened")}
            value={`${stats.openRate}%`}
            icon={<MailOpen className="h-5 w-5 text-emerald-500" />}
          />
          <StatCard
            label={t("statBounced")}
            value={`${stats.bounceRate}%`}
            icon={<XCircle className="h-5 w-5 text-red-500" />}
          />
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={emailTypeFilter}
          onChange={(e) => {
            setEmailTypeFilter(e.target.value);
            setOffset(0);
          }}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm"
        >
          <option value="">{t("allTypes")}</option>
          {EMAIL_TYPES.map((value) => (
            <option key={value} value={value}>
              {typeLabel(value)}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setOffset(0);
          }}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm"
        >
          <option value="">{t("allStatuses")}</option>
          {Object.keys(STATUS_CONFIG).map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </select>
      </div>

      {/* Email List Table */}
      {listLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      ) : !emailList?.items.length ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-12 text-center">
          <Mail className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">{t("empty")}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  {t("colType")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  {t("colRecipient")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">
                  {t("colSubject")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  {t("colSent")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  {t("colStatus")}
                </th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {emailList.items.map((email) => {
                const status =
                  STATUS_CONFIG[email.latestStatus] || STATUS_CONFIG.sent;
                const isExpanded = expandedId === email.resendEmailId;

                return (
                  <tr key={email.id} className="group">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2.5 py-0.5 text-xs font-medium text-gray-800 dark:text-gray-300">
                        {typeLabel(email.emailType)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white truncate max-w-[180px]">
                      {email.recipientEmail}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 truncate max-w-[200px] hidden md:table-cell">
                      {email.subject || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(email.sentAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.color}`}
                      >
                        <status.icon className="h-3 w-3" />
                        {statusLabel(
                          email.latestStatus in STATUS_CONFIG
                            ? email.latestStatus
                            : "sent",
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {email.resendEmailId && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId(
                              isExpanded ? null : email.resendEmailId,
                            )
                          }
                          className="text-gray-400 hover:text-gray-600"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Expanded Timeline */}
          {expandedId && timeline && timeline.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-6 py-4">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-3">
                {t("timeline")}
              </p>
              <div className="space-y-2">
                {timeline.map((ev) => (
                  <div key={ev.id} className="flex items-center gap-3 text-sm">
                    <span className="text-gray-400 text-xs whitespace-nowrap">
                      {formatDate(ev.occurredAt)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        (STATUS_CONFIG[ev.eventType] || STATUS_CONFIG.sent)
                          .color
                      }`}
                    >
                      {statusLabel(ev.eventType)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pagination */}
          {emailList.total > limit && (
            <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 px-4 py-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("showing", {
                  from: offset + 1,
                  to: Math.min(offset + limit, emailList.total),
                  total: emailList.total,
                })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  {t("prev")}
                </button>
                <button
                  type="button"
                  onClick={() => setOffset(offset + limit)}
                  disabled={!emailList.hasMore}
                  className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  {t("next")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}
