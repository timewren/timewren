"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Shield,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/providers/trpc-provider";

type Translator = ReturnType<typeof useTranslations>;

const JOB_TYPE_KEYS: Record<string, string> = {
  incremental_sync: "jobIncremental",
  full_sync: "jobFull",
  backfill: "jobBackfill",
};

function formatJobType(jobType: string, t: Translator): string {
  return JOB_TYPE_KEYS[jobType] ? t(JOB_TYPE_KEYS[jobType]) : jobType;
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

function formatRelativeTime(date: Date, t: Translator, locale: string): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.round(diffMs / 1000);
  if (diffSecs < 60) return t("relNow");
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return t("relMinutes", { count: diffMins });
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return t("relHours", { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return t("relDays", { count: diffDays });
  return date.toLocaleDateString(toIntlLocale(locale));
}

export function EmailIntegrationTab() {
  const t = useTranslations("settingsEmailIntegration.imap");
  const locale = useLocale();
  const { data: session } = useSession();
  const utils = trpc.useUtils();

  const { data: userProfile } = trpc.user.getProfile.useQuery();
  const { data: syncHistory } = trpc.emailIntegration.getSyncHistory.useQuery(
    { limit: 10 },
    {
      refetchInterval: (query) =>
        query.state.data?.some((e) => e.status === "processing")
          ? 10_000
          : false,
    },
  );
  const isSyncRunning = syncHistory?.some(
    (entry) => entry.status === "processing",
  );
  const { data: integration, isLoading } =
    trpc.emailIntegration.getIntegration.useQuery(undefined, {
      refetchInterval: isSyncRunning ? 10_000 : false,
    });
  const { data: metrics } = trpc.emailMetrics.getOverview.useQuery();

  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapUsername, setImapUsername] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [imapUseSSL, setImapUseSSL] = useState(true);
  const [targetMailbox, setTargetMailbox] = useState("INBOX");
  const [syncFrequencyMinutes, setSyncFrequencyMinutes] = useState("15");
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [clientDomainsOnly, setClientDomainsOnly] = useState(false);
  const [senderWhitelist, setSenderWhitelist] = useState("");
  const [senderBlacklist, setSenderBlacklist] = useState("");
  const [subjectFilters, setSubjectFilters] = useState("");
  const [subjectFilterErrors, setSubjectFilterErrors] = useState<string[]>([]);

  const upsertMutation = trpc.emailIntegration.upsertIntegration.useMutation({
    onSuccess: () => {
      utils.emailIntegration.getIntegration.invalidate();
      toast.success(t("saved"));
    },
    onError: (error) => {
      toast.error(error.message || t("saveFailed"));
    },
  });

  const testMutation = trpc.emailIntegration.testConnection.useMutation({
    onSuccess: () => {
      toast.success(t("connectionOk"));
    },
    onError: (error) => {
      toast.error(error.message || t("connectFailed"));
    },
  });

  const triggerSyncMutation = trpc.emailIntegration.triggerSync.useMutation({
    onSuccess: () => {
      utils.emailIntegration.getSyncHistory.invalidate();
      toast.success(t("syncStarted"));
    },
    onError: (error) => {
      toast.error(error.message || t("syncStartFailed"));
    },
  });

  const backfillMutation = trpc.emailIntegration.triggerBackfill.useMutation({
    onSuccess: () => {
      utils.emailIntegration.getSyncHistory.invalidate();
      toast.success(t("backfillStarted"));
    },
    onError: (error) => {
      toast.error(error.message || t("backfillFailed"));
    },
  });

  const splitList = useCallback(
    (value: string) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    [],
  );

  const validateSubjectFilters = useCallback((filters: string[]) => {
    const errors: string[] = [];
    for (const pattern of filters) {
      try {
        new RegExp(pattern, "i");
      } catch {
        errors.push(pattern);
      }
    }
    setSubjectFilterErrors(errors);
    return errors.length === 0;
  }, []);

  const parsedWhitelist = useMemo(
    () => splitList(senderWhitelist),
    [senderWhitelist, splitList],
  );
  const parsedBlacklist = useMemo(
    () => splitList(senderBlacklist),
    [senderBlacklist, splitList],
  );
  const parsedSubjectFilters = useMemo(
    () => splitList(subjectFilters),
    [subjectFilters, splitList],
  );

  useEffect(() => {
    if (subjectFilters.trim().length === 0) {
      setSubjectFilterErrors([]);
      return;
    }
    validateSubjectFilters(parsedSubjectFilters);
  }, [subjectFilters, parsedSubjectFilters, validateSubjectFilters]);

  useEffect(() => {
    if (integration) {
      setImapHost(integration.imapHost || "");
      setImapPort(String(integration.imapPort || 993));
      setImapUsername(integration.imapUsername || "");
      setImapUseSSL(!!integration.imapUseSSL);
      setTargetMailbox(integration.targetMailbox || "INBOX");
      setSyncFrequencyMinutes(String(integration.syncFrequencyMinutes || 15));
      setSyncEnabled(!!integration.syncEnabled);
      setClientDomainsOnly(!!integration.clientDomainsOnly);
      setSenderWhitelist((integration.senderWhitelist || []).join(", "));
      setSenderBlacklist((integration.senderBlacklist || []).join(", "));
      setSubjectFilters((integration.subjectFilters || []).join(", "));
    }
  }, [integration]);

  const handleTestConnection = async () => {
    if (!imapPassword && !integration?.hasPassword) {
      toast.error(t("enterPassword"));
      return;
    }

    if (!validateSubjectFilters(parsedSubjectFilters)) {
      toast.error(t("fixFiltersTest"));
      return;
    }

    await testMutation.mutateAsync({
      imapHost,
      imapPort: Number(imapPort),
      imapUsername,
      imapPassword: imapPassword || undefined,
      imapUseSSL,
      targetMailbox,
      syncFrequencyMinutes: Number(syncFrequencyMinutes),
      syncEnabled,
      clientDomainsOnly,
      senderWhitelist: parsedWhitelist,
      senderBlacklist: parsedBlacklist,
      subjectFilters: parsedSubjectFilters,
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateSubjectFilters(parsedSubjectFilters)) {
      toast.error(t("fixFiltersSave"));
      return;
    }

    await upsertMutation.mutateAsync({
      imapHost,
      imapPort: Number(imapPort),
      imapUsername,
      imapPassword: imapPassword || undefined,
      imapUseSSL,
      targetMailbox,
      syncFrequencyMinutes: Number(syncFrequencyMinutes),
      syncEnabled,
      clientDomainsOnly,
      senderWhitelist: parsedWhitelist,
      senderBlacklist: parsedBlacklist,
      subjectFilters: parsedSubjectFilters,
    });
  };

  if (isLoading) {
    return <LoadingScreen message={t("loading")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Mail className="h-4 w-4" />
          <span>{t("breadcrumb")}</span>
        </div>
        <p className="text-gray-600 dark:text-gray-400">{t("intro")}</p>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <Shield className="h-4 w-4" /> {t("configTitle")}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("host")}
              <input
                className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                placeholder="imap.gmail.com"
                required
              />
            </label>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("port")}
              <input
                className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value)}
                type="number"
                min="1"
                max="65535"
                required
              />
            </label>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("username")}
              <input
                className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                value={imapUsername}
                onChange={(e) => setImapUsername(e.target.value)}
                type="email"
                placeholder={t("usernamePlaceholder")}
                required
              />
            </label>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("mailbox")}
              <input
                className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                value={targetMailbox}
                onChange={(e) => setTargetMailbox(e.target.value)}
                placeholder="INBOX"
                required
              />
            </label>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 md:col-span-2">
              {t("password")}
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
                <input
                  className="w-full text-sm outline-none bg-transparent text-gray-900 dark:text-white"
                  value={imapPassword}
                  onChange={(e) => setImapPassword(e.target.value)}
                  type={showPassword ? "text" : "password"}
                  placeholder={integration?.hasPassword ? "••••••••" : ""}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="text-gray-400"
                  aria-label={showPassword ? t("hide") : t("show")}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t("appPassword")}
              </p>
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={imapUseSSL}
                onChange={(e) => setImapUseSSL(e.target.checked)}
              />
              {t("useSsl")}
            </label>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <RefreshCw className="h-4 w-4" />
              {testMutation.isPending ? t("testing") : t("testConnection")}
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("syncStatus")}
            </div>
            <div className="mt-3 space-y-2">
              {isSyncRunning ? (
                <div className="flex items-center gap-2 text-sm text-brand-600 dark:text-brand-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t("syncing")}</span>
                </div>
              ) : integration?.lastSyncStatus === "success" ? (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    {t("lastSync", {
                      time: integration.lastSyncedAt
                        ? formatRelativeTime(
                            new Date(integration.lastSyncedAt),
                            t,
                            locale,
                          )
                        : t("unknown"),
                    })}
                  </span>
                </div>
              ) : integration?.lastSyncStatus === "error" ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <XCircle className="h-4 w-4" />
                    <span>
                      {(integration.consecutiveSyncFailures ?? 0) > 1
                        ? t("syncFailedRepeat", {
                            count: integration.consecutiveSyncFailures ?? 0,
                          })
                        : t("syncFailed")}
                    </span>
                  </div>
                  {integration.lastSyncError && (
                    <p className="ml-6 text-xs text-red-500 line-clamp-2">
                      {integration.lastSyncError}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("noSync")}
                </p>
              )}
              {integration?.syncDisabledUntil &&
                new Date(integration.syncDisabledUntil) > new Date() && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      {t("pausedUntil", {
                        date: new Date(
                          integration.syncDisabledUntil,
                        ).toLocaleString(toIntlLocale(locale)),
                      })}
                    </span>
                  </div>
                )}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("statsTitle")}
            </div>
            <div className="mt-3 grid gap-2 text-sm text-gray-600 dark:text-gray-400">
              <div>
                {t("processed", { count: metrics?.processedEmailsCount ?? 0 })}
              </div>
              <div>{t("threads", { count: metrics?.totalThreads ?? 0 })}</div>
              <div>
                {t("unmatched", { count: metrics?.unmatchedThreads ?? 0 })}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <Clock className="h-4 w-4" /> {t("syncSettings")}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("frequency")}
              <input
                className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                value={syncFrequencyMinutes}
                onChange={(e) => setSyncFrequencyMinutes(e.target.value)}
                type="number"
                min="5"
                max="60"
              />
            </label>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("auto")}
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={syncEnabled}
                  onChange={(e) => setSyncEnabled(e.target.checked)}
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t("enableAuto")}
                </span>
              </div>
            </label>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 md:col-span-2">
              {t("clientDomainsOnly")}
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={clientDomainsOnly}
                  onChange={(e) => setClientDomainsOnly(e.target.checked)}
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t("clientDomainsOnlyLabel")}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("clientDomainsHelp")}
              </p>
            </label>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 md:col-span-2">
              {t("whitelist")}
              <input
                className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                value={senderWhitelist}
                onChange={(e) => setSenderWhitelist(e.target.value)}
                placeholder={t("whitelistPlaceholder")}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("whitelistHelp")}
              </p>
            </label>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 md:col-span-2">
              {t("blacklist")}
              <input
                className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                value={senderBlacklist}
                onChange={(e) => setSenderBlacklist(e.target.value)}
                placeholder={t("blacklistPlaceholder")}
              />
            </label>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 md:col-span-2">
              {t("subjectFilters")}
              <input
                className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                value={subjectFilters}
                onChange={(e) => setSubjectFilters(e.target.value)}
                placeholder={t("subjectPlaceholder")}
              />
              {subjectFilterErrors.length > 0 ? (
                <p className="mt-1 text-xs text-red-600">
                  {t("invalidRegex", {
                    patterns: subjectFilterErrors.join(", "),
                  })}
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("subjectHelp")}
                </p>
              )}
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => triggerSyncMutation.mutate()}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              disabled={triggerSyncMutation.isPending}
            >
              <RefreshCw className="h-4 w-4" />
              {triggerSyncMutation.isPending ? t("starting") : t("syncNow")}
            </button>
            {userProfile?.role === "admin" && session?.user?.id && (
              <button
                type="button"
                onClick={() =>
                  backfillMutation.mutate({
                    userId: session.user.id,
                    days: 30,
                  })
                }
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                disabled={backfillMutation.isPending}
              >
                <Download className="h-4 w-4" />
                {backfillMutation.isPending ? t("starting") : t("fetch30")}
              </button>
            )}
            {isSyncRunning && (
              <div className="flex items-center gap-2 text-sm text-brand-600 dark:text-brand-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t("syncing")}</span>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("history")}
          </div>
          <div className="mt-4 space-y-3">
            {syncHistory?.length ? (
              syncHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    {entry.status === "processing" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-brand-500 dark:text-brand-400" />
                    ) : entry.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : entry.status === "failed" ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      <Clock className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="text-gray-700 dark:text-gray-300">
                      {formatJobType(entry.jobType, t)}
                    </span>
                    {entry.startedAt && entry.completedAt && (
                      <span className="text-xs text-gray-400">
                        {formatDuration(
                          new Date(entry.startedAt),
                          new Date(entry.completedAt),
                        )}
                      </span>
                    )}
                    {entry.attemptCount > 1 && (
                      <span className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {t("attempts", { count: entry.attemptCount })}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {formatRelativeTime(new Date(entry.createdAt), t, locale)}
                  </div>
                  {entry.status === "failed" && entry.errorMessage && (
                    <div className="w-full text-xs text-red-500 line-clamp-1">
                      {entry.errorMessage}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("noHistory")}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("reviewTitle")}
          </div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("reviewText")}
          </p>
          <div className="mt-4">
            <a
              href="/dashboard/settings/email-integration/review"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t("openReview")}
            </a>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-semibold text-tt-paa-gran hover:bg-tt-gran-moerk"
            disabled={upsertMutation.isPending}
          >
            <Save className="h-4 w-4" />
            {upsertMutation.isPending ? t("saving") : t("saveIntegration")}
          </button>
        </div>
      </form>
    </div>
  );
}
