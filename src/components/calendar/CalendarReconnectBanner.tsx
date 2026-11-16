"use client";

import { AlertTriangle, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

export function CalendarReconnectBanner() {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const [dismissed, setDismissed] = useState(false);

  const { data: status } = trpc.calendar.getConnectionStatus.useQuery(
    undefined,
    { retry: false },
  );
  const { data: icloud } = trpc.calendar.icloudStatus.useQuery(undefined, {
    retry: false,
  });

  const retrySyncMutation = trpc.calendar.sync.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(t("reconnect.synced"));
      } else {
        toast.error(data.error || t("reconnect.syncFailed"));
      }
    },
    onError: (err) => toast.error(err.message),
  });

  if (dismissed) return null;

  // iCloud med afvist app-password vises altid — også når Google er primær
  const icloudFailure =
    icloud?.connected && icloud.needsReconnect ? icloud.error : null;
  const errorMessage =
    icloudFailure ?? (status?.connected ? status.error : null);

  // Don't show if not connected, no error, or dismissed
  if (!errorMessage) {
    return null;
  }

  const needsReauth =
    !!icloudFailure ||
    errorMessage.includes("Token expired") ||
    errorMessage.includes("reconnect") ||
    errorMessage.includes("refresh token");

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {needsReauth
              ? t("reconnect.disconnected")
              : t("reconnect.syncError")}
          </p>
          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300 truncate">
            {errorMessage}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {needsReauth ? (
              <Link
                href="/dashboard/settings/integrations"
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
              >
                {t("reconnect.reconnect")}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => retrySyncMutation.mutate()}
                disabled={retrySyncMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3 w-3 ${retrySyncMutation.isPending ? "animate-spin" : ""}`}
                />
                {t("reconnect.retry")}
              </button>
            )}
            <Link
              href="/dashboard/settings/integrations"
              className="text-xs text-amber-700 underline hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
            >
              {t("reconnect.settings")}
            </Link>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded p-1 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/50"
          aria-label={tc("close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
