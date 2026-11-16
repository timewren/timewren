"use client";

import { Fingerprint, Key, Monitor, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

interface UserSecurityProps {
  userId: string;
  activeTab: string;
}

function Section({
  title,
  icon: Icon,
  children,
  count,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        {typeof count === "number" && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {count}
          </span>
        )}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

type Translator = ReturnType<typeof useTranslations>;

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

function parseUserAgent(ua: string | null, t: Translator): string {
  if (!ua) return t("security.unknownDevice");
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return `${ua.slice(0, 40)}...`;
}

function providerLabel(providerId: string, t: Translator): string {
  const map: Record<string, string> = {
    google: "Google",
    github: "GitHub",
    discord: "Discord",
    microsoft: "Microsoft",
    credential: t("security.emailPassword"),
    "email-password": t("security.emailPassword"),
    "magic-link": t("security.magicLink"),
    "phone-number": t("security.phone"),
  };
  return map[providerId] ?? providerId;
}

export function UserSecurity({ userId, activeTab }: UserSecurityProps) {
  const t = useTranslations("adminUsers");
  const locale = useLocale();
  const formatDate = (date: Date | string | null | undefined) =>
    formatDateTime(date, locale);
  const { data, isLoading } = trpc.admin.getUserSecurityInfo.useQuery(
    { userId },
    { enabled: activeTab === "security" },
  );

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-lg bg-gray-100" />;
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
        {t("security.noData")}
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      <Section title={t("security.twoFactorTitle")} icon={ShieldCheck}>
        {data.twoFactor ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium text-green-700">
              {t("security.twoFactorOn")}
            </p>
            <p className="text-gray-600">
              {t("security.enrolled", {
                date: formatDate(data.twoFactor.enrolledAt),
              })}
            </p>
            {data.twoFactor.updatedAt && (
              <p className="text-gray-600">
                {t("security.changed", {
                  date: formatDate(data.twoFactor.updatedAt),
                })}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">{t("security.twoFactorOff")}</p>
        )}
      </Section>

      <Section
        title={t("security.loginMethods")}
        icon={Key}
        count={data.oauthAccounts.length}
      >
        {data.oauthAccounts.length === 0 ? (
          <p className="text-sm text-gray-500">
            {t("security.noLoginMethods")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {data.oauthAccounts.map((acc) => (
              <li
                key={acc.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="font-medium text-gray-900">
                  {providerLabel(acc.providerId, t)}
                </span>
                <span className="text-xs text-gray-500">
                  {t("security.linked", { date: formatDate(acc.createdAt) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t("security.passkeys")}
        icon={Fingerprint}
        count={data.passkeys.length}
      >
        {data.passkeys.length === 0 ? (
          <p className="text-sm text-gray-500">{t("security.noPasskeys")}</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {data.passkeys.map((pk) => (
              <li key={pk.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">
                    {pk.name || t("security.namedDevice")}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatDate(pk.createdAt)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {pk.deviceType ?? t("security.unknown")}
                  {pk.backedUp && ` ${t("security.backedUp")}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t("security.trustedDevices")}
        icon={Monitor}
        count={data.trustedDevices.length}
      >
        {data.trustedDevices.length === 0 ? (
          <p className="text-sm text-gray-500">
            {t("security.noTrustedDevices")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {data.trustedDevices.map((dev) => {
              const expired = new Date(dev.expiresAt) < now;
              return (
                <li key={dev.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">
                      {parseUserAgent(dev.userAgent, t)}
                    </span>
                    {expired && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {t("security.expired")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                    <span>
                      {t("security.ip", { ip: dev.ipAddress ?? "—" })}
                    </span>
                    <span>
                      {t("security.lastUsed", {
                        date: formatDate(dev.lastUsed),
                      })}
                    </span>
                    <span>
                      {t("security.expires", {
                        date: formatDate(dev.expiresAt),
                      })}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title={t("security.sessions")}
        icon={Monitor}
        count={data.activeSessionCount}
      >
        <div className="mb-2 text-xs text-gray-500">
          {t("security.sessionsSummary", { count: data.activeSessionCount })}
        </div>
        {data.recentSessions.length === 0 ? (
          <p className="text-sm text-gray-500">{t("security.noSessions")}</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {data.recentSessions.map((s) => {
              const isActive = new Date(s.expiresAt) > now;
              return (
                <li key={s.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">
                      {parseUserAgent(s.userAgent, t)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        isActive
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {isActive ? t("security.active") : t("security.expired")}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                    <span>{t("security.ip", { ip: s.ipAddress ?? "—" })}</span>
                    <span>
                      {t("security.started", { date: formatDate(s.createdAt) })}
                    </span>
                    <span>
                      {t("security.expires", { date: formatDate(s.expiresAt) })}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
