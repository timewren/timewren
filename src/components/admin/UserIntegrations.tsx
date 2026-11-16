"use client";

import {
  Calendar,
  CheckCircle2,
  Mail,
  Puzzle,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

interface UserIntegrationsProps {
  userId: string;
  activeTab: string;
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <Icon className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function StatusBadge({ configured }: { configured: boolean }) {
  const t = useTranslations("adminUsers");
  return configured ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      <CheckCircle2 className="h-3 w-3" />
      {t("integrations.configured")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
      <XCircle className="h-3 w-3" />
      {t("integrations.notSetUp")}
    </span>
  );
}

function IntegrationRow({
  name,
  configured,
  children,
}: {
  name: string;
  configured: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">{name}</p>
        {children && (
          <div className="mt-0.5 text-xs text-gray-500">{children}</div>
        )}
      </div>
      <StatusBadge configured={configured} />
    </div>
  );
}

function formatDateTime(
  date: Date | string | null | undefined,
  locale: string,
): string {
  if (!date) return "—";
  return new Date(date).toLocaleString(toIntlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function providerName(provider: string): string {
  const map: Record<string, string> = {
    google: "Google Calendar",
    outlook: "Microsoft Outlook",
    apple: "Apple Calendar",
  };
  return map[provider] ?? provider;
}

export function UserIntegrations({ userId, activeTab }: UserIntegrationsProps) {
  const t = useTranslations("adminUsers");
  const locale = useLocale();
  const formatDate = (date: Date | string | null | undefined) =>
    formatDateTime(date, locale);
  const { data, isLoading } = trpc.admin.getUserIntegrations.useQuery(
    { userId },
    { enabled: activeTab === "integrations" },
  );

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-lg bg-gray-100" />;
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
        {t("integrations.noData")}
      </div>
    );
  }

  const { accounting, ai, timeops, calendars, emailIntegrations, inbound } =
    data;

  return (
    <div className="space-y-4">
      <Section title={t("integrations.accounting")} icon={Puzzle}>
        <div className="divide-y divide-gray-50">
          <IntegrationRow name="Billy" configured={accounting.billy.configured}>
            {accounting.billy.organizationId && (
              <span>
                {t("integrations.orgId", {
                  id: accounting.billy.organizationId,
                })}
              </span>
            )}
          </IntegrationRow>
          <IntegrationRow
            name="Dinero"
            configured={accounting.dinero.configured}
          >
            <div className="space-y-0.5">
              {accounting.dinero.orgName && (
                <div>{accounting.dinero.orgName}</div>
              )}
              {accounting.dinero.organizationId && (
                <div>
                  {t("integrations.orgId", {
                    id: accounting.dinero.organizationId,
                  })}
                </div>
              )}
              {accounting.dinero.tokenExpiresAt && (
                <div>
                  {t("integrations.tokenExpires", {
                    date: formatDate(accounting.dinero.tokenExpiresAt),
                  })}
                </div>
              )}
            </div>
          </IntegrationRow>
          <IntegrationRow
            name="e-conomic"
            configured={accounting.economic.configured}
          />
        </div>
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-1 text-xs text-gray-500">
          <div>
            <span className="font-medium text-gray-700">
              {t("integrations.defaultIntegration")}
            </span>{" "}
            {accounting.defaultIntegration ?? t("integrations.none")}
          </div>
          <div>
            <span className="font-medium text-gray-700">
              {t("integrations.autoSync")}
            </span>{" "}
            {accounting.autoSyncInvoices
              ? t("integrations.on")
              : t("integrations.off")}
          </div>
        </div>
      </Section>

      <Section title={t("integrations.ai")} icon={Sparkles}>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">{t("integrations.provider")}</span>
            <span className="font-medium text-gray-900">{ai.provider}</span>
          </div>
          {ai.model && (
            <div className="flex justify-between">
              <span className="text-gray-500">{t("integrations.model")}</span>
              <span className="font-medium text-gray-900">{ai.model}</span>
            </div>
          )}
          {ai.customUrl && (
            <div className="flex justify-between">
              <span className="text-gray-500">
                {t("integrations.customUrl")}
              </span>
              <span className="font-mono text-xs text-gray-900">
                {ai.customUrl}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500">{t("integrations.byok")}</span>
            <StatusBadge configured={ai.hasCustomKey} />
          </div>
        </div>
      </Section>

      <Section title={t("integrations.other")} icon={Puzzle}>
        <div className="divide-y divide-gray-50">
          <IntegrationRow
            name="TimeOps import"
            configured={timeops.configured}
          />
        </div>
      </Section>

      <Section title={t("integrations.calendars")} icon={Calendar}>
        {calendars.length === 0 ? (
          <p className="text-sm text-gray-500">
            {t("integrations.noCalendars")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {calendars.map((cal) => (
              <li key={cal.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">
                    {providerName(cal.provider)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      cal.syncEnabled
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {cal.syncEnabled
                      ? t("integrations.syncActive")
                      : t("integrations.syncPaused")}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {cal.calendarName && (
                    <div>
                      {t("integrations.calendar", { name: cal.calendarName })}
                    </div>
                  )}
                  {cal.providerAccountId && (
                    <div>
                      {t("integrations.account", {
                        name: cal.providerAccountId,
                      })}
                    </div>
                  )}
                  <div>
                    {t("integrations.added", {
                      date: formatDate(cal.createdAt),
                    })}
                  </div>
                  {cal.lastSynced && (
                    <div>
                      {t("integrations.lastSynced", {
                        date: formatDate(cal.lastSynced),
                      })}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("integrations.emailIntegrations")} icon={Mail}>
        {emailIntegrations.length === 0 ? (
          <p className="text-sm text-gray-500">
            {t("integrations.noEmailIntegrations")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {emailIntegrations.map((ei) => (
              <li key={ei.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">
                    {ei.imapUsername}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      ei.syncEnabled
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {ei.syncEnabled
                      ? t("integrations.syncActive")
                      : t("integrations.syncPaused")}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  <div>{t("integrations.host", { host: ei.imapHost })}</div>
                  {ei.lastSyncedAt && (
                    <div>
                      {ei.lastSyncStatus
                        ? t("integrations.lastSyncedStatus", {
                            date: formatDate(ei.lastSyncedAt),
                            status: ei.lastSyncStatus,
                          })
                        : t("integrations.lastSynced", {
                            date: formatDate(ei.lastSyncedAt),
                          })}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-1 text-xs text-gray-500">
          {inbound.inboundEmailId && (
            <div>
              <span className="font-medium text-gray-700">
                {t("integrations.inboundEmail")}
              </span>{" "}
              <code className="rounded bg-gray-100 px-1">
                task+{inbound.inboundEmailId}@timetrack.dk
              </code>
            </div>
          )}
          {inbound.resendContactId && (
            <div>
              <span className="font-medium text-gray-700">
                {t("integrations.resendContact")}
              </span>{" "}
              <code className="font-mono text-xs">
                {inbound.resendContactId}
              </code>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
