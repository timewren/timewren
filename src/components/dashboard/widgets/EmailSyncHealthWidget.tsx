"use client";

import { Mail, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function EmailSyncHealthWidget() {
  const t = useTranslations("dashboard.widgets.emailSync");
  const { data, isLoading } = trpc.emailAnalytics.getSyncOverview.useQuery();
  const triggerSync = trpc.emailIntegration.triggerSync.useMutation({
    onSuccess: () => toast.success(t("started")),
    onError: () => toast.error(t("startFailed")),
  });

  if (isLoading || !data) return null;

  const getStatusColor = () => {
    if (data.consecutiveSyncFailures >= 5) return "red";
    if (data.consecutiveSyncFailures >= 2) return "yellow";
    if (data.lastSyncStatus === "success") return "green";
    if (data.lastSyncStatus === "error") return "red";
    return "gray";
  };

  const color = getStatusColor();
  const dotColors = {
    green: "bg-green-500",
    yellow: "bg-yellow-500",
    red: "bg-red-500",
    gray: "bg-gray-400",
  };

  const formatTime = (date: Date | string | null) => {
    if (!date) return t("never");
    const d = new Date(date);
    const now = new Date();
    const diffMin = Math.round((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return t("now");
    if (diffMin < 60) return t("minutes", { value: diffMin });
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return t("hours", { value: diffHours });
    return t("days", { value: Math.round(diffHours / 24) });
  };

  return (
    <DashboardWidget
      title={t("title")}
      icon={<Mail className="h-4 w-4 text-tt-graa" />}
      actions={
        <button
          type="button"
          onClick={() => triggerSync.mutate()}
          disabled={triggerSync.isPending}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300"
          title={t("startNow")}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${triggerSync.isPending ? "animate-spin" : ""}`}
          />
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${dotColors[color]}`} />
          <span className="text-sm text-gray-600 dark:text-gray-300">
            {color === "green"
              ? t("statusOk")
              : color === "yellow"
                ? t("statusUnstable")
                : color === "red"
                  ? t("statusError")
                  : "–"}
          </span>
          <span className="text-xs text-gray-400">
            {formatTime(data.lastSyncedAt)}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {data.todayEmails}
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              {t("emails")}
            </p>
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {data.todayTasks}
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              {t("tasks")}
            </p>
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {data.todayHighPriority}
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              {t("clients")}
            </p>
          </div>
        </div>

        <Link
          href="/dashboard/settings/email?tab=analytik"
          className="block text-center text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {t("analytics")}
        </Link>
      </div>
    </DashboardWidget>
  );
}
