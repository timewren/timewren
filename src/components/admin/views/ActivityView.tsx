"use client";

import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  User,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { RefreshIndicator } from "@/components/admin";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

const REFRESH_INTERVAL = 60_000;

const ACTION_KEYS = [
  "view_system_stats",
  "list_users",
  "view_user_for_support",
  "view_user_admin_profile",
  "view_user_security",
  "view_user_integrations",
  "view_user_clients",
  "view_user_projects",
  "view_user_time_entries",
  "view_user_invoices",
  "view_user_email",
  "view_activity_log",
  "resend_verification",
  "request_password_reset",
  "manual_verify_email",
  "add_user_note",
  "delete_user_note",
  "flag_user",
  "unflag_user",
  "export_user_data",
  "delete_user",
  "bulk_delete_users",
  "bulk_flag_users",
  "ban_email_domain",
  "unban_email_domain",
  "change_user_role",
  "view_user_timeline",
  "view_cron_logs",
  "view_email_stats",
  "view_active_sessions",
  "view_user_growth",
  "view_feature_usage",
  "view_revenue_trends",
  "toggle_feature_flag",
  "view_feature_flags",
  "send_broadcast",
  "create_roadmap_item",
  "update_roadmap_item",
  "create_changelog",
  "delete_changelog",
  "update_notification_settings",
];

function IpUserAgentDisplay({
  ipAddress,
  userAgent,
}: {
  ipAddress: unknown;
  userAgent: unknown;
}) {
  const t = useTranslations("adminActivity");
  const ip = typeof ipAddress === "string" ? ipAddress : "";
  const ua = typeof userAgent === "string" ? userAgent : "";
  if (!ip && !ua) return null;
  return (
    <div className="mt-2 font-mono text-xs text-gray-400">
      {ip && (
        <span>
          {t("ip")} {ip}
        </span>
      )}
      {ip && ua && <span className="mx-2">|</span>}
      {ua && (
        <span className="inline-block max-w-md truncate align-bottom">
          {ua.slice(0, 60)}
          {ua.length > 60 && "…"}
        </span>
      )}
    </div>
  );
}

export function ActivityView() {
  const t = useTranslations("adminActivity");
  const locale = useLocale();
  const actionLabel = (action: string) =>
    t.has(`actions.${action}`) ? t(`actions.${action}`) : action;
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState<string>("");
  const limit = 30;

  const utils = trpc.useUtils();

  const { data, isLoading, dataUpdatedAt } = trpc.admin.getActivityLog.useQuery(
    {
      limit,
      offset: page * limit,
      action: actionFilter || undefined,
    },
    { refetchInterval: REFRESH_INTERVAL },
  );

  const handleRefresh = () => {
    utils.admin.getActivityLog.invalidate();
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const uniqueActions = ACTION_KEYS;

  return (
    <div className="space-y-6">
      {/* Header controls — refresh + stats */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {t("totalLogged", { count: data?.total ?? 0 })}
        </p>
        <RefreshIndicator
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : undefined}
          onRefresh={handleRefresh}
          intervalMs={REFRESH_INTERVAL}
        />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(0);
            }}
            className="appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-8 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">{t("allActions")}</option>
            {uniqueActions.map((action) => (
              <option key={action} value={action}>
                {actionLabel(action)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Activity log */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="divide-y divide-gray-100">
          {isLoading ? (
            Array.from({ length: 5 }, (_, i) => `sk-${i}`).map((k) => (
              <div key={k} className="p-4">
                <div className="h-16 animate-pulse rounded bg-gray-100" />
              </div>
            ))
          ) : data?.logs.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <Activity className="mx-auto mb-3 h-10 w-10 opacity-50" />
              <p className="text-sm">{t("empty")}</p>
            </div>
          ) : (
            data?.logs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start gap-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <Activity className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">
                      {actionLabel(log.action)}
                    </p>

                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                      <div className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        <span>
                          {t("admin")}{" "}
                          <span className="text-gray-700">
                            {log.admin?.name || t("unknown")}
                          </span>
                        </span>
                      </div>

                      {log.targetUser && log.targetUserId && (
                        <div className="flex items-center gap-1">
                          <span>
                            {t("target")}{" "}
                            <Link
                              href={`/admin/users/${log.targetUserId}`}
                              className="text-brand-600 hover:underline"
                            >
                              {log.targetUser.name ?? t("unknown")}
                            </Link>
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        <span>
                          {new Date(log.createdAt).toLocaleString(
                            toIntlLocale(locale),
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </span>
                      </div>
                    </div>

                    <IpUserAgentDisplay
                      ipAddress={log.ipAddress}
                      userAgent={log.userAgent}
                    />

                    {typeof log.details === "object" &&
                    log.details !== null &&
                    Object.keys(log.details as Record<string, unknown>).length >
                      0 ? (
                      <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2 font-mono text-xs text-gray-600">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm text-gray-600">
              {t("pageOf", { page: page + 1, total: totalPages })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                {t("previous")}
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("next")}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
