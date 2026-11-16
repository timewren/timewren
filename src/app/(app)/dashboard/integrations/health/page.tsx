"use client";

import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  KeyRound,
  Mail,
  Webhook,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { ErrorState } from "@/components/ui/ErrorState";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

// Integrationssundhed (#169): "virker mine integrationer?" besvares ét
// sted — status pr. forbindelse med sidste sync og seneste fejl, i stedet
// for at en udløbet token først opdages ved månedens fakturering.

type Status = "ok" | "warning" | "error" | "none";

const PROVIDER_LABELS: Record<string, string> = {
  billy: "Billy",
  dinero: "Dinero",
  economic: "e-conomic",
};

function StatusDot({ status }: { status: Status }) {
  if (status === "ok")
    return <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />;
  if (status === "warning")
    return <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />;
  if (status === "error")
    return <XCircle className="h-5 w-5 shrink-0 text-red-500" />;
  return (
    <span className="h-5 w-5 shrink-0 rounded-full border-2 border-gray-300 dark:border-gray-600" />
  );
}

function HealthCard({
  icon,
  title,
  status,
  lines,
  href,
  hrefLabel,
}: {
  icon: React.ReactNode;
  title: string;
  status: Status;
  lines: (string | null)[];
  href: string;
  hrefLabel: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {icon}
          <h3 className="font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
        </div>
        <StatusDot status={status} />
      </div>
      <div className="mt-3 space-y-1">
        {lines
          .filter((l): l is string => !!l)
          .map((line) => (
            <p key={line} className="text-sm text-gray-600 dark:text-gray-400">
              {line}
            </p>
          ))}
      </div>
      <Link
        href={href}
        className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
      >
        {hrefLabel} →
      </Link>
    </div>
  );
}

export default function IntegrationHealthPage() {
  // Som /dashboard/integrations: uden modulet afviser serveren kaldet, og
  // siden viste en spinner for evigt.
  return (
    <ModuleGuard module="integrations">
      <IntegrationHealthContent />
    </ModuleGuard>
  );
}

function IntegrationHealthContent() {
  const t = useTranslations("integrations.health");
  const intlLocale = toIntlLocale(useLocale());
  const fmtDate = (d: Date | string | null | undefined) =>
    d ? new Date(d).toLocaleString(intlLocale) : null;
  const { data, isLoading, error, refetch, isRefetching } =
    trpc.integrations.getHealthOverview.useQuery();

  if (error) {
    return (
      <ErrorState
        title={t("loadFailed")}
        message={error.message}
        onRetry={() => void refetch()}
        isRetrying={isRefetching}
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <InlineSpinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.accounting.map((acc) => {
          const label = PROVIDER_LABELS[acc.provider] ?? acc.provider;
          const status: Status = !acc.connected
            ? "none"
            : acc.tokenExpired || acc.lastSync?.status === "error"
              ? "error"
              : acc.lastSync?.status === "partial"
                ? "warning"
                : "ok";
          return (
            <HealthCard
              key={acc.provider}
              icon={
                <Activity className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              }
              title={label}
              status={status}
              lines={[
                !acc.connected ? t("notConnected") : null,
                acc.tokenExpired ? t("tokenExpired") : null,
                acc.lastSync
                  ? t("lastSync", {
                      operation: acc.lastSync.operation,
                      status: acc.lastSync.status,
                      date: fmtDate(acc.lastSync.createdAt) ?? "",
                    })
                  : acc.connected
                    ? t("noSyncYet")
                    : null,
                acc.lastSync?.errorMessage
                  ? t("error", {
                      message: acc.lastSync.errorMessage.slice(0, 120),
                    })
                  : null,
              ]}
              href="/dashboard/integrations"
              hrefLabel={t("manage")}
            />
          );
        })}

        <HealthCard
          icon={
            <Webhook className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          }
          title={t("webhooks")}
          status={
            data.webhooks.total === 0
              ? "none"
              : data.webhooks.autoDisabled > 0
                ? "error"
                : data.webhooks.failing > 0
                  ? "warning"
                  : "ok"
          }
          lines={[
            data.webhooks.total === 0
              ? t("noWebhooks")
              : t("webhooksActive", {
                  active: data.webhooks.active,
                  total: data.webhooks.total,
                }),
            data.webhooks.autoDisabled > 0
              ? t("webhooksAutoDisabled", { count: data.webhooks.autoDisabled })
              : null,
            data.webhooks.failing > 0
              ? t("webhooksFailing", { count: data.webhooks.failing })
              : null,
            data.webhooks.lastFailure
              ? t("webhooksLastFailure", {
                  event: data.webhooks.lastFailure.eventType,
                  date: fmtDate(data.webhooks.lastFailure.createdAt) ?? "",
                })
              : null,
          ]}
          href="/dashboard/settings/api"
          hrefLabel={t("manage")}
        />

        <HealthCard
          icon={<Mail className="h-5 w-5 text-brand-600 dark:text-brand-400" />}
          title={t("email")}
          status={
            !data.email.connected
              ? "none"
              : (data.email.consecutiveSyncFailures ?? 0) >= 3 ||
                  data.email.lastSyncStatus === "error"
                ? "error"
                : (data.email.consecutiveSyncFailures ?? 0) > 0
                  ? "warning"
                  : "ok"
          }
          lines={[
            !data.email.connected ? t("notConnected") : null,
            data.email.connected && !data.email.syncEnabled
              ? t("syncOff")
              : null,
            data.email.connected
              ? t("emailLastSync", {
                  date: fmtDate(data.email.lastSyncedAt) ?? t("never"),
                })
              : null,
            (data.email.consecutiveSyncFailures ?? 0) > 0
              ? t("failuresInRow", {
                  count: data.email.consecutiveSyncFailures ?? 0,
                })
              : null,
            data.email.lastSyncError
              ? t("error", { message: data.email.lastSyncError.slice(0, 120) })
              : null,
          ]}
          href="/dashboard/settings/email"
          hrefLabel={t("manage")}
        />

        <HealthCard
          icon={
            <Calendar className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          }
          title={t("calendar")}
          status={
            !data.calendar.connected
              ? "none"
              : data.calendar.tokenExpired
                ? "warning"
                : "ok"
          }
          lines={[
            !data.calendar.connected
              ? t("notConnected")
              : t("account", {
                  account: data.calendar.account ?? t("unknown"),
                }),
            data.calendar.connected && data.calendar.calendarName
              ? t("calendarName", { name: data.calendar.calendarName })
              : null,
            data.calendar.tokenExpired ? t("calendarTokenExpired") : null,
          ]}
          href="/dashboard/calendar/setup"
          hrefLabel={t("manage")}
        />

        <HealthCard
          icon={
            <KeyRound className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          }
          title={t("apiKeys")}
          status={data.apiKeys.active === 0 ? "none" : "ok"}
          lines={[
            data.apiKeys.active === 0
              ? t("noKeys")
              : t("keysActive", { count: data.apiKeys.active }),
            data.apiKeys.lastUsedAt
              ? t("lastUsed", { date: fmtDate(data.apiKeys.lastUsedAt) ?? "" })
              : null,
          ]}
          href="/dashboard/settings/api"
          hrefLabel={t("manage")}
        />
      </div>
    </div>
  );
}
