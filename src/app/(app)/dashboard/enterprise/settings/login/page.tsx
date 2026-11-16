"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Globe,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { DpaCard } from "@/components/settings/DpaCard";
import { Button } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import type { RouterOutputs } from "@/lib/trpc/routers";
import { trpc } from "@/providers/trpc-provider";

type LoginSettings = RouterOutputs["enterprise"]["getLoginSettings"];
type DomainRow = LoginSettings["domains"][number];

const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
const labelClass =
  "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";
const helpClass = "mt-1 text-xs text-gray-500 dark:text-gray-400";
const codeClass =
  "rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs break-all dark:bg-gray-700";

function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-start gap-2">
        {icon && <span className="mt-0.5 text-gray-400">{icon}</span>}
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {description}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function formatDateTime(
  d: Date | string | null | undefined,
  intlLocale: string,
): string {
  if (!d) return "–";
  return new Date(d).toLocaleString(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/* ------------------------------------------------------------------ */
/* Domæner                                                             */
/* ------------------------------------------------------------------ */

function DomainCard({ domain }: { domain: DomainRow }) {
  const t = useTranslations("enterpriseSettings.login");
  const intlLocale = toIntlLocale(useLocale());
  const utils = trpc.useUtils();
  const verifyMutation = trpc.enterprise.verifyDomain.useMutation({
    onSuccess: (res) => {
      utils.enterprise.getLoginSettings.invalidate();
      if (res.ok) toast.success(t("verified", { domain: domain.domain }));
      else if (res.revoked)
        toast.error(t("txtGone", { domain: domain.domain }));
      else toast.error(res.error ?? t("recordNotFound"));
    },
    onError: (e) => toast.error(e.message),
  });
  const removeMutation = trpc.enterprise.removeDomain.useMutation({
    onSuccess: (res) => {
      utils.enterprise.getLoginSettings.invalidate();
      toast.success(res.requireSsoDisabled ? t("removedSsoOff") : t("removed"));
    },
    onError: (e) => toast.error(e.message),
  });

  const verified = domain.status === "verified";

  return (
    <li className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {verified ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <Clock className="h-4 w-4 text-amber-500" />
          )}
          <span className="font-medium">{domain.domain}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              verified
                ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
          >
            {verified ? t("statusVerified") : t("statusPending")}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => verifyMutation.mutate({ id: domain.id })}
            disabled={verifyMutation.isPending}
          >
            <RefreshCw
              className={`mr-1 h-3.5 w-3.5 ${verifyMutation.isPending ? "animate-spin" : ""}`}
            />
            {verified ? t("recheck") : t("verifyNow")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (
                window.confirm(t("confirmRemove", { domain: domain.domain }))
              ) {
                removeMutation.mutate({ id: domain.id });
              }
            }}
            disabled={removeMutation.isPending}
            aria-label={t("removeLabel", { domain: domain.domain })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-xs text-gray-600 dark:text-gray-400">
        {verified ? (
          <p>
            {t("verifiedOn", {
              date: formatDateTime(domain.verifiedAt, intlLocale),
            })}
          </p>
        ) : (
          <p>
            {t.rich("createTxt", {
              host1: domain.txtHosts[0],
              host2: domain.txtHosts[1],
              strong: (chunks) => <strong>{chunks}</strong>,
              code: (chunks) => <code className={codeClass}>{chunks}</code>,
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <code className={codeClass}>{domain.txtRecord}</code>
          <button
            type="button"
            className="text-xs text-brand-600 hover:underline dark:text-brand-400"
            onClick={() => {
              navigator.clipboard
                .writeText(domain.txtRecord)
                .then(() => toast.success(t("copied")))
                .catch(() => toast.error(t("copyFailed")));
            }}
          >
            {t("copy")}
          </button>
        </div>
        {domain.lastCheckError && !verified && (
          <p className="text-amber-700 dark:text-amber-400">
            {t("lastCheck", {
              date: formatDateTime(domain.lastCheckedAt, intlLocale),
              error: domain.lastCheckError,
            })}
          </p>
        )}
      </div>
    </li>
  );
}

function DomainsSection({ settings }: { settings: LoginSettings }) {
  const t = useTranslations("enterpriseSettings.login");
  const utils = trpc.useUtils();
  const [newDomain, setNewDomain] = useState("");
  const addMutation = trpc.enterprise.addDomain.useMutation({
    onSuccess: (row) => {
      utils.enterprise.getLoginSettings.invalidate();
      setNewDomain("");
      toast.success(t("added", { domain: row.domain }));
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Section
      title={t("domainsTitle")}
      icon={<Globe className="h-4 w-4" />}
      description={t("domainsDescription")}
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newDomain.trim()) addMutation.mutate({ domain: newDomain });
        }}
      >
        <input
          className={inputClass}
          placeholder={t("domainPlaceholder")}
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          autoComplete="off"
        />
        <Button
          type="submit"
          disabled={addMutation.isPending || !newDomain.trim()}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("add")}
        </Button>
      </form>

      {settings.domains.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {t("noDomains")}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {settings.domains.map((d) => (
            <DomainCard key={d.id} domain={d} />
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Login-politik                                                       */
/* ------------------------------------------------------------------ */

function LoginPolicySection({ settings }: { settings: LoginSettings }) {
  const t = useTranslations("enterpriseSettings.login");
  const utils = trpc.useUtils();
  const [tenantId, setTenantId] = useState(settings.ssoTenantId ?? "");
  const [role, setRole] = useState<"member" | "manager">(
    settings.autoJoinDefaultRole,
  );

  useEffect(() => {
    setTenantId(settings.ssoTenantId ?? "");
    setRole(settings.autoJoinDefaultRole);
  }, [settings.ssoTenantId, settings.autoJoinDefaultRole]);

  const updateMutation = trpc.enterprise.updateLoginSettings.useMutation({
    onSuccess: () => {
      utils.enterprise.getLoginSettings.invalidate();
      toast.success(t("policySaved"));
    },
    onError: (e) => toast.error(e.message),
  });

  const hasVerified = settings.domains.some((d) => d.status === "verified");

  return (
    <Section
      title={t("policyTitle")}
      icon={<ShieldCheck className="h-4 w-4" />}
    >
      {!settings.microsoftConfigured && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {t("microsoftOff")}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="tenant-id">
            {t("tenantId")}
          </label>
          <input
            id="tenant-id"
            className={inputClass}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <p className={helpClass}>{t("tenantHelp")}</p>
          {!settings.ssoTenantId && (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {t.rich("tenantWarning", {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="default-role">
            {t("defaultRole")}
          </label>
          <select
            id="default-role"
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "manager")}
          >
            <option value="member">{t("roleMember")}</option>
            <option value="manager">{t("roleManager")}</option>
          </select>
          <p className={helpClass}>{t("roleHelp")}</p>
          {role === "manager" && (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {t("roleManagerWarning")}
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() =>
              updateMutation.mutate({
                ssoTenantId: tenantId.trim() === "" ? null : tenantId,
                autoJoinDefaultRole: role,
              })
            }
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? t("saving") : t("save")}
          </Button>
        </div>

        <hr className="border-gray-200 dark:border-gray-700" />

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.requireSsoForDomains}
            disabled={
              updateMutation.isPending ||
              (!settings.requireSsoForDomains &&
                (!settings.microsoftConfigured ||
                  !hasVerified ||
                  !settings.actorHasMicrosoftAccount))
            }
            onChange={(e) =>
              updateMutation.mutate({ requireSsoForDomains: e.target.checked })
            }
          />
          <span>
            <span className="text-sm font-medium">{t("requireSso")}</span>
            <span className={`${helpClass} block`}>
              {t("requireSsoHelp")}
              {!settings.actorHasMicrosoftAccount &&
                !settings.requireSsoForDomains && (
                  <>
                    {" "}
                    {t.rich("connectMicrosoft", {
                      link: (chunks) => (
                        <Link
                          href="/dashboard/settings/security"
                          className="text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {chunks}
                        </Link>
                      ),
                    })}
                  </>
                )}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.requireTwoFactorForManagers}
            disabled={
              updateMutation.isPending ||
              (!settings.requireTwoFactorForManagers &&
                !settings.actorHasTwoFactor)
            }
            onChange={(e) =>
              updateMutation.mutate({
                requireTwoFactorForManagers: e.target.checked,
              })
            }
          />
          <span>
            <span className="text-sm font-medium">{t("require2fa")}</span>
            <span className={`${helpClass} block`}>
              {t("require2faHelp")}
              {!settings.actorHasTwoFactor &&
                !settings.requireTwoFactorForManagers && (
                  <>
                    {" "}
                    {t.rich("enable2fa", {
                      link: (chunks) => (
                        <Link
                          href="/dashboard/settings/security"
                          className="text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {chunks}
                        </Link>
                      ),
                    })}
                  </>
                )}
            </span>
          </span>
        </label>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Side                                                                */
/* ------------------------------------------------------------------ */

function LoginSettingsContent() {
  const t = useTranslations("enterpriseSettings.login");
  const { data: settings, isLoading } =
    trpc.enterprise.getLoginSettings.useQuery();

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />
      <Link
        href="/dashboard/enterprise/settings"
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-gray-400"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToSettings")}
      </Link>

      <div className="max-w-3xl space-y-6">
        {isLoading || !settings ? (
          <div className="animate-pulse space-y-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-40 rounded-lg bg-gray-100 dark:bg-gray-800"
              />
            ))}
          </div>
        ) : (
          <>
            <DomainsSection settings={settings} />
            <LoginPolicySection settings={settings} />
          </>
        )}
        <DpaCard />
      </div>
    </div>
  );
}

export default function LoginSettingsPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="admin">
        <LoginSettingsContent />
      </RoleGuard>
    </ModuleGuard>
  );
}
