"use client";

import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { ConfirmDialog } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

/** Starter OAuth-flowet på serveren (signeret state + PKCE i HttpOnly-cookies). */
const OUTLOOK_START_URL = "/api/integrations/outlook/start";

/**
 * Outlook-kalender via Microsoft Graph (read-only). Vises kun, når kontoens
 * brand har en Outlook-klient (`calendar.providers`).
 */
export function OutlookCalendarSection() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("calendar");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.calendar.outlookStatus.useQuery();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const connected = !!status?.connected;
  const needsReconnect = !!status?.needsReconnect;

  const invalidateAll = () => {
    utils.calendar.outlookStatus.invalidate();
    utils.calendar.getConnectionStatus.invalidate();
    utils.calendar.getEvents.invalidate();
    utils.calendar.getAutoTrackSuggestions.invalidate();
    utils.calendar.getAutoTrackSettings.invalidate();
  };

  const syncMutation = trpc.calendar.sync.useMutation({
    onSuccess: (data) => {
      invalidateAll();
      if (data.success) {
        toast.success(
          t("outlook.syncResult", {
            synced: data.synced ?? 0,
            updated: data.updated ?? 0,
          }),
        );
      } else {
        toast.error(data.error || t("outlook.syncFailed"));
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const disconnectMutation = trpc.calendar.outlookDisconnect.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast.success(t("outlook.disconnected"));
    },
    onError: (error) => toast.error(error.message),
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("outlook.loadingStatus")}
        </div>
      </div>
    );
  }

  return (
    <div
      id="outlook-kalender"
      className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-sky-600">
          <Calendar className="h-6 w-6 text-white" aria-hidden="true" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("outlook.title")}
            </h2>
            {connected && !needsReconnect && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                <Check className="h-3 w-3" aria-hidden="true" />
                {t("outlook.badgeConnected")}
              </span>
            )}
            {needsReconnect && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                {t("outlook.badgeReconnect")}
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {t("outlook.badgeReadOnly")}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t("outlook.intro", { brand: brand.name })}
          </p>
        </div>
      </div>

      {!connected ? (
        <div className="space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("outlook.readOnlyNote", { brand: brand.name })}
          </p>
          <a
            href={OUTLOOK_START_URL}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            {t("outlook.connect")}
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {needsReconnect ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
            >
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-800 dark:text-red-200">
                    {t("outlook.brokenConnection")}
                  </p>
                  <a
                    href={OUTLOOK_START_URL}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    {t("outlook.reconnect")}
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    {t("outlook.connectedAs", {
                      account: status?.accountEmail ?? "",
                    })}
                  </p>
                  {status?.lastSynced && (
                    <p className="mt-1 text-xs text-green-700 dark:text-green-300">
                      {t("outlook.lastSynced", {
                        time: new Date(status.lastSynced).toLocaleString(
                          toIntlLocale(locale),
                        ),
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!needsReconnect && status?.error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              {status.error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
            {!needsReconnect && (
              <button
                type="button"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {syncMutation.isPending
                  ? t("outlook.syncing")
                  : t("outlook.syncNow")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDisconnectConfirm(true)}
              disabled={disconnectMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <Link2Off className="h-4 w-4" aria-hidden="true" />
              {t("outlook.disconnect")}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDisconnectConfirm}
        onClose={() => setShowDisconnectConfirm(false)}
        onConfirm={() => {
          disconnectMutation.mutate();
          setShowDisconnectConfirm(false);
        }}
        title={t("outlook.disconnectTitle")}
        description={t("outlook.disconnectDescription", {
          brand: brand.name,
        })}
        confirmLabel={t("outlook.disconnectConfirm")}
        variant="danger"
        isLoading={disconnectMutation.isPending}
      />
    </div>
  );
}
