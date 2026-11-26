"use client";

import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Clock,
  CreditCard,
  Download,
  FileText,
  FolderOpen,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  KlippekortHuller,
  type KlippekortTone,
} from "@/components/klippekort/KlippekortHuller";
import { UsageExport } from "@/components/klippekort/UsageExport";
import { getPortalPath, useCustomDomain } from "@/hooks/useCustomDomain";
import type { DemoCurrency } from "@/lib/demo/demo-mode";
import { formatInvoiceNumber } from "@/lib/invoices/draft-number";
import { prepaidBalanceLevel } from "@/lib/prepaid/balance";
import { prepaidDaysUntilExpiry } from "@/lib/prepaid/expiry";
import { trpc } from "@/providers/trpc-provider";
import {
  PortalEmpty,
  PortalLoading,
  type PortalNavKey,
  PortalQueryError,
  PortalShell,
  portalBadge,
  portalTable,
  usePortalFormat,
} from "./PortalShell";

interface PortalDashboardProps {
  sessionToken: string;
}

type Tab = "overview" | "invoices" | "projects" | "time" | "prepaid";
const TABS: Tab[] = ["overview", "invoices", "projects", "time", "prepaid"];

export function PortalDashboard({ sessionToken }: PortalDashboardProps) {
  const t = useTranslations("portal");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isCustomDomain } = useCustomDomain();

  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
  } = trpc.publicPortal.validateSession.useQuery(
    { sessionToken },
    { retry: false },
  );

  const {
    data: dashboard,
    isLoading: dashboardLoading,
    isError: dashboardError,
    refetch: refetchDashboard,
  } = trpc.publicPortal.getDashboard.useQuery(
    { sessionToken },
    { enabled: !!session && !sessionError },
  );

  useEffect(() => {
    if (sessionError) {
      localStorage.removeItem("portalSession");
      router.push(getPortalPath("/portal/login", isCustomDomain));
    }
  }, [sessionError, router, isCustomDomain]);

  if (sessionLoading || dashboardLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <PortalLoading label={t("dashboard.loading")} />
      </div>
    );
  }

  if (!session?.valid || !session.access) {
    return null;
  }

  const { access, branding } = session;
  const { permissions } = access;

  // Fanen ligger i URL'en (?tab=…), så navigationen i shell'en og et delt
  // link peger på samme fane — og "tilbage" i browseren virker.
  const requested = searchParams.get("tab") as Tab | null;
  const allowed: Record<Tab, boolean> = {
    overview: true,
    invoices: !!permissions.canViewInvoices,
    projects: !!permissions.canViewProjects,
    time: !!permissions.canViewTimeEntries,
    prepaid: !!permissions.canViewPrepaid,
  };
  const activeTab: Tab =
    requested && TABS.includes(requested) && allowed[requested]
      ? requested
      : "overview";

  return (
    <PortalShell
      sessionToken={sessionToken}
      clientName={access.clientName}
      branding={branding}
      permissions={permissions}
      active={activeTab as PortalNavKey}
    >
      {/* Fejlet dashboard-kald må ikke give en blank side */}
      {!dashboard ? (
        dashboardError ? (
          <PortalQueryError onRetry={() => void refetchDashboard()} />
        ) : null
      ) : (
        <>
          {activeTab === "overview" && (
            <OverviewTab
              dashboard={dashboard}
              permissions={permissions}
              sessionToken={sessionToken}
            />
          )}
          {activeTab === "invoices" && (
            <InvoicesTab
              sessionToken={sessionToken}
              canDownload={!!permissions.canDownloadInvoices}
              currency={access.currency}
            />
          )}
          {activeTab === "projects" && (
            <ProjectsTab sessionToken={sessionToken} />
          )}
          {activeTab === "time" && <TimeTab sessionToken={sessionToken} />}
          {activeTab === "prepaid" && (
            <PrepaidTab sessionToken={sessionToken} />
          )}
        </>
      )}
    </PortalShell>
  );
}

function TabHeading({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
          {title}
        </h1>
        {text && (
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {text}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "default" | "warn" | "danger";
}) {
  const color =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-gray-900 dark:text-white";
  return (
    <div className="bg-white p-4 dark:bg-gray-900">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {sub}
        </div>
      )}
    </div>
  );
}

function OverviewTab({
  dashboard,
  permissions,
  sessionToken,
}: {
  sessionToken: string;
  dashboard: {
    invoices?: { total: number; unpaid: number; overdue: number };
    projects?: { total: number; active: number };
    prepaid?: { packages: number; totalRemaining: number };
  };
  permissions: {
    canViewInvoices: boolean | null;
    canViewProjects: boolean | null;
    canViewTimeEntries: boolean | null;
    canViewPrepaid: boolean | null;
  };
}) {
  const t = useTranslations("portal.overview");
  const f = usePortalFormat();
  const { isCustomDomain } = useCustomDomain();
  const tiles: React.ReactNode[] = [];

  if (permissions.canViewInvoices && dashboard.invoices) {
    tiles.push(
      <StatTile
        key="inv"
        label={t("invoices")}
        value={dashboard.invoices.total}
        sub={
          dashboard.invoices.unpaid > 0
            ? t("unpaidCount", { count: dashboard.invoices.unpaid })
            : t("allPaid")
        }
      />,
      <StatTile
        key="due"
        label={t("overdue")}
        value={dashboard.invoices.overdue}
        tone={dashboard.invoices.overdue > 0 ? "danger" : "default"}
        sub={dashboard.invoices.overdue > 0 ? t("payAsap") : t("noneOverdue")}
      />,
    );
  }
  if (permissions.canViewProjects && dashboard.projects) {
    tiles.push(
      <StatTile
        key="proj"
        label={t("activeProjects")}
        value={dashboard.projects.active}
        sub={t("totalCount", { count: dashboard.projects.total })}
      />,
    );
  }
  if (permissions.canViewPrepaid && dashboard.prepaid) {
    const low =
      dashboard.prepaid.packages > 0 && dashboard.prepaid.totalRemaining <= 5;
    tiles.push(
      <StatTile
        key="pre"
        label={t("hoursRemaining")}
        value={f.hours(dashboard.prepaid.totalRemaining)}
        tone={low ? "warn" : "default"}
        sub={t("activePackages", { count: dashboard.prepaid.packages })}
      />,
    );
  }

  const shortcuts: { key: string; label: string; path: string }[] = [];
  if (permissions.canViewInvoices)
    shortcuts.push({
      key: "invoices",
      label: t("shortcutInvoices"),
      path: "/portal/dashboard?tab=invoices",
    });
  if (permissions.canViewTimeEntries)
    shortcuts.push({
      key: "report",
      label: t("shortcutReport"),
      path: "/portal/time-report",
    });
  if (permissions.canViewPrepaid)
    shortcuts.push({
      key: "prepaid",
      label: t("shortcutPrepaid"),
      path: "/portal/dashboard?tab=prepaid",
    });

  // Kun tidsregistreringer? Så er der ingen nøgletal, men stadig seneste
  // registreringer og genvejen til tidsrapporten.
  if (tiles.length === 0 && !permissions.canViewTimeEntries) {
    return (
      <PortalEmpty
        icon={FolderOpen}
        title={t("emptyTitle")}
        text={t("emptyText")}
      />
    );
  }

  const cols =
    tiles.length >= 4
      ? "grid-cols-2 lg:grid-cols-4"
      : tiles.length === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : "grid-cols-2";

  return (
    <div className="space-y-6">
      <TabHeading title={t("title")} text={t("subtitle")} />

      {dashboard.invoices && dashboard.invoices.overdue > 0 && (
        <Link
          href={getPortalPath("/portal/dashboard?tab=invoices", isCustomDomain)}
          className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 transition-colors hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-300 dark:hover:bg-red-900/20"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {t("overdueBanner", { count: dashboard.invoices.overdue })}
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
      )}

      {tiles.length > 0 && (
        <div
          className={`grid ${cols} gap-px overflow-hidden rounded-xl bg-gray-200 dark:bg-gray-800`}
        >
          {tiles}
        </div>
      )}

      {permissions.canViewTimeEntries && (
        <RecentEntries sessionToken={sessionToken} />
      )}

      {shortcuts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {shortcuts.map((s) => (
            <Link
              key={s.key}
              href={getPortalPath(s.path, isCustomDomain)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {s.label}
              <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** De seneste fem registreringer — så oversigten svarer på "hvad er der sket siden sidst". */
function RecentEntries({ sessionToken }: { sessionToken: string }) {
  const t = useTranslations("portal.recent");
  const f = usePortalFormat();
  const { isCustomDomain } = useCustomDomain();
  const { data: entries, isLoading } =
    trpc.publicPortal.getTimeEntries.useQuery({ sessionToken });
  if (isLoading || !entries || entries.length === 0) return null;
  const recent = entries.slice(0, 5);
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h2>
        <Link
          href={getPortalPath("/portal/dashboard?tab=time", isCustomDomain)}
          className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          {t("seeAll")}
        </Link>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800/50">
        {recent.map((entry) => (
          <li
            key={entry.id}
            className="flex items-baseline gap-3 px-4 py-2 text-sm"
          >
            <span className="w-20 shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
              {f.date(entry.date)}
            </span>
            <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-white">
              {entry.description || (
                <span className="text-gray-400">{t("noDescription")}</span>
              )}
              {entry.projectName && (
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  {entry.projectName}
                </span>
              )}
            </span>
            <span className="shrink-0 text-sm tabular-nums text-gray-900 dark:text-white">
              {t("hoursShort", { hours: f.hours(entry.hours) })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InvoicesTab({
  sessionToken,
  canDownload,
  currency,
}: {
  sessionToken: string;
  canDownload: boolean;
  currency: DemoCurrency;
}) {
  const t = useTranslations("portal.invoices");
  const f = usePortalFormat(currency);
  const {
    data: invoices,
    isLoading,
    isError,
    refetch,
  } = trpc.publicPortal.getInvoices.useQuery({ sessionToken });

  if (isLoading) return <PortalLoading />;
  if (isError) return <PortalQueryError onRetry={() => void refetch()} />;

  if (!invoices || invoices.length === 0) {
    return (
      <>
        <TabHeading title={t("title")} />
        <PortalEmpty
          icon={FileText}
          title={t("emptyTitle")}
          text={t("emptyText")}
        />
      </>
    );
  }

  const unpaid = invoices.filter((i) => i.status !== "paid");
  const unpaidSum = unpaid.reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div>
      <TabHeading
        title={t("title")}
        text={
          unpaid.length > 0
            ? t("outstanding", {
                count: unpaid.length,
                amount: f.money(unpaidSum),
              })
            : t("allPaid")
        }
      />
      <div className={portalTable.wrap}>
        <table className={portalTable.table}>
          <thead>
            <tr className={portalTable.headRow}>
              <th className={portalTable.th}>{t("colInvoice")}</th>
              <th className={`${portalTable.th} hidden sm:table-cell`}>
                {t("colDate")}
              </th>
              <th className={portalTable.th}>{t("colDue")}</th>
              <th className={portalTable.thRight}>{t("colAmount")}</th>
              <th className={portalTable.thRight}>{t("colStatus")}</th>
              {canDownload && (
                <th className={portalTable.thRight}>
                  <span className="sr-only">{t("download")}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => {
              const status =
                invoice.status === "paid"
                  ? { cls: portalBadge.green, label: t("statusPaid") }
                  : invoice.status === "overdue"
                    ? { cls: portalBadge.red, label: t("statusOverdue") }
                    : { cls: portalBadge.amber, label: t("statusPending") };
              return (
                <tr key={invoice.id} className={portalTable.row}>
                  <td className={`${portalTable.td} font-medium`}>
                    {formatInvoiceNumber(invoice.invoiceNumber)}
                  </td>
                  <td className={`${portalTable.tdMuted} hidden sm:table-cell`}>
                    {f.date(invoice.issueDate)}
                  </td>
                  <td
                    className={
                      invoice.status === "overdue"
                        ? "px-4 py-2.5 font-medium text-red-600 dark:text-red-400"
                        : portalTable.tdMuted
                    }
                  >
                    {f.date(invoice.dueDate)}
                  </td>
                  <td className={portalTable.tdNum}>
                    {f.money(invoice.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={status.cls}>{status.label}</span>
                  </td>
                  {canDownload && (
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/api/portal/invoices/${invoice.id}/pdf?session=${encodeURIComponent(sessionToken)}`}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                        download
                      >
                        <Download className="h-3.5 w-3.5" />
                        PDF
                      </a>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectsTab({ sessionToken }: { sessionToken: string }) {
  const t = useTranslations("portal.projects");
  const {
    data: projects,
    isLoading,
    isError,
    refetch,
  } = trpc.publicPortal.getProjects.useQuery({ sessionToken });

  if (isLoading) return <PortalLoading />;
  if (isError) return <PortalQueryError onRetry={() => void refetch()} />;

  if (!projects || projects.length === 0) {
    return (
      <>
        <TabHeading title={t("title")} />
        <PortalEmpty
          icon={FolderOpen}
          title={t("emptyTitle")}
          text={t("emptyText")}
        />
      </>
    );
  }

  const active = projects.filter((p) => p.status === "active").length;

  return (
    <div>
      <TabHeading
        title={t("title")}
        text={t("activeOf", { active, total: projects.length })}
      />
      <div className={portalTable.wrap}>
        <table className={portalTable.table}>
          <thead>
            <tr className={portalTable.headRow}>
              <th className={portalTable.th}>{t("colProject")}</th>
              <th className={portalTable.thRight}>{t("colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const status =
                project.status === "active"
                  ? { cls: portalBadge.green, label: t("statusActive") }
                  : project.status === "completed"
                    ? { cls: portalBadge.blue, label: t("statusCompleted") }
                    : { cls: portalBadge.gray, label: t("statusPaused") };
              return (
                <tr key={project.id} className={portalTable.row}>
                  <td className="px-4 py-2.5">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {project.name}
                    </div>
                    {project.description && (
                      <div className="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                        {project.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={status.cls}>{status.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TimeTab({ sessionToken }: { sessionToken: string }) {
  const t = useTranslations("portal.time");
  const f = usePortalFormat();
  const { isCustomDomain } = useCustomDomain();
  const {
    data: entries,
    isLoading,
    isError,
    refetch,
  } = trpc.publicPortal.getTimeEntries.useQuery({ sessionToken });

  if (isLoading) return <PortalLoading />;
  if (isError) return <PortalQueryError onRetry={() => void refetch()} />;

  const reportLink = (
    <Link
      href={getPortalPath("/portal/time-report", isCustomDomain)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      {t("fullReport")}
      <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
    </Link>
  );

  if (!entries || entries.length === 0) {
    return (
      <>
        <TabHeading title={t("title")} action={reportLink} />
        <PortalEmpty
          icon={Clock}
          title={t("emptyTitle")}
          text={t("emptyText")}
        />
      </>
    );
  }

  const total = entries.reduce((s, e) => s + Number(e.hours), 0);

  return (
    <div>
      <TabHeading title={t("title")} text={t("subtitle")} action={reportLink} />
      <div className={portalTable.wrap}>
        <table className={portalTable.table}>
          <thead>
            <tr className={portalTable.headRow}>
              <th className={portalTable.th}>{t("colDate")}</th>
              <th className={`${portalTable.th} hidden sm:table-cell`}>
                {t("colProject")}
              </th>
              <th className={portalTable.th}>{t("colDescription")}</th>
              <th className={portalTable.thRight}>{t("colHours")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className={portalTable.row}>
                <td className={`${portalTable.td} whitespace-nowrap`}>
                  {f.date(entry.date)}
                </td>
                <td className={`${portalTable.tdMuted} hidden sm:table-cell`}>
                  {entry.projectName ?? "–"}
                </td>
                <td className={`${portalTable.tdMuted} max-w-xs`}>
                  <span className="line-clamp-1">
                    {entry.description || "–"}
                  </span>
                </td>
                <td className={`${portalTable.tdNum} whitespace-nowrap`}>
                  {f.hours(entry.hours)}
                  {entry.isPrepaid && (
                    <span
                      className={`${portalBadge.purple} ml-2 !text-[10px]`}
                      title={t("prepaidTitle")}
                    >
                      {t("prepaidBadge")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={portalTable.foot}>
              {/* Projekt-kolonnen er skjult under sm — colSpan følger med */}
              <td className="px-4 py-2 sm:hidden" colSpan={2}>
                {t("entriesCount", { count: entries.length })}
              </td>
              <td className="hidden px-4 py-2 sm:table-cell" colSpan={3}>
                {t("entriesCount", { count: entries.length })}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {t("hoursShort", { hours: f.hours(total) })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function PrepaidTab({ sessionToken }: { sessionToken: string }) {
  const t = useTranslations("portal.prepaid");
  const f = usePortalFormat();
  const {
    data: prepaidData,
    isLoading,
    isError,
    refetch,
  } = trpc.publicPortal.getPrepaidPackages.useQuery({ sessionToken });
  const packages = prepaidData?.packages;
  const contactEmail = prepaidData?.contactEmail;
  // Deaktiverede kort (isActive=false) må ikke stå side om side med de
  // aktive — kunden læser dem som "timer jeg stadig har". De samles i en
  // foldet sektion, så historikken stadig kan ses.
  const activePackages = (packages ?? []).filter(
    (pkg) => pkg.isActive !== false,
  );
  const previousPackages = (packages ?? []).filter(
    (pkg) => pkg.isActive === false,
  );
  const [showPrevious, setShowPrevious] = useState(false);

  if (isLoading) return <PortalLoading />;
  if (isError) return <PortalQueryError onRetry={() => void refetch()} />;

  if (!packages || packages.length === 0) {
    return (
      <>
        <TabHeading title={t("title")} />
        <PortalEmpty
          icon={CreditCard}
          title={t("emptyTitle")}
          text={t("emptyText")}
        >
          {contactEmail && (
            <a
              href={`mailto:${contactEmail}?subject=${encodeURIComponent(t("newMailSubject"))}`}
              className="mt-3 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t("contactForPackage")}
            </a>
          )}
        </PortalEmpty>
      </>
    );
  }

  const remainingTotal = activePackages.reduce(
    (s, p) => s + Number(p.remainingHours),
    0,
  );

  return (
    <div className="space-y-6">
      <TabHeading
        title={t("title")}
        text={
          activePackages.length > 0
            ? t("remainingSummary", {
                hours: f.hours(remainingTotal),
                count: activePackages.length,
              })
            : t("noActive")
        }
      />

      {activePackages.length === 0 ? (
        <PortalEmpty icon={CreditCard} title={t("noActiveTitle")}>
          {contactEmail && (
            <a
              href={`mailto:${contactEmail}?subject=${encodeURIComponent(t("newMailSubject"))}`}
              className="mt-3 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t("contactForNew")}
            </a>
          )}
        </PortalEmpty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activePackages.map((pkg) => (
            <PrepaidPackageCard
              key={pkg.id}
              pkg={pkg}
              sessionToken={sessionToken}
              contactEmail={contactEmail ?? null}
            />
          ))}
        </div>
      )}

      {previousPackages.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowPrevious((v) => !v)}
            aria-expanded={showPrevious}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showPrevious ? "" : "-rotate-90"}`}
            />
            {t("previous", { count: previousPackages.length })}
          </button>
          {showPrevious && (
            <div className="mt-3 grid gap-4 opacity-75 sm:grid-cols-2 lg:grid-cols-3">
              {previousPackages.map((pkg) => (
                <PrepaidPackageCard
                  key={pkg.id}
                  pkg={pkg}
                  sessionToken={sessionToken}
                  contactEmail={contactEmail ?? null}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function PrepaidPackageCard({
  pkg,
  sessionToken,
  contactEmail,
}: {
  pkg: {
    id: string;
    name: string;
    totalHours: string;
    remainingHours: string;
    overdraftHours?: string | null;
    expiryDate: Date | string | null;
    isActive: boolean | null;
  };
  sessionToken: string;
  contactEmail: string | null;
}) {
  const t = useTranslations("portal.prepaid");
  const f = usePortalFormat();
  const [showHistory, setShowHistory] = useState(false);
  const [renewalRequested, setRenewalRequested] = useState(false);
  const requestRenewal = trpc.publicPortal.requestRenewal.useMutation({
    onSuccess: () => setRenewalRequested(true),
    onError: (e) => toast.error(e.message || t("renewalFailed")),
  });
  const remaining = Number(pkg.remainingHours);
  const total = Number(pkg.totalHours);
  const used = total - remaining;
  // Samme grænse som badgen "Lav saldo" andre steder (#881); "Opbrugt"
  // (remaining <= 0) håndteres separat nedenfor.
  const lowBalance =
    remaining > 0 && prepaidBalanceLevel(remaining, total) !== "ok";
  const inactive = pkg.isActive === false;
  const overdraft = Number(pkg.overdraftHours ?? 0);

  // Hele danske kalenderdage; kortet gælder hele udløbsdagen (#736)
  const daysToExpiry = prepaidDaysUntilExpiry(pkg.expiryDate);
  const expiringSoon =
    !inactive &&
    daysToExpiry !== null &&
    daysToExpiry >= 0 &&
    daysToExpiry <= 30;
  const expired = !inactive && daysToExpiry !== null && daysToExpiry < 0;

  const { data: usage, isLoading: usageLoading } =
    trpc.publicPortal.getPrepaidUsage.useQuery(
      { sessionToken, packageId: pkg.id },
      { enabled: showHistory },
    );

  // Samme tærskler som badgen "Lav saldo" (lowBalance ovenfor).
  const hulTone: KlippekortTone = inactive
    ? "inaktiv"
    : remaining <= 0
      ? "tom"
      : lowBalance
        ? "lav"
        : "normal";

  return (
    <div className="flex flex-col rounded-xl border border-gray-200/80 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {pkg.name}
        </h3>
        {inactive ? (
          <span className={portalBadge.gray}>{t("badgeEnded")}</span>
        ) : expired ? (
          <span className={portalBadge.red}>{t("badgeExpired")}</span>
        ) : lowBalance ? (
          <span className={portalBadge.amber}>{t("badgeLow")}</span>
        ) : expiringSoon ? (
          <span className={portalBadge.amber}>
            {t("expiryLabel", { days: daysToExpiry ?? 0 })}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {f.hours(remaining)}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("ofTotalRemaining", { total: f.number(total) })}
          </span>
        </div>
        <KlippekortHuller
          className="mt-3"
          totalHours={total}
          remainingHours={remaining}
          tone={hulTone}
        />
        <div className="mt-1.5 flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>
            {t.rich("used", {
              hours: f.hours(used),
              num: (chunks) => <span className="tabular-nums">{chunks}</span>,
            })}
          </span>
          {pkg.expiryDate && (
            <span>{t("expires", { date: f.expiry(pkg.expiryDate) })}</span>
          )}
        </div>
        {overdraft > 0 && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {t.rich("overdraft", {
              hours: f.hours(overdraft),
              num: (chunks) => <span className="tabular-nums">{chunks}</span>,
            })}
          </p>
        )}
      </div>

      {!inactive && (
        <div className="mt-4">
          {renewalRequested ? (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-center text-xs font-medium text-green-700 dark:bg-green-900/20 dark:text-green-300">
              {t("renewalSent")}
            </p>
          ) : (
            <button
              type="button"
              onClick={() =>
                requestRenewal.mutate({ sessionToken, packageId: pkg.id })
              }
              disabled={requestRenewal.isPending}
              className={`block w-full rounded-lg px-3 py-2 text-center text-xs font-medium transition-colors disabled:opacity-50 ${
                lowBalance
                  ? "bg-tt-gran text-tt-paa-gran hover:bg-tt-gran-moerk"
                  : "border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {requestRenewal.isPending ? t("sending") : t("renew")}
            </button>
          )}
          {contactEmail && !renewalRequested && (
            <a
              href={`mailto:${contactEmail}?subject=${encodeURIComponent(t("mailSubjectNamed", { name: pkg.name }))}`}
              className="mt-1.5 block text-center text-xs text-gray-500 hover:underline dark:text-gray-400"
            >
              {t("contactDirect")}
            </a>
          )}
        </div>
      )}

      {/* Forbrugshistorik (#177) */}
      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        aria-expanded={showHistory}
        className="mt-3 inline-flex items-center gap-1 self-start text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${showHistory ? "" : "-rotate-90"}`}
        />
        {showHistory ? t("hideUsage") : t("showUsage")}
      </button>
      {showHistory && usage && (
        <UsageExport packageId={pkg.id} packageName={pkg.name} usage={usage} />
      )}
      {showHistory && (
        <div className="mt-2 max-h-48 overflow-y-auto border-t border-gray-100 pt-2 dark:border-gray-800">
          {usageLoading ? (
            <PortalLoading />
          ) : !usage || usage.length === 0 ? (
            <p className="py-2 text-center text-xs text-gray-500 dark:text-gray-400">
              {t("noUsage")}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {usage.map((u) => (
                <li
                  key={u.id}
                  className="flex items-baseline justify-between gap-2 py-1.5 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">
                    <span className="mr-2 tabular-nums text-gray-400">
                      {f.date(u.date)}
                    </span>
                    {u.description}
                  </span>
                  <span className="shrink-0 tabular-nums text-gray-900 dark:text-gray-100">
                    {t("hoursShort", { hours: f.hours(u.hoursUsed) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
