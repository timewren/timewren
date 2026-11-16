"use client";

import {
  Archive,
  ArrowLeft,
  Ban,
  Building2,
  Check,
  ClipboardCheck,
  Clock,
  Coins,
  Copy,
  CreditCard,
  DollarSign,
  Edit,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  Globe,
  History,
  Key,
  LayoutGrid,
  Link as LinkIcon,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { use, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClientNudges } from "@/components/adoption/ClientNudges";
import { InvoiceNowDialog } from "@/components/adoption/InvoiceNowDialog";
import { useNudgeEligibility } from "@/components/adoption/useNudges";
import { AluntaMappingCard } from "@/components/clients/AluntaMappingCard";
import { ClientActivityFeed } from "@/components/clients/ClientActivityFeed";
import { ClientRevenueWidget } from "@/components/clients/ClientRevenueWidget";
import { CreateInvoiceSlideOver } from "@/components/clients/CreateInvoiceSlideOver";
import { OpenInvoicesWidget } from "@/components/clients/OpenInvoicesWidget";
import { UnbilledEntriesTable } from "@/components/clients/UnbilledEntriesTable";
import { Breadcrumbs } from "@/components/dashboard-nav";
import { RecurringInvoicesPanel } from "@/components/invoices/RecurringInvoicesPanel";
import { KlippekortHuller } from "@/components/klippekort/KlippekortHuller";
import { RateHistory } from "@/components/RateHistory";
import { ScheduledRateChanges } from "@/components/ScheduledRateChanges";
import { TimeEntryEditModal } from "@/components/TimeEntryEditModal";
import { QuickTimeEntryModal } from "@/components/time/QuickTimeEntryModal";
import { ConfirmDialog, ModuleDisabledState } from "@/components/ui";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { usePermission } from "@/hooks/usePermission";
import { toIntlLocale } from "@/i18n/format-locale";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { formatCurrency, formatTime, toLocalDateStr } from "@/lib/format";
import { isModuleDisabledError } from "@/lib/modules/forbidden-error";
import { sumUsablePrepaidHours } from "@/lib/prepaid/usable-balance";
import { toastError } from "@/lib/trpc/error-toast";
import type { RouterOutputs } from "@/lib/trpc/routers";
import { trpc } from "@/providers/trpc-provider";
import { useTimerStore } from "@/stores/timerStore";
import { ApprovalsTab } from "./_components/ApprovalsTab";

type TabType =
  | "overview"
  | "projects"
  | "time"
  | "invoicing"
  | "approvals"
  | "prepaid"
  | "portal"
  | "history";

export default function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("clients");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>(
    (searchParams.get("tab") as TabType) || "overview",
  );
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [invoiceNowOpen, setInvoiceNowOpen] = useState(false);
  // "Fakturér nu" kræver også fakturamodulet og skriveadgang til fakturaer
  const canInvoiceNow = useNudgeEligibility().invoicing;

  const {
    data: client,
    isLoading,
    isError,
    error: clientError,
  } = trpc.clients.getById.useQuery({ id });
  const { data: projects } = trpc.projects.getByClient.useQuery({
    clientId: id,
  });
  const { data: allTimeEntries } = trpc.time.list.useQuery({
    forClientId: id,
    limit: 1000,
    // Timer og omsætning over alle kundens poster, ikke kun de 1000 viste.
    includeClientTotals: true,
  });
  const { data: prepaidPackages } = trpc.prepaid.list.useQuery({
    clientId: id,
  });

  const { canWrite: canManage } = usePermission("clients");

  const archiveMutation = trpc.clients.archive.useMutation({
    onSuccess: () => {
      router.push("/dashboard/clients");
    },
    onError: (error, variables) => {
      toastError(error, t("detail.archiveFailed"), () => {
        archiveMutation.mutate(variables);
      });
    },
  });

  const handleArchive = () => {
    setShowArchiveConfirm(true);
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.pushState({}, "", url);
  };

  if (isLoading) {
    return <LoadingScreen message={t("detail.loading")} />;
  }

  if (!client) {
    if (isModuleDisabledError(clientError)) {
      return <ModuleDisabledState />;
    }
    return (
      <div className="py-12 text-center">
        <p className="text-gray-600 dark:text-gray-400">
          {isError ? t("detail.loadFailed") : t("detail.notFound")}
        </p>
        <Link
          href="/dashboard/clients"
          className="mt-4 inline-flex items-center gap-2 text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("detail.back")}
        </Link>
      </div>
    );
  }

  // Calculate stats
  const projectIds = projects?.map((p) => p.id) || [];
  const clientTimeEntries =
    allTimeEntries?.entries?.filter(
      (entry) =>
        (entry.projectId && projectIds.includes(entry.projectId)) ||
        entry.clientId === id,
    ) || [];

  // Summeret i SQL over alle kundens poster (samme takstregel som før:
  // postens, projektets, ellers kundens takst; klippekort uden omsætning).
  // Regnet ud fra listen blev tallene stille forkerte over 1000 poster (#1115).
  const totalHours = allTimeEntries?.clientTotals?.hours ?? 0;
  const totalRevenue = allTimeEntries?.clientTotals?.revenue ?? 0;

  const activePrepaid =
    prepaidPackages?.filter((pkg) => pkg.isActive).length || 0;
  // Kun timer der kan bruges: deaktiverede/udløbne kort tæller ikke med
  const totalPrepaidHours = sumUsablePrepaidHours(prepaidPackages);

  // Tab definitions
  const tabs: Array<{
    id: TabType;
    label: string;
    icon: React.ElementType;
  }> = [
    { id: "overview", label: t("detail.tabs.overview"), icon: LayoutGrid },
    { id: "projects", label: t("detail.tabs.projects"), icon: FolderKanban },
    { id: "time", label: t("detail.tabs.time"), icon: Clock },
    { id: "invoicing", label: t("detail.tabs.invoicing"), icon: FileText },
    {
      id: "approvals",
      label: t("detail.tabs.approvals"),
      icon: ClipboardCheck,
    },
    { id: "prepaid", label: t("detail.tabs.prepaid"), icon: CreditCard },
    { id: "portal", label: t("detail.tabs.portal"), icon: Globe },
    { id: "history", label: t("detail.tabs.history"), icon: History },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {/* Header */}
      <div>
        <Breadcrumbs
          items={[
            { label: t("detail.breadcrumb"), href: "/dashboard/clients" },
            { label: client.name },
          ]}
        />

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3 sm:gap-4">
            <div className="flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-brand-100 dark:bg-tt-gran-lys text-xl sm:text-2xl font-bold text-brand-700 dark:text-brand-400">
              {client.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                {client.name}
              </h1>
              {client.company && (
                <p className="mt-1 text-sm sm:text-base text-gray-600 dark:text-gray-400">
                  {client.company}
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Link
              href={`/dashboard/clients/${id}/edit`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <Edit className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t("detail.actions.edit")}
              </span>
            </Link>
            {canManage && (
              <button
                type="button"
                onClick={handleArchive}
                disabled={archiveMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-transparent px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Archive className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {t("detail.actions.archive")}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              const activeProjects =
                projects?.filter((p) => p.status === "active") ?? [];
              const autoProjectId =
                activeProjects.length === 1 ? activeProjects[0].id : null;
              useTimerStore.getState().startTimer({
                clientId: id,
                projectId: autoProjectId,
              });
              toast.success(t("detail.actions.timerStarted"));
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            <Play className="h-4 w-4" />
            {t("detail.actions.startTimer")}
          </button>
          <Link
            href={`/dashboard/time/new?clientId=${id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" />
            {t("detail.actions.newEntry")}
          </Link>
          <Link
            href={`/dashboard/projects/new?clientId=${id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" />
            {t("detail.actions.newProject")}
          </Link>

          <Link
            href={`/dashboard/klippekort/new?clientId=${id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" />
            {t("detail.actions.newPrepaid")}
          </Link>
          {/* "Fakturér nu" (#89): kladde fra ufaktureret tid i ét
                  trin; dialogen linker videre til den manuelle formular */}
          {canInvoiceNow && (
            <button
              type="button"
              onClick={() => setInvoiceNowOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <FileText className="h-4 w-4" />
              {t("detail.actions.invoiceNow")}
            </button>
          )}
        </div>
      </div>

      <ClientNudges clientId={id} />
      {canInvoiceNow && (
        <InvoiceNowDialog
          clientId={id}
          clientName={client.name}
          isOpen={invoiceNowOpen}
          onClose={() => setInvoiceNowOpen(false)}
          origin="client_page"
        />
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-2 sm:gap-6 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-1 sm:gap-2 border-b-2 px-1 py-3 sm:py-4 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-brand-600 dark:border-brand-400 text-brand-600 dark:text-brand-400"
                    : "border-transparent text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "overview" && (
          <OverviewTab
            client={client}
            clientId={id}
            totalHours={totalHours}
            totalRevenue={totalRevenue}
            projectsCount={projects?.length || 0}
            activePrepaid={activePrepaid}
            totalPrepaidHours={totalPrepaidHours}
            timeEntries={clientTimeEntries}
            onNavigateToInvoicing={() => handleTabChange("invoicing")}
          />
        )}

        {activeTab === "projects" && (
          <ProjectsTab projects={projects || []} clientId={id} />
        )}

        {activeTab === "time" && (
          <TimeEntriesTab
            timeEntries={clientTimeEntries}
            projects={projects || []}
            clientId={id}
          />
        )}

        {activeTab === "invoicing" && (
          <InvoicingTab
            clientId={id}
            clientName={client.name}
            clientEmail={client.email}
            timeEntries={clientTimeEntries}
          />
        )}

        {activeTab === "prepaid" && (
          <PrepaidTab packages={prepaidPackages || []} clientId={id} />
        )}

        {activeTab === "approvals" && <ApprovalsTab clientId={id} />}

        {activeTab === "portal" && <PortalTab clientId={id} />}

        {activeTab === "history" && <HistoryTab clientId={id} />}
      </div>

      {/* Team access section — only rendered for org admin/owner */}
      <TeamAccessSection clientId={id} />

      <ConfirmDialog
        isOpen={showArchiveConfirm}
        onClose={() => setShowArchiveConfirm(false)}
        onConfirm={async () => {
          try {
            await archiveMutation.mutateAsync({ id });
            setShowArchiveConfirm(false);
          } catch {
            // Fejlen vises af mutationens onError.
          }
        }}
        title={t("detail.archiveDialog.title")}
        description={t("detail.archiveDialog.description")}
        confirmLabel={t("detail.archiveDialog.confirm")}
        variant="warning"
        isLoading={archiveMutation.isPending}
      />
    </div>
  );
}

type ClientDetail = NonNullable<RouterOutputs["clients"]["getById"]>;
type ClientProject = RouterOutputs["projects"]["getByClient"][number];
type ClientTimeEntry = RouterOutputs["time"]["list"]["entries"][number];
type ClientPrepaidPackage = RouterOutputs["prepaid"]["list"][number];

// Overview Tab Component
function OverviewTab({
  client,
  clientId,
  totalHours,
  projectsCount,
  activePrepaid,
  totalPrepaidHours,
  timeEntries,
  onNavigateToInvoicing,
}: {
  client: ClientDetail;
  clientId: string;
  totalHours: number;
  totalRevenue: number;
  projectsCount: number;
  activePrepaid: number;
  totalPrepaidHours: number;
  timeEntries: ClientTimeEntry[];
  onNavigateToInvoicing: () => void;
}) {
  const t = useTranslations("clients");
  return (
    <div className="space-y-4">
      {/* Dashboard widgets - Revenue & Open Invoices */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ClientRevenueWidget
          timeEntries={timeEntries}
          onNavigateToInvoicing={onNavigateToInvoicing}
        />
        <OpenInvoicesWidget clientId={clientId} />
      </div>

      {/* Activity Feed & Quick Stats */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ClientActivityFeed clientId={clientId} timeEntries={timeEntries} />

        {/* Quick Stats */}
        <div className="space-y-4">
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
                  <FolderKanban className="h-5 w-5 text-tt-graa" />
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">
                    {projectsCount}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t("detail.overview.projects")}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                  <Clock className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">
                    {formatTime(totalHours)}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t("detail.overview.hoursTotal")}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                  <CreditCard className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">
                    {activePrepaid}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t("detail.overview.activePrepaid")}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
                  <Clock className="h-5 w-5 text-tt-graa" />
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">
                    {formatTime(totalPrepaidHours)}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t("detail.overview.prepaidHours")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contact Info */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {t("detail.overview.contactTitle")}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {client.email && (
            <div>
              <dt className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                <Mail className="h-4 w-4" />
                {t("detail.overview.email")}
              </dt>
              <dd>
                <a
                  href={`mailto:${client.email}`}
                  className="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                >
                  {client.email}
                </a>
              </dd>
            </div>
          )}

          {client.phone && (
            <div>
              <dt className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                <Phone className="h-4 w-4" />
                {t("detail.overview.phone")}
              </dt>
              <dd>
                <a
                  href={`tel:${client.phone}`}
                  className="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                >
                  {client.phone}
                </a>
              </dd>
            </div>
          )}

          {client.company && (
            <div>
              <dt className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                <Building2 className="h-4 w-4" />
                {t("detail.overview.company")}
              </dt>
              <dd className="text-gray-900 dark:text-white">
                {client.company}
              </dd>
            </div>
          )}

          {client.address && (
            <div>
              <dt className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                <MapPin className="h-4 w-4" />
                {t("detail.overview.address")}
              </dt>
              <dd className="text-gray-900 dark:text-white">
                {client.address}
              </dd>
            </div>
          )}

          {client.defaultHourlyRate && (
            <div>
              <dt className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                <DollarSign className="h-4 w-4" />
                {t("detail.overview.defaultRate")}
              </dt>
              <dd className="text-gray-900 dark:text-white">
                {t("detail.overview.rateValue", {
                  rate: client.defaultHourlyRate,
                })}
              </dd>
            </div>
          )}
        </dl>

        {client.notes && (
          <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">
              {t("detail.overview.notes")}
            </h3>
            <p className="whitespace-pre-wrap text-gray-900 dark:text-white">
              {client.notes}
            </p>
          </div>
        )}
      </div>

      {/* Planlagte timepriser + prishistorik */}
      <ScheduledRateChanges
        clientId={client.id}
        currentRate={client.defaultHourlyRate}
      />
      {client.defaultHourlyRate && <RateHistory clientId={client.id} />}
    </div>
  );
}

// Projects Tab Component
function ProjectsTab({
  projects,
  clientId,
}: {
  projects: ClientProject[];
  clientId: string;
}) {
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkMode, setBulkMode] = useState(false);
  const utils = trpc.useUtils();

  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const bulkArchiveMutation = trpc.projects.bulkArchive.useMutation({
    onSuccess: (data) => {
      toast.success(
        t("detail.projectsTab.bulkArchived", { count: data.count }),
      );
      utils.projects.getByClient.invalidate({ clientId });
      setSelectedProjectIds(new Set());
      setBulkMode(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkDeleteMutation = trpc.projects.bulkPermanentDelete.useMutation({
    onSuccess: (data) => {
      toast.success(t("detail.projectsTab.bulkDeleted", { count: data.count }));
      utils.projects.getByClient.invalidate({ clientId });
      setSelectedProjectIds(new Set());
      setBulkMode(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const [bulkConfirm, setBulkConfirm] = useState<"archive" | "delete" | null>(
    null,
  );

  const allSelected =
    projects.length > 0 && selectedProjectIds.size === projects.length;

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
        <FolderKanban className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600" />
        <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
          {t("detail.projectsTab.empty")}
        </p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("detail.projectsTab.emptyHint")}
        </p>
        <Link
          href={`/dashboard/projects/new?clientId=${clientId}`}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
        >
          <Plus className="h-4 w-4" />
          {t("detail.projectsTab.create")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("detail.projectsTab.title", { count: projects.length })}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setBulkMode(!bulkMode);
              setSelectedProjectIds(new Set());
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {bulkMode ? tc("cancel") : t("detail.projectsTab.selectMore")}
          </button>
          <Link
            href={`/dashboard/projects/new?clientId=${clientId}`}
            className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            <Plus className="h-4 w-4" />
            {t("detail.projectsTab.newProject")}
          </Link>
        </div>
      </div>

      {bulkMode && selectedProjectIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {t("detail.projectsTab.selectedCount", {
              count: selectedProjectIds.size,
            })}
          </span>
          <button
            type="button"
            onClick={() => setBulkConfirm("archive")}
            disabled={bulkArchiveMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" />
            {t("detail.projectsTab.archive")}
          </button>
          <button
            type="button"
            onClick={() => setBulkConfirm("delete")}
            disabled={bulkDeleteMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("detail.projectsTab.deletePermanently")}
          </button>
          <button
            type="button"
            onClick={() => {
              if (allSelected) {
                setSelectedProjectIds(new Set());
              } else {
                setSelectedProjectIds(new Set(projects.map((p) => p.id)));
              }
            }}
            className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400"
          >
            {allSelected
              ? t("detail.projectsTab.deselectAll")
              : t("detail.projectsTab.selectAll")}
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={bulkConfirm !== null}
        onClose={() => setBulkConfirm(null)}
        onConfirm={() => {
          if (bulkConfirm === "archive") {
            bulkArchiveMutation.mutate({ ids: [...selectedProjectIds] });
          } else if (bulkConfirm === "delete") {
            bulkDeleteMutation.mutate({ ids: [...selectedProjectIds] });
          }
          setBulkConfirm(null);
        }}
        title={
          bulkConfirm === "delete"
            ? t("detail.projectsTab.deleteTitle")
            : t("detail.projectsTab.archiveTitle")
        }
        description={
          bulkConfirm === "delete"
            ? t("detail.projectsTab.deleteDescription", {
                count: selectedProjectIds.size,
              })
            : t("detail.projectsTab.archiveDescription", {
                count: selectedProjectIds.size,
              })
        }
        confirmLabel={
          bulkConfirm === "delete"
            ? t("detail.projectsTab.deletePermanently")
            : t("detail.projectsTab.archive")
        }
        variant={bulkConfirm === "delete" ? "danger" : "warning"}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {projects.map((project) =>
          bulkMode ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: række-klik er musegenvej; afkrydsningsboksen i rækken er tastaturvejen
            // biome-ignore lint/a11y/useKeyWithClickEvents: række-klik er musegenvej; afkrydsningsboksen i rækken er tastaturvejen
            <div
              key={project.id}
              onClick={() => toggleProjectSelection(project.id)}
              className={`cursor-pointer flex flex-col gap-3 rounded-lg border p-4 transition-colors ${
                selectedProjectIds.has(project.id)
                  ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys"
                  : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedProjectIds.has(project.id)}
                    onChange={() => toggleProjectSelection(project.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={project.name}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400"
                  />
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
                    <FolderKanban className="h-5 w-5 text-tt-graa" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {project.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 capitalize">
                      {t.has(`detail.projectStatus.${project.status}`)
                        ? t(`detail.projectStatus.${project.status}`)
                        : project.status}
                    </p>
                  </div>
                </div>
              </div>

              {project.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                  {project.description}
                </p>
              )}

              <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 pt-3">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t("detail.projectsTab.price")}
                </span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {project.hourlyRate
                    ? t("detail.projectsTab.hourlyRate", {
                        rate: project.hourlyRate,
                      })
                    : project.fixedPrice
                      ? t("detail.projectsTab.fixedPrice", {
                          price: project.fixedPrice,
                        })
                      : t("detail.projectsTab.noPrice")}
                </span>
              </div>
            </div>
          ) : (
            <Link
              key={project.id}
              href={`/dashboard/projects/${project.id}`}
              className="flex flex-col gap-3 rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
                    <FolderKanban className="h-5 w-5 text-tt-graa" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {project.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 capitalize">
                      {t.has(`detail.projectStatus.${project.status}`)
                        ? t(`detail.projectStatus.${project.status}`)
                        : project.status}
                    </p>
                  </div>
                </div>
              </div>

              {project.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                  {project.description}
                </p>
              )}

              <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 pt-3">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t("detail.projectsTab.price")}
                </span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {project.hourlyRate
                    ? t("detail.projectsTab.hourlyRate", {
                        rate: project.hourlyRate,
                      })
                    : project.fixedPrice
                      ? t("detail.projectsTab.fixedPrice", {
                          price: project.fixedPrice,
                        })
                      : t("detail.projectsTab.noPrice")}
                </span>
              </div>
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

// Time Entries Tab Component
function TimeEntriesTab({
  timeEntries,
  clientId,
}: {
  timeEntries: ClientTimeEntry[];
  projects: ClientProject[];
  clientId: string;
}) {
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [filter, setFilter] = useState<"all" | "prepaid" | "billable">("all");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [duplicatingEntryId, setDuplicatingEntryId] = useState<string | null>(
    null,
  );
  const [duplicateDate, setDuplicateDate] = useState<string>(() =>
    toLocalDateStr(new Date()),
  );
  const [deleteConfirmEntry, setDeleteConfirmEntry] = useState<string | null>(
    null,
  );
  const [showQuickEntry, setShowQuickEntry] = useState(false);

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  const utils = trpc.useUtils();

  const deleteMutation = trpc.time.delete.useMutation({
    onSuccess: () => {
      toast.success(t("detail.timeTab.deleted"));
      utils.time.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("detail.timeTab.deleteFailed"));
    },
  });

  const duplicateMutation = trpc.time.duplicate.useMutation({
    onSuccess: () => {
      toast.success(t("detail.timeTab.duplicated"));
      utils.time.list.invalidate();
      setDuplicatingEntryId(null);
    },
    onError: (error) => {
      toast.error(error.message || t("detail.timeTab.duplicateFailed"));
    },
  });

  const bulkDeleteMutation = trpc.time.bulkDelete.useMutation({
    onSuccess: (result) => {
      toast.success(t("detail.timeTab.bulkDeleted", { count: result.count }));
      setSelectedIds(new Set());
      setShowBatchDeleteConfirm(false);
      utils.time.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("detail.timeTab.bulkDeleteFailed"));
    },
  });

  const bulkMarkBilledMutation = trpc.time.bulkMarkBilled.useMutation({
    onSuccess: (result) => {
      toast.success(t("detail.timeTab.bulkUpdated", { count: result.count }));
      setSelectedIds(new Set());
      utils.time.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("detail.timeTab.bulkUpdateFailed"));
    },
  });

  const bulkMarkBillableMutation = trpc.time.bulkMarkBillable.useMutation({
    onSuccess: (result) => {
      toast.success(t("detail.timeTab.bulkUpdated", { count: result.count }));
      setSelectedIds(new Set());
      utils.time.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("detail.timeTab.bulkUpdateFailed"));
    },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredEntries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEntries.map((e) => e.id)));
    }
  };

  const isBatchMode = selectedIds.size > 0;

  const handleDuplicate = (entryId: string) => {
    setDuplicatingEntryId(entryId);
    setDuplicateDate(toLocalDateStr(new Date()));
  };

  const confirmDuplicate = () => {
    if (duplicatingEntryId) {
      duplicateMutation.mutate({
        id: duplicatingEntryId,
        newDate: duplicateDate,
      });
    }
  };

  const filteredEntries = timeEntries.filter((entry) => {
    if (filter === "prepaid") return entry.isPrepaid;
    if (filter === "billable") return !entry.isPrepaid && !entry.isBilled;
    return true;
  });

  if (timeEntries.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
        <Clock className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600" />
        <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
          {t("detail.timeTab.empty")}
        </p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("detail.timeTab.emptyHint")}
        </p>
      </div>
    );
  }

  const getTypeBadge = (entry: ClientTimeEntry) => {
    if (entry.isPrepaid) {
      return (
        <span className="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/30 px-2.5 py-0.5 text-xs font-medium text-orange-800 dark:text-orange-400">
          {t("detail.timeTab.badgePrepaid")}
        </span>
      );
    }
    if (entry.isBilled) {
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:text-green-400">
          {t("detail.timeTab.badgeBilled")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-brand-100 dark:bg-tt-gran-lys px-2.5 py-0.5 text-xs font-medium text-brand-800 dark:text-brand-400">
        {t("detail.timeTab.badgeBillable")}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("detail.timeTab.title", { count: filteredEntries.length })}
          </h2>
          <button
            type="button"
            onClick={() => setShowQuickEntry(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-tt-gran px-3 py-1.5 text-xs font-medium text-tt-paa-gran hover:bg-tt-gran-moerk transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("detail.timeTab.newShort")}
          </button>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-1">
          {[
            { value: "all", label: t("detail.timeTab.filterAll") },
            { value: "prepaid", label: t("detail.timeTab.filterPrepaid") },
            { value: "billable", label: t("detail.timeTab.filterBillable") },
          ].map((f) => (
            <button
              type="button"
              key={f.value}
              onClick={() => setFilter(f.value as typeof filter)}
              className={`rounded px-2 sm:px-3 py-1 text-xs sm:text-sm font-medium transition-colors ${
                filter === f.value
                  ? "bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-400 shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Batch actions toolbar */}
      {isBatchMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-600 dark:bg-tt-gran-lys">
          <span className="text-sm font-medium text-brand-700 dark:text-brand-300">
            {t("detail.timeTab.selectedCount", { count: selectedIds.size })}
          </span>
          <div className="mx-1 h-4 w-px bg-brand-300 dark:bg-brand-700" />
          <button
            type="button"
            onClick={() =>
              bulkMarkBilledMutation.mutate({
                ids: [...selectedIds],
                isBilled: true,
              })
            }
            disabled={bulkMarkBilledMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {t("detail.timeTab.markBilled")}
          </button>
          <button
            type="button"
            onClick={() =>
              bulkMarkBilledMutation.mutate({
                ids: [...selectedIds],
                isBilled: false,
              })
            }
            disabled={bulkMarkBilledMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Clock className="h-3.5 w-3.5" />
            {t("detail.timeTab.markUnbilled")}
          </button>
          <button
            type="button"
            onClick={() =>
              bulkMarkBillableMutation.mutate({
                ids: [...selectedIds],
                isBillable: true,
              })
            }
            disabled={bulkMarkBillableMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 dark:border-brand-700 dark:bg-transparent dark:text-brand-300 dark:hover:bg-tt-gran-lys"
          >
            <Coins className="h-3.5 w-3.5" />
            {t("detail.timeTab.markBillable")}
          </button>
          <button
            type="button"
            onClick={() =>
              bulkMarkBillableMutation.mutate({
                ids: [...selectedIds],
                isBillable: false,
              })
            }
            disabled={bulkMarkBillableMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Ban className="h-3.5 w-3.5" />
            {t("detail.timeTab.markNonBillable")}
          </button>
          <button
            type="button"
            onClick={() => setShowBatchDeleteConfirm(true)}
            disabled={bulkDeleteMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {tc("delete")}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {tc("cancel")}
          </button>
        </div>
      )}

      {/* Mobile card view */}
      <div className="space-y-3 md:hidden">
        {filteredEntries.map((entry) => (
          <div
            key={entry.id}
            className={`rounded-lg border bg-white dark:bg-gray-900 p-4 ${
              selectedIds.has(entry.id)
                ? "border-brand-400 bg-brand-50/50 dark:border-brand-600 dark:bg-tt-gran-lys"
                : "border-gray-200 dark:border-gray-700"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={selectedIds.has(entry.id)}
                  onChange={() => toggleSelect(entry.id)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {entry.description || t("detail.timeTab.noDescription")}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {entry.project?.name || t("detail.timeTab.noProject")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2">
                {getTypeBadge(entry)}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">
                {new Date(entry.date).toLocaleDateString(toIntlLocale(locale))}
              </span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {formatTime(entry.hours)}
              </span>
            </div>
            {/* Action buttons */}
            <div className="mt-3 flex items-center gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
              <button
                type="button"
                onClick={() => setEditingEntryId(entry.id)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Edit className="h-3.5 w-3.5" />
                {tc("edit")}
              </button>
              <button
                type="button"
                onClick={() => handleDuplicate(entry.id)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Copy className="h-3.5 w-3.5" />
                {t("detail.timeTab.duplicate")}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmEntry(entry.id)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-transparent px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tc("delete")}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={
                    filteredEntries.length > 0 &&
                    selectedIds.size === filteredEntries.length
                  }
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
                />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
                {t("detail.timeTab.colDate")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
                {t("detail.timeTab.colDescription")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
                {t("detail.timeTab.colProject")}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
                {t("detail.timeTab.colHours")}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
                {t("detail.timeTab.colType")}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
                {t("detail.timeTab.colActions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50 bg-white dark:bg-gray-900">
            {filteredEntries.map((entry) => (
              <tr
                key={entry.id}
                className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${
                  selectedIds.has(entry.id)
                    ? "bg-brand-50/50 dark:bg-tt-gran-lys"
                    : ""
                }`}
              >
                <td className="w-10 px-3 py-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(entry.id)}
                    onChange={() => toggleSelect(entry.id)}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
                  />
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-white">
                  {new Date(entry.date).toLocaleDateString(
                    toIntlLocale(locale),
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                  {entry.description || "-"}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                  {entry.project?.name || "-"}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium text-gray-900 dark:text-white">
                  {formatTime(entry.hours)}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                  {getTypeBadge(entry)}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingEntryId(entry.id)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white"
                      title={tc("edit")}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDuplicate(entry.id)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white"
                      title={t("detail.timeTab.duplicate")}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmEntry(entry.id)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300"
                      title={tc("delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editingEntryId && (
        <TimeEntryEditModal
          entryId={editingEntryId}
          isOpen={!!editingEntryId}
          onClose={() => setEditingEntryId(null)}
          onSuccess={() => {
            setEditingEntryId(null);
            utils.time.list.invalidate();
          }}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirmEntry}
        onClose={() => setDeleteConfirmEntry(null)}
        onConfirm={() => {
          if (deleteConfirmEntry) {
            deleteMutation.mutate({ id: deleteConfirmEntry });
            setDeleteConfirmEntry(null);
          }
        }}
        title={t("detail.timeTab.deleteTitle")}
        description={t("detail.timeTab.deleteDescription")}
        confirmLabel={tc("delete")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />

      {/* Batch Delete Confirmation */}
      <ConfirmDialog
        isOpen={showBatchDeleteConfirm}
        onClose={() => setShowBatchDeleteConfirm(false)}
        onConfirm={() => {
          bulkDeleteMutation.mutate({ ids: [...selectedIds] });
        }}
        title={t("detail.timeTab.batchDeleteTitle")}
        description={t("detail.timeTab.batchDeleteDescription", {
          count: selectedIds.size,
        })}
        confirmLabel={t("detail.timeTab.deleteAll")}
        variant="danger"
        isLoading={bulkDeleteMutation.isPending}
      />

      {/* Quick Time Entry Modal */}
      <QuickTimeEntryModal
        isOpen={showQuickEntry}
        onClose={() => setShowQuickEntry(false)}
        clientId={clientId}
      />

      {/* Duplicate Date Picker Modal */}
      {duplicatingEntryId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xl">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
              {t("detail.timeTab.duplicateTitle")}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {t("detail.timeTab.duplicateDate")}
            </p>
            <input
              type="date"
              value={duplicateDate}
              onChange={(e) => setDuplicateDate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            />
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDuplicatingEntryId(null)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {tc("cancel")}
              </button>
              <button
                type="button"
                onClick={confirmDuplicate}
                disabled={duplicateMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
              >
                {duplicateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("detail.timeTab.duplicating")}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    {t("detail.timeTab.duplicate")}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Prepaid Tab Component
function PrepaidTab({
  packages,
  clientId,
}: {
  packages: ClientPrepaidPackage[];
  clientId: string;
}) {
  const t = useTranslations("clients");
  if (packages.length === 0) {
    return (
      <div className="space-y-4">
        <AluntaMappingCard clientId={clientId} />
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
          <CreditCard className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600" />
          <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            {t("detail.prepaidTab.empty")}
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t("detail.prepaidTab.emptyHint")}
          </p>
          <Link
            href={`/dashboard/klippekort/new?clientId=${clientId}`}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            <Plus className="h-4 w-4" />
            {t("detail.prepaidTab.create")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AluntaMappingCard clientId={clientId} />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("detail.prepaidTab.title", { count: packages.length })}
        </h2>
        <Link
          href={`/dashboard/klippekort/new?clientId=${clientId}`}
          className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
        >
          <Plus className="h-4 w-4" />
          {t("detail.prepaidTab.new")}
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {packages.map((pkg) => {
          const remainingHours = parseFloat(pkg.remainingHours || "0");
          const totalHours = parseFloat(pkg.totalHours || "0");
          const percentage =
            totalHours > 0 ? (remainingHours / totalHours) * 100 : 0;

          return (
            <Link
              key={pkg.id}
              href={`/dashboard/klippekort/${pkg.id}`}
              className="flex flex-col gap-4 rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                    <CreditCard className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {pkg.name}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs text-gray-500 dark:text-gray-500">
                        {pkg.isActive
                          ? t("detail.prepaidTab.active")
                          : t("detail.prepaidTab.inactive")}
                      </p>
                      {pkg.aluntaMappingId && (
                        <span className="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-400">
                          {t("detail.prepaidTab.auto")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Klippekortets huller: brugte timer er udfyldt */}
              <KlippekortHuller
                totalHours={totalHours}
                remainingHours={remainingHours}
                showLabel
                tone={
                  !pkg.isActive
                    ? "inaktiv"
                    : remainingHours <= 0
                      ? "tom"
                      : percentage <= 25
                        ? "lav"
                        : "normal"
                }
              />

              <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 pt-3 text-sm">
                <span className="text-gray-600 dark:text-gray-400">
                  {t("detail.prepaidTab.value")}
                </span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatCurrency(pkg.totalValue)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// Portal Tab Component
function PortalTab({ clientId }: { clientId: string }) {
  const fid = useId();
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [accessType, setAccessType] = useState<"token" | "account">("token");
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>(
    undefined,
  );
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [showDeletePortalConfirm, setShowDeletePortalConfirm] = useState(false);

  const utils = trpc.useUtils();

  const { data: portalAccess, isLoading } =
    trpc.clientPortalAccess.getByClientId.useQuery({
      clientId,
    });

  const { data: portalUrl } = trpc.clientPortalAccess.getPortalUrl.useQuery(
    { accessId: portalAccess?.id || "" },
    { enabled: !!portalAccess?.id },
  );

  const { data: activityLogs } =
    trpc.clientPortalAccess.getActivityLog.useQuery(
      { accessId: portalAccess?.id || "", limit: 10 },
      { enabled: !!portalAccess?.id },
    );

  const createTokenMutation =
    trpc.clientPortalAccess.createTokenAccess.useMutation({
      onSuccess: (data) => {
        utils.clientPortalAccess.getByClientId.invalidate({ clientId });
        utils.clientPortalAccess.getPortalUrl.invalidate();
        toast.success(
          data.emailSent
            ? t("detail.portalTab.tokenCreatedSent")
            : t("detail.portalTab.tokenCreatedNoMail"),
        );
      },
      onError: (err) => {
        toast.error(err.message);
      },
    });

  const createAccountMutation =
    trpc.clientPortalAccess.createAccountAccess.useMutation({
      onSuccess: (data) => {
        utils.clientPortalAccess.getByClientId.invalidate({ clientId });
        utils.clientPortalAccess.getPortalUrl.invalidate();
        toast.success(
          data.emailSent
            ? t("detail.portalTab.accountCreatedSent")
            : t("detail.portalTab.accountCreatedNoMail"),
        );
        setNewEmail("");
        setNewPassword("");
      },
      onError: (err) => {
        toast.error(err.message);
      },
    });

  const regenerateTokenMutation =
    trpc.clientPortalAccess.regenerateToken.useMutation({
      onSuccess: () => {
        utils.clientPortalAccess.getByClientId.invalidate({ clientId });
        utils.clientPortalAccess.getPortalUrl.invalidate();
        toast.success(t("detail.portalTab.newLink"));
      },
      onError: (err) => {
        toast.error(err.message);
      },
    });

  const updatePermissionsMutation =
    trpc.clientPortalAccess.updatePermissions.useMutation({
      onSuccess: () => {
        utils.clientPortalAccess.getByClientId.invalidate({ clientId });
        toast.success(t("detail.portalTab.permissionsUpdated"));
      },
      onError: (err) => {
        toast.error(err.message);
      },
    });

  const deactivateMutation = trpc.clientPortalAccess.deactivate.useMutation({
    onSuccess: () => {
      utils.clientPortalAccess.getByClientId.invalidate({ clientId });
      toast.success(t("detail.portalTab.deactivated"));
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const reactivateMutation = trpc.clientPortalAccess.reactivate.useMutation({
    onSuccess: () => {
      utils.clientPortalAccess.getByClientId.invalidate({ clientId });
      toast.success(t("detail.portalTab.reactivated"));
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const deleteMutation = trpc.clientPortalAccess.delete.useMutation({
    onSuccess: () => {
      utils.clientPortalAccess.getByClientId.invalidate({ clientId });
      toast.success(t("detail.portalTab.deleted"));
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleCreateAccess = () => {
    if (accessType === "token") {
      createTokenMutation.mutate({
        clientId,
        expiresInDays,
      });
    } else {
      if (!newEmail || !newPassword) {
        toast.error(t("detail.portalTab.fillEmailPassword"));
        return;
      }
      if (newPassword.length < 8) {
        toast.error(t("detail.portalTab.passwordMin"));
        return;
      }
      createAccountMutation.mutate({
        clientId,
        email: newEmail,
        password: newPassword,
      });
    }
  };

  const copyPortalUrl = async () => {
    if (portalUrl?.url) {
      await navigator.clipboard.writeText(portalUrl.url);
      setCopiedUrl(true);
      toast.success(t("detail.portalTab.linkCopied"));
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  // No access yet - show creation form
  if (!portalAccess) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            {t("detail.portalTab.giveAccess")}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            {t("detail.portalTab.giveAccessHint")}
          </p>

          {/* Access Type Selection */}
          <div className="mb-6">
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              {t("detail.portalTab.accessType")}
            </span>
            <div className="grid grid-cols-2 gap-2 sm:gap-4">
              <button
                type="button"
                onClick={() => setAccessType("token")}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-3 sm:p-4 transition-colors ${
                  accessType === "token"
                    ? "border-brand-600 bg-brand-50 dark:bg-tt-gran-lys"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                }`}
              >
                <LinkIcon
                  className={`h-8 w-8 ${accessType === "token" ? "text-brand-600" : "text-gray-400"}`}
                />
                <span
                  className={`font-medium ${accessType === "token" ? "text-brand-600" : "text-gray-700 dark:text-gray-300"}`}
                >
                  {t("detail.portalTab.typeLink")}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  {t("detail.portalTab.typeLinkHint")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setAccessType("account")}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                  accessType === "account"
                    ? "border-brand-600 bg-brand-50 dark:bg-tt-gran-lys"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                }`}
              >
                <User
                  className={`h-8 w-8 ${accessType === "account" ? "text-brand-600" : "text-gray-400"}`}
                />
                <span
                  className={`font-medium ${accessType === "account" ? "text-brand-600" : "text-gray-700 dark:text-gray-300"}`}
                >
                  {t("detail.portalTab.typeAccount")}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  {t("detail.portalTab.typeAccountHint")}
                </span>
              </button>
            </div>
          </div>

          {/* Token options */}
          {accessType === "token" && (
            <div className="mb-6">
              <label
                htmlFor={`${fid}-f1`}
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                {t("detail.portalTab.expiry")}
              </label>
              <select
                id={`${fid}-f1`}
                value={expiresInDays || ""}
                onChange={(e) =>
                  setExpiresInDays(
                    e.target.value ? parseInt(e.target.value, 10) : undefined,
                  )
                }
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              >
                <option value="">{t("detail.portalTab.expiryNever")}</option>
                <option value="7">
                  {t("detail.portalTab.expiryDays", { count: 7 })}
                </option>
                <option value="30">
                  {t("detail.portalTab.expiryDays", { count: 30 })}
                </option>
                <option value="90">
                  {t("detail.portalTab.expiryDays", { count: 90 })}
                </option>
                <option value="365">{t("detail.portalTab.expiryYear")}</option>
              </select>
            </div>
          )}

          {/* Account options */}
          {accessType === "account" && (
            <div className="space-y-4 mb-6">
              <div>
                <label
                  htmlFor={`${fid}-f2`}
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  {t("detail.portalTab.clientEmail")}
                </label>
                <input
                  id={`${fid}-f2`}
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={t("detail.portalTab.clientEmailPlaceholder")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
              <div>
                <label
                  htmlFor={`${fid}-f3`}
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  {t("detail.portalTab.password")}
                </label>
                <div className="relative">
                  <input
                    id={`${fid}-f3`}
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t("detail.portalTab.passwordPlaceholder")}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 pr-10 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword
                        ? t("detail.portalTab.hidePassword")
                        : t("detail.portalTab.showPassword")
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleCreateAccess}
            disabled={
              createTokenMutation.isPending || createAccountMutation.isPending
            }
            className="w-full rounded-lg bg-tt-gran px-4 py-2.5 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {createTokenMutation.isPending ||
            createAccountMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("detail.portalTab.creating")}
              </>
            ) : (
              <>
                <Globe className="h-4 w-4" />
                {t("detail.portalTab.createAccess")}
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Access exists - show management UI
  return (
    <div className="space-y-4">
      {/* Status and Actions */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  portalAccess.isActive
                    ? "bg-green-100 dark:bg-green-900/30"
                    : "bg-gray-100 dark:bg-gray-700"
                }`}
              >
                {portalAccess.accessType === "token" ? (
                  <LinkIcon
                    className={`h-5 w-5 ${portalAccess.isActive ? "text-green-600 dark:text-green-400" : "text-gray-400"}`}
                  />
                ) : (
                  <User
                    className={`h-5 w-5 ${portalAccess.isActive ? "text-green-600 dark:text-green-400" : "text-gray-400"}`}
                  />
                )}
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t("detail.portalTab.accessTitle")}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {portalAccess.accessType === "token"
                    ? t("detail.portalTab.linkBased")
                    : t("detail.portalTab.accountEmail", {
                        email: portalAccess.email ?? "",
                      })}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                portalAccess.isActive
                  ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
              }`}
            >
              {portalAccess.isActive
                ? t("detail.portalTab.statusActive")
                : t("detail.portalTab.statusInactive")}
            </span>
          </div>
        </div>

        {/* Portal URL */}
        {portalAccess.isActive && portalUrl?.url && (
          <div className="mb-6">
            <label
              htmlFor={`${fid}-f4`}
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              {t("detail.portalTab.portalLink")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`${fid}-f4`}
                type="text"
                value={portalUrl.url}
                readOnly
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={copyPortalUrl}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {copiedUrl ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
              <a
                href={portalUrl.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            {portalAccess.tokenExpiresAt && (
              <p className="mt-2 text-xs text-gray-500">
                {t("detail.portalTab.expires", {
                  date: new Date(
                    portalAccess.tokenExpiresAt,
                  ).toLocaleDateString(toIntlLocale(locale)),
                })}
              </p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {portalAccess.accessType === "token" && portalAccess.isActive && (
            <button
              type="button"
              onClick={() =>
                regenerateTokenMutation.mutate({ accessId: portalAccess.id })
              }
              disabled={regenerateTokenMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <RefreshCw
                className={`h-4 w-4 ${regenerateTokenMutation.isPending ? "animate-spin" : ""}`}
              />
              {t("detail.portalTab.regenerate")}
            </button>
          )}

          {portalAccess.isActive ? (
            <button
              type="button"
              onClick={() =>
                deactivateMutation.mutate({ accessId: portalAccess.id })
              }
              disabled={deactivateMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-orange-300 dark:border-orange-800 bg-white dark:bg-transparent px-3 py-2 text-sm font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"
            >
              <Shield className="h-4 w-4" />
              {t("detail.portalTab.deactivate")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                reactivateMutation.mutate({ accessId: portalAccess.id })
              }
              disabled={reactivateMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-green-300 dark:border-green-800 bg-white dark:bg-transparent px-3 py-2 text-sm font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
            >
              <Check className="h-4 w-4" />
              {t("detail.portalTab.activate")}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowDeletePortalConfirm(true)}
            disabled={deleteMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-transparent px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-4 w-4" />
            {tc("delete")}
          </button>
        </div>
      </div>

      {/* Permissions */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
          {t("detail.portalTab.permissions")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              key: "canViewInvoices",
              label: t("detail.portalTab.permViewInvoices"),
              icon: FileText,
            },
            {
              key: "canViewProjects",
              label: t("detail.portalTab.permViewProjects"),
              icon: FolderKanban,
            },
            {
              key: "canViewTimeEntries",
              label: t("detail.portalTab.permViewTime"),
              icon: Clock,
            },
            {
              key: "canViewPrepaid",
              label: t("detail.portalTab.permViewPrepaid"),
              icon: CreditCard,
            },
            {
              key: "canDownloadInvoices",
              label: t("detail.portalTab.permDownloadInvoices"),
              icon: FileText,
            },
            {
              key: "canApproveTime",
              label: t("detail.portalTab.permApproveTime"),
              icon: Check,
            },
          ].map((perm) => {
            const Icon = perm.icon;
            const isEnabled =
              portalAccess[perm.key as keyof typeof portalAccess];
            return (
              <label
                key={perm.key}
                className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                <input
                  type="checkbox"
                  checked={!!isEnabled}
                  onChange={(e) => {
                    updatePermissionsMutation.mutate({
                      accessId: portalAccess.id,
                      [perm.key]: e.target.checked,
                    });
                  }}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                />
                <Icon className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {perm.label}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Activity Log */}
      {activityLogs && activityLogs.length > 0 && (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            {t("detail.portalTab.recentActivity")}
          </h3>
          <div className="space-y-3">
            {activityLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                    {log.action === "login" && (
                      <Key className="h-4 w-4 text-green-600 dark:text-green-400" />
                    )}
                    {log.action === "view_invoices" && (
                      <FileText className="h-4 w-4 text-tt-graa" />
                    )}
                    {log.action === "view_projects" && (
                      <FolderKanban className="h-4 w-4 text-tt-graa" />
                    )}
                    {log.action === "view_time_entries" && (
                      <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                    )}
                    {log.action === "view_prepaid" && (
                      <CreditCard className="h-4 w-4 text-tt-graa" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-gray-900 dark:text-white capitalize">
                      {t.has(`detail.portalTab.action.${log.action}`)
                        ? t(`detail.portalTab.action.${log.action}`)
                        : log.action.replace(/_/g, " ")}
                    </p>
                    {log.entityName && (
                      <p className="text-xs text-gray-500">{log.entityName}</p>
                    )}
                  </div>
                </div>
                <span className="text-xs text-gray-500">
                  {new Date(log.createdAt).toLocaleString(toIntlLocale(locale))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("detail.portalTab.visits")}
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {portalAccess.accessCount || 0}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("detail.portalTab.created")}
          </p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {new Date(portalAccess.createdAt).toLocaleDateString(
              toIntlLocale(locale),
            )}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("detail.portalTab.lastVisited")}
          </p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {portalAccess.lastAccessedAt
              ? new Date(portalAccess.lastAccessedAt).toLocaleDateString(
                  toIntlLocale(locale),
                )
              : t("detail.portalTab.never")}
          </p>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeletePortalConfirm}
        onClose={() => setShowDeletePortalConfirm(false)}
        onConfirm={() => {
          deleteMutation.mutate({ accessId: portalAccess.id });
          setShowDeletePortalConfirm(false);
        }}
        title={t("detail.portalTab.deleteTitle")}
        description={t("detail.portalTab.deleteDescription")}
        confirmLabel={tc("delete")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

// Invoicing Tab Component
function InvoicingTab({
  clientId,
  clientName,
  clientEmail,
  timeEntries,
}: {
  clientId: string;
  clientName: string;
  clientEmail?: string | null;
  timeEntries: ClientTimeEntry[];
}) {
  const t = useTranslations("clients");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSlideOverOpen, setIsSlideOverOpen] = useState(false);

  // Calculate totals for selected entries
  const selectedStats = useMemo(() => {
    const unbilledEntries = timeEntries.filter(
      (entry) => entry.isBillable && !entry.isBilled && !entry.isPrepaid,
    );
    const selectedEntries = unbilledEntries.filter((e) =>
      selectedIds.includes(e.id),
    );
    const totalHours = selectedEntries.reduce(
      (sum, e) => sum + parseFloat(e.hours || "0"),
      0,
    );
    const totalValue = selectedEntries.reduce((sum, e) => {
      const hours = parseFloat(e.hours || "0");
      const rate = parseFloat(e.billableRate || "0");
      return sum + hours * rate;
    }, 0);

    return {
      count: selectedEntries.length,
      totalHours,
      totalValue,
    };
  }, [selectedIds, timeEntries]);

  const handleCreateInvoice = () => {
    if (selectedIds.length === 0) {
      toast.error(t("createInvoice.selectEntries"));
      return;
    }
    setIsSlideOverOpen(true);
  };

  const handleSuccess = () => {
    setSelectedIds([]);
  };

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("detail.invoicingTab.title")}
        </h2>

        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={handleCreateInvoice}
            className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            <FileText className="h-4 w-4" />
            {t("detail.invoicingTab.create", { count: selectedIds.length })}
          </button>
        )}
      </div>

      {/* Gentagne fakturaer / retainere for kunden (#198) */}
      <RecurringInvoicesPanel clientId={clientId} />

      {/* Unbilled entries table */}
      <UnbilledEntriesTable
        entries={timeEntries}
        onSelectionChange={setSelectedIds}
        selectedIds={selectedIds}
      />

      {/* Create Invoice Slide-over */}
      <CreateInvoiceSlideOver
        isOpen={isSlideOverOpen}
        onClose={() => setIsSlideOverOpen(false)}
        clientId={clientId}
        clientName={clientName}
        clientEmail={clientEmail}
        selectedEntryIds={selectedIds}
        totalHours={selectedStats.totalHours}
        totalValue={selectedStats.totalValue}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

// History Tab Component
function HistoryTab({ clientId }: { clientId: string }) {
  const t = useTranslations("clients");
  const locale = useLocale();
  const [filter, setFilter] = useState<"all" | "time" | "invoices" | "changes">(
    "all",
  );

  const { data: allTimeEntries } = trpc.time.list.useQuery({
    forClientId: clientId,
    limit: 1000,
  });
  const { data: invoices } = trpc.invoices.list.useQuery({
    clientId,
    limit: 200,
  });
  const { data: projects } = trpc.projects.getByClient.useQuery({ clientId });
  const { data: rateHistory } = trpc.rateHistory.getClientHistory.useQuery({
    clientId,
  });

  // Filter time entries for this client
  const projectIds = projects?.map((p) => p.id) || [];
  const clientTimeEntries =
    allTimeEntries?.entries?.filter(
      (entry) =>
        (entry.projectId && projectIds.includes(entry.projectId)) ||
        entry.clientId === clientId,
    ) || [];

  // Filter invoices for this client
  const clientInvoices =
    invoices?.filter((inv) => inv.clientId === clientId) || [];

  // Build activity items
  const activities = useMemo(() => {
    const items: Array<{
      id: string;
      type:
        | "time"
        | "invoice"
        | "rate_change"
        | "invoice_paid"
        | "invoice_sent";
      date: Date;
      title: string;
      description?: string;
      value?: number;
      icon: React.ElementType;
      iconBg: string;
      iconColor: string;
    }> = [];

    // Add time entries
    for (const entry of clientTimeEntries) {
      const hours = parseFloat(entry.hours || "0");
      const rate = parseFloat(entry.billableRate || "0");

      const entryProject = Array.isArray(entry.project)
        ? entry.project[0]
        : entry.project;
      items.push({
        id: `time-${entry.id}`,
        type: "time",
        date: new Date(entry.date),
        title: entry.description || t("detail.history.timeEntry"),
        description: entryProject?.name || t("detail.history.noProject"),
        value: entry.isBillable && !entry.isPrepaid ? hours * rate : undefined,
        icon: Clock,
        iconBg: entry.isPrepaid
          ? "bg-orange-100 dark:bg-orange-900/30"
          : "bg-brand-100 dark:bg-tt-gran-lys",
        iconColor: entry.isPrepaid
          ? "text-orange-600 dark:text-orange-400"
          : "text-brand-600 dark:text-brand-400",
      });
    }

    // Add invoice events
    for (const invoice of clientInvoices) {
      // Invoice created
      items.push({
        id: `invoice-created-${invoice.id}`,
        type: "invoice",
        date: new Date(invoice.createdAt),
        title: t("detail.history.invoiceCreated", {
          number: invoice.invoiceNumber,
        }),
        description:
          invoice.status === "draft"
            ? t("detail.history.statusDraft")
            : invoice.status === "sent"
              ? t("detail.history.statusSent")
              : invoice.status === "paid"
                ? t("detail.history.statusPaid")
                : t("detail.history.statusOverdue"),
        value: parseFloat(invoice.amount || "0"),
        icon: FileText,
        iconBg: "bg-tt-flade",
        iconColor: "text-tt-graa",
      });

      // Invoice sent
      if (invoice.status !== "draft" && invoice.issueDate) {
        items.push({
          id: `invoice-sent-${invoice.id}`,
          type: "invoice_sent",
          date: new Date(invoice.issueDate),
          title: t("detail.history.invoiceSent", {
            number: invoice.invoiceNumber,
          }),
          value: parseFloat(invoice.amount || "0"),
          icon: Send,
          iconBg: "bg-tt-flade",
          iconColor: "text-tt-graa",
        });
      }

      // Invoice paid
      if (invoice.status === "paid" && invoice.paidDate) {
        items.push({
          id: `invoice-paid-${invoice.id}`,
          type: "invoice_paid",
          date: new Date(invoice.paidDate),
          title: t("detail.history.invoicePaid", {
            number: invoice.invoiceNumber,
          }),
          value: parseFloat(invoice.amount || "0"),
          icon: Check,
          iconBg: "bg-green-100 dark:bg-green-900/30",
          iconColor: "text-green-600 dark:text-green-400",
        });
      }
    }

    // Add rate changes
    if (rateHistory) {
      for (const change of rateHistory) {
        items.push({
          id: `rate-${change.id}`,
          type: "rate_change",
          date: new Date(change.createdAt),
          title: t("detail.history.rateChanged", { rate: change.newRate }),
          description:
            change.reason ||
            t("detail.history.rateFrom", { rate: change.oldRate || 0 }),
          icon: DollarSign,
          iconBg: "bg-amber-100 dark:bg-amber-900/30",
          iconColor: "text-amber-600 dark:text-amber-400",
        });
      }
    }

    // Filter by type
    const filtered = items.filter((item) => {
      if (filter === "all") return true;
      if (filter === "time") return item.type === "time";
      if (filter === "invoices")
        return (
          item.type === "invoice" ||
          item.type === "invoice_sent" ||
          item.type === "invoice_paid"
        );
      if (filter === "changes") return item.type === "rate_change";
      return true;
    });

    // Sort by date (newest first)
    return filtered.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [clientTimeEntries, clientInvoices, rateHistory, filter, t]);

  // Group activities by month
  const groupedActivities = useMemo(() => {
    const groups: Map<string, typeof activities> = new Map();

    for (const activity of activities) {
      const monthKey = activity.date.toLocaleDateString(toIntlLocale(locale), {
        year: "numeric",
        month: "long",
      });

      if (!groups.has(monthKey)) {
        groups.set(monthKey, []);
      }
      groups.get(monthKey)?.push(activity);
    }

    return Array.from(groups.entries());
  }, [activities, locale]);

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-1 w-fit">
        {[
          { value: "all", label: t("detail.history.filterAll") },
          { value: "time", label: t("detail.history.filterTime") },
          { value: "invoices", label: t("detail.history.filterInvoices") },
          { value: "changes", label: t("detail.history.filterChanges") },
        ].map((f) => (
          <button
            type="button"
            key={f.value}
            onClick={() => setFilter(f.value as typeof filter)}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value
                ? "bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-400 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Activity list */}
      {activities.length === 0 ? (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
          <History className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600" />
          <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            {t("detail.history.empty")}
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t("detail.history.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedActivities.map(([month, monthActivities]) => (
            <div key={month}>
              {/* Month header */}
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                {month}
              </h3>

              {/* Activities for this month */}
              <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800/50">
                {monthActivities.map((activity) => {
                  const Icon = activity.icon;

                  return (
                    <div
                      key={activity.id}
                      className="flex items-start gap-4 p-4"
                    >
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full flex-shrink-0 ${activity.iconBg}`}
                      >
                        <Icon className={`h-5 w-5 ${activity.iconColor}`} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {activity.title}
                            </p>
                            {activity.description && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {activity.description}
                              </p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            {activity.value !== undefined && (
                              <p className="text-sm font-medium text-gray-900 dark:text-white">
                                {formatCurrency(activity.value)}
                              </p>
                            )}
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {activity.date.toLocaleDateString(
                                toIntlLocale(locale),
                                {
                                  day: "numeric",
                                  month: "short",
                                },
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Team Access Section — per-client member access control
function TeamAccessSection({ clientId }: { clientId: string }) {
  const t = useTranslations("clients");
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const utils = trpc.useUtils();

  // Only fetch if we have an active org
  const { data: memberAccess, isLoading } =
    trpc.clientAccess.listForClient.useQuery(
      { clientId },
      { enabled: !!activeOrg?.id, retry: false },
    );

  const setAccessMutation = trpc.clientAccess.setAccess.useMutation({
    onSuccess: () => {
      utils.clientAccess.listForClient.invalidate({ clientId });
      toast.success(t("detail.teamAccess.updated"));
    },
    onError: (error) => {
      toast.error(t("detail.teamAccess.updateFailed"), {
        description: error.message,
      });
    },
  });

  // Don't render if no org context or query failed (non-admin)
  if (!activeOrg?.id || !memberAccess || memberAccess.length === 0) return null;

  // Check if current user is admin/owner
  const currentMember = memberAccess.find(
    (m) => m.userId === session?.user?.id,
  );
  if (
    !currentMember ||
    (currentMember.role !== "owner" && currentMember.role !== "admin")
  ) {
    return null;
  }

  const handleAccessChange = (memberId: string, value: string) => {
    setAccessMutation.mutate({
      memberId,
      clientId,
      accessLevel: value === "none" ? null : (value as "view" | "manage"),
    });
  };

  return (
    <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("detail.teamAccess.title")}
          </h3>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("detail.teamAccess.description")}
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              {t("detail.teamAccess.title")}
            </caption>
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="pb-3 text-left font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.teamAccess.member")}
                </th>
                <th className="hidden pb-3 text-left font-medium text-gray-500 dark:text-gray-400 sm:table-cell">
                  {t("detail.teamAccess.role")}
                </th>
                <th className="pb-3 text-left font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.teamAccess.accessLevel")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50/50">
              {memberAccess.map((member) => {
                const isPrivileged =
                  member.role === "owner" || member.role === "admin";
                const roleLabel =
                  member.role === "owner"
                    ? t("detail.teamAccess.roleOwner")
                    : member.role === "admin"
                      ? t("detail.teamAccess.roleAdmin")
                      : t("detail.teamAccess.roleMember");

                return (
                  <tr key={member.memberId}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        {member.userImage ? (
                          // biome-ignore lint/performance/noImgElement: avatar fra OAuth-udbyderens URL, ikke i next/image remotePatterns
                          <img
                            src={member.userImage}
                            alt=""
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300">
                            {(member.userName ?? "?").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="truncate max-w-[150px] font-medium text-gray-900 dark:text-white">
                          {member.userName ?? t("detail.teamAccess.unknown")}
                        </span>
                      </div>
                    </td>
                    <td className="hidden py-3 pr-4 sm:table-cell">
                      <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                        {roleLabel}
                      </span>
                    </td>
                    <td className="py-3">
                      {isPrivileged ? (
                        <div className="flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500">
                          <Lock className="h-3.5 w-3.5" />
                          <span>{t("detail.teamAccess.fullAccess")}</span>
                        </div>
                      ) : (
                        <select
                          value={member.accessLevel ?? "none"}
                          aria-label={t("detail.teamAccess.accessFor", {
                            name:
                              member.userName ??
                              t("detail.teamAccess.memberFallback"),
                          })}
                          onChange={(e) =>
                            handleAccessChange(member.memberId, e.target.value)
                          }
                          disabled={setAccessMutation.isPending}
                          className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:focus:ring-brand-400 dark:focus:border-brand-400 disabled:opacity-50"
                        >
                          <option value="none">
                            {t("detail.teamAccess.none")}
                          </option>
                          <option value="view">
                            {t("detail.teamAccess.view")}
                          </option>
                          <option value="manage">
                            {t("detail.teamAccess.manage")}
                          </option>
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
