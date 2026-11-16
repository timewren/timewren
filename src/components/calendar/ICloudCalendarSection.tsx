"use client";

import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { ConfirmDialog } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

const APPLE_ID_URL = "https://appleid.apple.com/";

/**
 * iCloud-kalender (CalDAV, read-only) — #676.
 * Forbind med Apple-ID + app-specifikt password, vælg kalendere, synk.
 */
export function ICloudCalendarSection() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.calendar.icloudStatus.useQuery();

  const [showForm, setShowForm] = useState(false);
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const connected = !!status?.connected;
  const needsReconnect = !!status?.needsReconnect;

  const calendarsQuery = trpc.calendar.icloudListCalendars.useQuery(undefined, {
    enabled: connected && !needsReconnect,
    retry: false,
  });

  // Initialiser valg fra serveren (standard: ingen valgt)
  useEffect(() => {
    if (calendarsQuery.data && selected === null) {
      setSelected(
        new Set(
          calendarsQuery.data.filter((c) => c.selected).map((c) => c.url),
        ),
      );
    }
  }, [calendarsQuery.data, selected]);

  const invalidateAll = () => {
    utils.calendar.icloudStatus.invalidate();
    utils.calendar.icloudListCalendars.invalidate();
    utils.calendar.getConnectionStatus.invalidate();
    utils.calendar.getEvents.invalidate();
    utils.calendar.getAutoTrackSuggestions.invalidate();
    utils.calendar.getAutoTrackSettings.invalidate();
  };

  const connectMutation = trpc.calendar.icloudConnect.useMutation({
    onSuccess: () => {
      setAppPassword("");
      setFormError(null);
      setShowForm(false);
      setSelected(null);
      invalidateAll();
      toast.success(t("icloud.connected"));
    },
    onError: (error) => {
      setFormError(error.message);
    },
  });

  const selectMutation = trpc.calendar.icloudSelectCalendars.useMutation({
    onSuccess: (data) => {
      invalidateAll();
      if (data?.sync && !data.sync.success && data.sync.error) {
        toast.error(data.sync.error);
      } else {
        toast.success(
          data?.selectedCount
            ? t("icloud.selectedResult", {
                count: data.selectedCount,
                events: data.sync?.synced ?? 0,
              })
            : t("icloud.noneSelected", { brand: brand.name }),
        );
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const syncMutation = trpc.calendar.sync.useMutation({
    onSuccess: (data) => {
      invalidateAll();
      if (data.success) {
        toast.success(
          t("icloud.syncResult", {
            synced: data.synced ?? 0,
            updated: data.updated ?? 0,
          }),
        );
      } else {
        toast.error(data.error || t("icloud.syncFailed"));
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const disconnectMutation = trpc.calendar.icloudDisconnect.useMutation({
    onSuccess: () => {
      setSelected(null);
      invalidateAll();
      toast.success(t("icloud.disconnected"));
    },
    onError: (error) => toast.error(error.message),
  });

  const openForm = () => {
    setAppleId(status?.appleId ?? "");
    setAppPassword("");
    setFormError(null);
    setShowForm(true);
  };

  const handleConnect = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    connectMutation.mutate({ appleId, appPassword });
  };

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("icloud.loadingStatus")}
        </div>
      </div>
    );
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white";

  const form = (
    <form onSubmit={handleConnect} className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
        <p className="font-medium text-gray-900 dark:text-white">
          {t("icloud.howTo")}
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            {t.rich("icloud.step1", {
              link: (chunks) => (
                <a
                  href={APPLE_ID_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-brand-600 underline hover:text-brand-700 dark:text-brand-400"
                >
                  {chunks}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ),
            })}
          </li>
          <li>
            {t.rich("icloud.step2", {
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </li>
          <li>{t("icloud.step3", { brand: brand.name })}</li>
        </ol>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {t("icloud.why", { brand: brand.name })}
        </p>
      </div>

      <div>
        <label
          htmlFor="icloud-apple-id"
          className="block text-xs font-medium text-gray-700 dark:text-gray-300"
        >
          {t("icloud.appleId")}
        </label>
        <input
          id="icloud-apple-id"
          type="email"
          autoComplete="username"
          required
          value={appleId}
          onChange={(e) => setAppleId(e.target.value)}
          placeholder={t("icloud.appleIdPlaceholder")}
          className={inputClass}
        />
      </div>
      <div>
        <label
          htmlFor="icloud-app-password"
          className="block text-xs font-medium text-gray-700 dark:text-gray-300"
        >
          {t("icloud.appPassword")}
        </label>
        <input
          id="icloud-app-password"
          type="password"
          autoComplete="off"
          required
          value={appPassword}
          onChange={(e) => setAppPassword(e.target.value)}
          placeholder="xxxx-xxxx-xxxx-xxxx"
          className={`${inputClass} font-mono`}
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("icloud.storedEncrypted")}
        </p>
      </div>

      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {formError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={connectMutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          {connectMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
          {connectMutation.isPending
            ? t("icloud.checking")
            : t("icloud.connect")}
        </button>
        {connected && (
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {tc("cancel")}
          </button>
        )}
      </div>
    </form>
  );

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-900 dark:bg-gray-700">
          <Calendar className="h-6 w-6 text-white" aria-hidden="true" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("icloud.title")}
            </h2>
            {connected && !needsReconnect && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                <Check className="h-3 w-3" aria-hidden="true" />
                {t("icloud.badgeConnected")}
              </span>
            )}
            {needsReconnect && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                {t("icloud.badgeReconnect")}
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {t("icloud.badgeReadOnly")}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t("icloud.intro", { brand: brand.name })}
          </p>
        </div>
      </div>

      {!connected || showForm ? (
        form
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
                    {t("icloud.brokenConnection")}
                  </p>
                  <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                    {status?.error}
                  </p>
                  <button
                    type="button"
                    onClick={openForm}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    {t("icloud.reconnect")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    {t("icloud.connectedAs", {
                      appleId: status?.appleId ?? "",
                    })}
                  </p>
                  <p className="mt-1 text-xs text-green-700 dark:text-green-300">
                    {status?.selectedCount
                      ? t("icloud.calendarsRead", {
                          count: status.selectedCount,
                        })
                      : t("icloud.noCalendarsYet")}
                    {status?.lastSynced &&
                      ` · ${t("icloud.lastSynced", {
                        time: new Date(status.lastSynced).toLocaleString(
                          toIntlLocale(locale),
                        ),
                      })}`}
                  </p>
                </div>
              </div>
            </div>
          )}

          {!needsReconnect && status?.error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              {status.error}
            </div>
          )}

          {!needsReconnect && (
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {t("icloud.whichCalendars", { brand: brand.name })}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t("icloud.whichHint")}
              </p>
              <div className="mt-3 space-y-2">
                {calendarsQuery.isLoading ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("icloud.loadingCalendars")}
                  </div>
                ) : calendarsQuery.error ? (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {calendarsQuery.error.message}
                  </p>
                ) : calendarsQuery.data?.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("icloud.noCalendars")}
                  </p>
                ) : (
                  calendarsQuery.data?.map((cal) => (
                    <label
                      key={cal.url}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
                    >
                      <input
                        type="checkbox"
                        checked={selected?.has(cal.url) ?? false}
                        onChange={() => toggle(cal.url)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: cal.color || "#8e8e93" }}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {cal.displayName}
                      </span>
                    </label>
                  ))
                )}
              </div>
              {calendarsQuery.data && calendarsQuery.data.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    selectMutation.mutate({
                      calendarUrls: [...(selected ?? [])],
                    })
                  }
                  disabled={selectMutation.isPending || selected === null}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {selectMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {t("icloud.saveSelection")}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
            {!needsReconnect && (
              <button
                type="button"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending || !status?.selectedCount}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {syncMutation.isPending
                  ? t("icloud.syncing")
                  : t("icloud.syncNow")}
              </button>
            )}
            {!needsReconnect && (
              <button
                type="button"
                onClick={openForm}
                className="text-sm text-gray-600 underline hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {t("icloud.changePassword")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDisconnectConfirm(true)}
              disabled={disconnectMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <Link2Off className="h-4 w-4" aria-hidden="true" />
              {t("icloud.disconnect")}
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
        title={t("icloud.disconnectTitle")}
        description={t("icloud.disconnectDescription", { brand: brand.name })}
        confirmLabel={t("icloud.disconnectConfirm")}
        variant="danger"
        isLoading={disconnectMutation.isPending}
      />
    </div>
  );
}
