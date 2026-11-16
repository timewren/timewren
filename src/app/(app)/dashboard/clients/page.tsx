"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  Eye,
  FileText,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PlanNote, planNoteClientLimit } from "@/components/billing/PlanNote";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleModuleGuard } from "@/components/RoleModuleGuard";
import { getClientAccent } from "@/components/tasks/client-accent";
import {
  Button,
  ClientsPageSkeleton,
  ConfirmDialog,
  ModuleDisabledState,
} from "@/components/ui";
import { useDebounce } from "@/hooks/useDebounce";
import { usePermission } from "@/hooks/usePermission";
import { usePlanGate } from "@/hooks/usePlanGate";
import { toIntlLocale } from "@/i18n/format-locale";
import { dkkFormatter } from "@/lib/format";
import { isModuleDisabledError } from "@/lib/modules/forbidden-error";
import type { RouterOutputs } from "@/lib/trpc/routers";
import { trpc } from "@/providers/trpc-provider";

type FilterTab = "all" | "active" | "unbilled" | "inactive" | "archived";
type SortMode =
  | "name-asc"
  | "name-desc"
  | "revenue-desc"
  | "hours-desc"
  | "projects-desc"
  | "activity-desc";

type Client = RouterOutputs["clients"]["listWithStats"][number];

function formatKr(amount: number): string {
  return dkkFormatter.format(amount);
}

function formatHours(hours: number, locale: string): string {
  return hours.toLocaleString(toIntlLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/* ------------------------------------------------------------------ */
/*  Stats strip                                                        */
/* ------------------------------------------------------------------ */
function StatsStrip({ clients }: { clients: Client[] }) {
  const t = useTranslations("clients");
  const locale = useLocale();
  const active = clients.filter((c) => !c.isArchived);

  const activeCount = active.length;
  const totalUnbilledAmount = active.reduce(
    (s, c) => s + c.stats.unbilledAmount,
    0,
  );
  const totalUnbilledHours = active.reduce(
    (s, c) => s + c.stats.unbilledHours,
    0,
  );
  const totalProjects = active.reduce((s, c) => s + c.stats.projectCount, 0);

  const stats = [
    {
      label: t("list.stats.activeClients"),
      value: String(activeCount),
      accent: false,
    },
    {
      label: t("list.stats.unbilled"),
      value: t("list.page.currencyShort", {
        amount: formatKr(totalUnbilledAmount),
      }),
      accent: totalUnbilledAmount > 0,
    },
    {
      label: t("list.stats.unbilledHours"),
      value: t("list.page.hoursShort", {
        value: formatHours(totalUnbilledHours, locale),
      }),
      accent: totalUnbilledHours > 0,
    },
    {
      label: t("list.stats.activeProjects"),
      value: String(totalProjects),
      accent: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-xl overflow-hidden border border-gray-200/80 dark:border-gray-800 bg-gray-200/80 dark:bg-gray-800">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex flex-col gap-1 bg-white dark:bg-gray-900 px-4 py-3 sm:px-5 sm:py-4"
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {s.label}
          </span>
          <span
            className={`text-lg sm:text-xl font-semibold tabular-nums ${
              s.accent
                ? "text-amber-600 dark:text-amber-400"
                : "text-gray-900 dark:text-white"
            }`}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pill filter tabs                                                    */
/* ------------------------------------------------------------------ */
function PillTabs({
  current,
  onChange,
  counts,
}: {
  current: FilterTab;
  onChange: (tab: FilterTab) => void;
  counts: Record<FilterTab, number>;
}) {
  const t = useTranslations("clients");
  const tabs: FilterTab[] = [
    "all",
    "active",
    "unbilled",
    "inactive",
    "archived",
  ];

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
      {tabs.map((tab) => {
        const isActive = current === tab;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            }`}
          >
            {t(`list.tabs.${tab}`)}
            <span
              className={`tabular-nums text-xs ${
                isActive
                  ? "text-gray-300 dark:text-gray-600"
                  : "text-gray-400 dark:text-gray-400"
              }`}
            >
              {counts[tab]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sort options                                                       */
/* ------------------------------------------------------------------ */
const SORT_OPTIONS: { value: SortMode; labelKey: string }[] = [
  { value: "name-asc", labelKey: "list.sort.nameAsc" },
  { value: "name-desc", labelKey: "list.sort.nameDesc" },
  { value: "revenue-desc", labelKey: "list.sort.revenue" },
  { value: "hours-desc", labelKey: "list.sort.hours" },
  { value: "projects-desc", labelKey: "list.sort.projects" },
  { value: "activity-desc", labelKey: "list.sort.activity" },
];

/* Grid templates — single source of truth for header + rows */
const GRID_COLS_MOBILE = "32px 1fr 90px 40px";
const GRID_COLS_DESKTOP = "32px 1fr 80px 80px 100px 100px 90px 40px";

/* ------------------------------------------------------------------ */
/*  Row action dropdown                                                */
/* ------------------------------------------------------------------ */
function RowMenu({
  client,
  isOpen,
  onToggle,
  onClose,
  onNavigate,
  onArchive,
  onUnarchive,
  canManage,
}: {
  client: Client;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onArchive: (c: Client) => void;
  onUnarchive: (id: string) => void;
  canManage: boolean;
}) {
  const t = useTranslations("clients");
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        aria-label={t("list.menu.open")}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300 transition-colors"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-20"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label={t("list.menu.close")}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-900 py-1 shadow-xl shadow-gray-200/50 dark:shadow-black/30"
          >
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNavigate(`/dashboard/clients/${client.id}`);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <Eye className="h-4 w-4" />
              {t("list.menu.details")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNavigate(`/dashboard/projects/new?clientId=${client.id}`);
                onClose();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <FolderPlus className="h-4 w-4" />
              {t("list.menu.newProject")}
            </button>
            {client.stats.unbilledHours > 0 && (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onNavigate(`/dashboard/clients/${client.id}?tab=invoicing`);
                  onClose();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-tt-gran-lys"
              >
                <FileText className="h-4 w-4" />
                {t("list.menu.newInvoice")}
              </button>
            )}
            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
            {canManage &&
              (client.isArchived ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onUnarchive(client.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
                >
                  <ArchiveRestore className="h-4 w-4" />
                  {t("list.menu.restore")}
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onArchive(client);
                    onClose();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Archive className="h-4 w-4" />
                  {t("list.menu.archive")}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */
function StatusBadge({ client }: { client: Client }) {
  const t = useTranslations("clients");
  if (client.isArchived)
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        {t("list.status.archived")}
      </span>
    );
  if (client.stats.overdueCount > 0)
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        {t("list.status.overdue", { count: client.stats.overdueCount })}
      </span>
    );
  if (client.stats.unbilledHours > 0)
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        {t("list.status.unbilled")}
      </span>
    );
  if (client.stats.activePrepaidCount > 0)
    return (
      <span className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400">
        {t("list.status.prepaid")}
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
      {t("list.status.active")}
    </span>
  );
}

/** Portal-badge (#95): ser freelanceren hvem der faktisk bruger portalen? */
function PortalBadge({ status }: { status: "active" | "invited" | null }) {
  const t = useTranslations("clients");
  if (!status) return null;
  if (status === "active") {
    return (
      <span
        title={t("list.portal.activeTitle")}
        className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400"
      >
        {t("list.portal.active")}
      </span>
    );
  }
  return (
    <span
      title={t("list.portal.invitedTitle")}
      className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-500 dark:border-gray-600 dark:text-gray-400"
    >
      {t("list.portal.invited")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page content                                                  */
/* ------------------------------------------------------------------ */
function ClientsPageContent() {
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWrite: canManage } = usePermission("clients");
  // Gratis: max 3 aktive kunder — vis forbruget roligt og luk "Tilføj" ved grænsen
  const planGate = usePlanGate();
  const clientLimitReached = !planGate.canAddClient;
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>(() => {
    const urlTab = searchParams.get("tab") as FilterTab | null;
    if (
      urlTab &&
      ["all", "active", "unbilled", "inactive", "archived"].includes(urlTab)
    )
      return urlTab;
    // Arkiverede kunder skal ikke fylde i listen — "Alle" er stadig ét klik væk
    return "active";
  });
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const urlSort = searchParams.get("sort") as SortMode | null;
    if (urlSort) return urlSort;
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("clients-sort-mode");
      if (saved) return saved as SortMode;
    }
    return "name-asc";
  });
  const [archiveDialogClient, setArchiveDialogClient] = useState<Client | null>(
    null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkArchiveConfirm, setShowBulkArchiveConfirm] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Sync filters to URL
  const debouncedSearch = useDebounce(searchQuery, 300);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (sortMode !== "name-asc") params.set("sort", sortMode);
    if (filterTab !== "active") params.set("tab", filterTab);
    const paramStr = params.toString();
    const newUrl = paramStr
      ? `/dashboard/clients?${paramStr}`
      : "/dashboard/clients";
    router.replace(newUrl, { scroll: false });
  }, [debouncedSearch, sortMode, filterTab, router]);

  const handleSortModeChange = (mode: SortMode) => {
    setSortMode(mode);
    localStorage.setItem("clients-sort-mode", mode);
  };

  // Always fetch including archived — pill tabs handle filtering
  const {
    data: clients,
    isLoading,
    isError,
    error,
    refetch,
  } = trpc.clients.listWithStats.useQuery({
    includeArchived: true,
  });

  const archiveMutation = trpc.clients.archive.useMutation({
    onSuccess: () => {
      toast.success(t("list.toast.archived"));
      refetch();
      setOpenMenuId(null);
    },
    onError: (error) => {
      toast.error(error.message || t("list.toast.archiveFailed"));
    },
  });

  const bulkArchiveMutation = trpc.clients.bulkArchive.useMutation({
    onSuccess: (result) => {
      toast.success(t("list.toast.bulkArchived", { count: result.count }));
      setSelectedIds(new Set());
      setShowBulkArchiveConfirm(false);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || t("list.toast.bulkArchiveFailed"));
    },
  });

  const bulkDeleteMutation = trpc.clients.bulkDelete.useMutation({
    onSuccess: (result) => {
      toast.success(t("list.toast.bulkDeleted", { count: result.count }));
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
      setDeleteConfirmText("");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || t("list.toast.bulkDeleteFailed"));
    },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const unarchiveMutation = trpc.clients.unarchive.useMutation({
    onSuccess: () => {
      toast.success(t("list.toast.restored"));
      refetch();
      setOpenMenuId(null);
    },
    onError: (error) => {
      toast.error(error.message || t("list.toast.restoreFailed"));
    },
  });

  /* ---- Derived data ---- */

  // Tab counts (before search filter)
  const tabCounts = useMemo<Record<FilterTab, number>>(() => {
    if (!clients)
      return { all: 0, active: 0, unbilled: 0, inactive: 0, archived: 0 };
    const active = clients.filter((c) => !c.isArchived);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return {
      all: clients.length,
      active: active.length,
      unbilled: active.filter((c) => c.stats.unbilledHours > 0).length,
      inactive: active.filter((c) => {
        if (!c.stats.lastActivityDate) return true;
        return new Date(c.stats.lastActivityDate).getTime() < thirtyDaysAgo;
      }).length,
      archived: clients.filter((c) => c.isArchived).length,
    };
  }, [clients]);

  // Filter by tab + search + sort
  const displayClients = useMemo(() => {
    if (!clients) return undefined;

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const query = debouncedSearch.toLowerCase();

    return clients
      .filter((c) => {
        // tab filter
        switch (filterTab) {
          case "active":
            if (c.isArchived) return false;
            break;
          case "unbilled":
            if (c.isArchived || c.stats.unbilledHours <= 0) return false;
            break;
          case "inactive":
            if (c.isArchived) return false;
            if (
              c.stats.lastActivityDate &&
              new Date(c.stats.lastActivityDate).getTime() >= thirtyDaysAgo
            )
              return false;
            break;
          case "archived":
            if (!c.isArchived) return false;
            break;
          // "all" shows everything
        }
        // search filter
        return (
          c.name.toLowerCase().includes(query) ||
          c.email?.toLowerCase().includes(query) ||
          c.company?.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        switch (sortMode) {
          case "name-asc":
            return a.name.localeCompare(b.name, locale);
          case "name-desc":
            return b.name.localeCompare(a.name, locale);
          case "revenue-desc":
            return b.stats.unbilledAmount - a.stats.unbilledAmount;
          case "hours-desc":
            return b.stats.totalHours - a.stats.totalHours;
          case "projects-desc":
            return b.stats.projectCount - a.stats.projectCount;
          case "activity-desc": {
            const aDate = a.stats.lastActivityDate
              ? new Date(a.stats.lastActivityDate).getTime()
              : 0;
            const bDate = b.stats.lastActivityDate
              ? new Date(b.stats.lastActivityDate).getTime()
              : 0;
            return bDate - aDate;
          }
          default:
            return 0;
        }
      });
  }, [clients, debouncedSearch, sortMode, filterTab, locale]);

  // Stable set of visible client IDs (avoids re-running effect on every render)
  const displayClientIds = useMemo(
    () => new Set(displayClients?.map((c) => c.id)),
    [displayClients],
  );

  // Drop stale selections when the visible set changes
  useEffect(() => {
    if (!displayClientIds) return;
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const pruned = new Set(
        [...prev].filter((id) => displayClientIds.has(id)),
      );
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [displayClientIds]);

  if (isLoading) {
    return <ClientsPageSkeleton />;
  }

  if (isError) {
    if (isModuleDisabledError(error)) {
      return <ModuleDisabledState />;
    }
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="mb-4 text-gray-500 dark:text-gray-400">
          {t("list.page.loadError")}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
        >
          {t("list.page.retry")}
        </button>
      </div>
    );
  }

  // Bulk-selection helpers
  const selectedClients = displayClients?.filter((c) => selectedIds.has(c.id));
  const selectedUnbilledTotal =
    selectedClients?.reduce(
      (sum, c) => sum + (c.stats.unbilledAmount || 0),
      0,
    ) ?? 0;
  const selectedProjectCount =
    selectedClients?.reduce((sum, c) => sum + (c.stats.projectCount || 0), 0) ??
    0;

  const allVisibleSelected =
    displayClients &&
    displayClients.length > 0 &&
    displayClients.every((c) => selectedIds.has(c.id));

  const toggleSelectAll = () => {
    if (!displayClients) return;
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayClients.map((c) => c.id)));
    }
  };

  return (
    <div className="space-y-4" data-tour="clients-list">
      {/* Header */}
      <PageHeader
        title={t("list.page.title")}
        description={t("list.page.description")}
        helpTopicId="clients"
        actions={
          <div className="flex shrink-0 items-center gap-3">
            {planGate.clientLimit !== null && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("list.page.limitUsage", {
                  active: planGate.activeClients,
                  limit: planGate.clientLimit,
                })}
              </span>
            )}
            {clientLimitReached ? (
              <Button
                disabled
                leftIcon={<Plus className="h-4 w-4 sm:h-5 sm:w-5" />}
              >
                <span className="xs:hidden">{t("list.page.addShort")}</span>
                <span className="hidden xs:inline">{t("list.page.add")}</span>
              </Button>
            ) : (
              <Link
                href="/dashboard/clients/new"
                className="shrink-0"
                data-tour="clients-add-btn"
                title={t("list.page.shortcut")}
                aria-keyshortcuts="n"
              >
                <Button leftIcon={<Plus className="h-4 w-4 sm:h-5 sm:w-5" />}>
                  <span className="xs:hidden">{t("list.page.addShort")}</span>
                  <span className="hidden xs:inline">{t("list.page.add")}</span>
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {clientLimitReached && (
        <PlanNote>{planNoteClientLimit(planGate.tier)}</PlanNote>
      )}

      {/* Stats strip */}
      {clients && clients.length > 0 && <StatsStrip clients={clients} />}

      {/* Pill filter tabs */}
      <PillTabs
        current={filterTab}
        onChange={setFilterTab}
        counts={tabCounts}
      />

      {/* Search + sort bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder={t("list.page.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={t("list.page.searchAria")}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 text-sm py-2 pl-9 pr-3 focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ArrowUpDown className="h-4 w-4 text-gray-400 dark:text-gray-500" />
          <select
            value={sortMode}
            onChange={(e) => handleSortModeChange(e.target.value as SortMode)}
            aria-label={t("list.page.sortAria")}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 px-2.5 py-2 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Batch actions toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 dark:border-brand-600 dark:bg-tt-gran-lys">
          <span className="text-sm font-medium text-brand-700 dark:text-brand-300">
            {t("list.page.selectedCount", { count: selectedIds.size })}
          </span>
          {canManage && (
            <>
              <div className="mx-1 h-4 w-px bg-brand-300 dark:bg-brand-700" />
              <button
                type="button"
                onClick={() => setShowBulkArchiveConfirm(true)}
                disabled={bulkArchiveMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <Archive className="h-3.5 w-3.5" />
                {t("list.page.archiveSelected")}
              </button>
              <button
                type="button"
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={bulkDeleteMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("list.page.deletePermanently")}
              </button>
            </>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {t("list.page.deselectAll")}
          </button>
        </div>
      )}

      {/* Table */}
      {!displayClients || displayClients.length === 0 ? (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
          <Users className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
          <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
            {searchQuery
              ? t("list.page.emptySearch")
              : filterTab !== "all"
                ? t("list.page.emptyCategory")
                : t("list.page.emptyNone")}
          </h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {searchQuery
              ? t("list.page.emptySearchHint")
              : t("list.page.emptyNoneHint")}
          </p>
          {!searchQuery && (filterTab === "active" || filterTab === "all") && (
            <Link
              href="/dashboard/clients/new"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
            >
              <Plus className="h-4 w-4" />
              {t("list.page.addFirst")}
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          {/* Responsive grid: mobile shows fewer columns, sm+ shows all */}
          <style>{`
            @media (min-width: 640px) {
              [data-grid-header], [data-grid-row] {
                grid-template-columns: ${GRID_COLS_DESKTOP} !important;
              }
            }
          `}</style>
          {/* Table header */}
          <div
            className="grid items-center gap-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
            style={{ gridTemplateColumns: GRID_COLS_MOBILE }}
            data-grid-header
          >
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={!!allVisibleSelected}
                onChange={toggleSelectAll}
                aria-label={
                  allVisibleSelected
                    ? t("list.page.deselectAll")
                    : t("list.page.selectAll")
                }
                className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
              />
            </div>
            <div>{t("list.page.colClient")}</div>
            <div className="hidden sm:block text-right">
              {t("list.page.colProjects")}
            </div>
            <div className="hidden sm:block text-right">
              {t("list.page.colHours")}
            </div>
            <div className="hidden sm:block text-right">
              {t("list.page.colUnbilled")}
            </div>
            <div className="hidden sm:block text-right">
              {t("list.page.colUnbilledHours")}
            </div>
            <div className="text-center">{t("list.page.colStatus")}</div>
            <div />
          </div>

          {/* Table rows */}
          {displayClients.map((client) => {
            const selected = selectedIds.has(client.id);
            return (
              <Link
                key={client.id}
                href={`/dashboard/clients/${client.id}`}
                className={`grid items-center gap-3 border-b border-gray-50 dark:border-gray-800/60 px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40 group ${
                  selected ? "bg-brand-50/50 dark:bg-tt-gran-lys" : ""
                } ${
                  client.stats.unbilledAmount > 5000
                    ? "border-l-[3px] border-l-amber-400 dark:border-l-amber-500"
                    : ""
                }`}
                style={{ gridTemplateColumns: GRID_COLS_MOBILE }}
                data-grid-row
              >
                {/* Checkbox */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation needed for checkbox within link */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation needed for checkbox within link */}
                <div
                  className="flex items-center justify-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleSelect(client.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={
                      selected
                        ? t("list.page.deselectClient")
                        : t("list.page.selectClient")
                    }
                    className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
                  />
                </div>

                {/* Client name + company */}
                <div className="flex items-center gap-3 min-w-0">
                  {/* Kundens farve som på opgavekortene (getClientAccent) */}
                  <ClientAvatar name={client.name} color={client.color} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                        {client.name}
                      </span>
                      <PortalBadge status={client.stats.portalStatus} />
                    </div>
                    {client.company && (
                      <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {client.company}
                      </div>
                    )}
                  </div>
                </div>

                {/* Projects */}
                <div className="hidden sm:block text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">
                  {client.stats.projectCount}
                </div>

                {/* Hours */}
                <div className="hidden sm:block text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">
                  {t("list.page.hoursShort", {
                    value: formatHours(client.stats.totalHours, locale),
                  })}
                </div>

                {/* Unbilled amount */}
                <div className="hidden sm:block text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">
                  {client.stats.unbilledAmount > 0
                    ? t("list.page.currencyShort", {
                        amount: formatKr(client.stats.unbilledAmount),
                      })
                    : "-"}
                </div>

                {/* Unbilled hours */}
                <div
                  className={`hidden sm:block text-right text-sm tabular-nums ${
                    client.stats.unbilledHours > 0
                      ? "text-amber-600 dark:text-amber-400 font-medium"
                      : "text-gray-400 dark:text-gray-400"
                  }`}
                >
                  {client.stats.unbilledHours > 0
                    ? t("list.page.hoursShort", {
                        value: formatHours(client.stats.unbilledHours, locale),
                      })
                    : "-"}
                </div>

                {/* Status */}
                <div className="flex justify-center">
                  <StatusBadge client={client} />
                </div>

                {/* Actions */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: prevent link nav when clicking menu */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: prevent link nav when clicking menu */}
                <div onClick={(e) => e.preventDefault()}>
                  <RowMenu
                    client={client}
                    isOpen={openMenuId === client.id}
                    onToggle={() =>
                      setOpenMenuId(openMenuId === client.id ? null : client.id)
                    }
                    onClose={() => setOpenMenuId(null)}
                    onNavigate={router.push}
                    onArchive={setArchiveDialogClient}
                    onUnarchive={(id) => unarchiveMutation.mutate({ id })}
                    canManage={canManage}
                  />
                </div>
              </Link>
            );
          })}

          {/* Footer count */}
          <div className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-900">
            {t.rich("list.page.footer", {
              count: displayClients.length,
              b: (chunks) => (
                <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                  {chunks}
                </span>
              ),
            })}
          </div>
        </div>
      )}

      {/* Archive Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!archiveDialogClient}
        onClose={() => setArchiveDialogClient(null)}
        onConfirm={() => {
          if (archiveDialogClient) {
            archiveMutation.mutate({ id: archiveDialogClient.id });
            setArchiveDialogClient(null);
          }
        }}
        title={t("list.archiveDialog.title")}
        description={t("list.archiveDialog.description", {
          name: archiveDialogClient?.name ?? "",
        })}
        confirmLabel={t("list.archiveDialog.confirm")}
        cancelLabel={tc("cancel")}
        variant="danger"
        isLoading={archiveMutation.isPending}
      />

      {/* Bulk Archive Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showBulkArchiveConfirm}
        onClose={() => setShowBulkArchiveConfirm(false)}
        onConfirm={() => {
          bulkArchiveMutation.mutate({ ids: [...selectedIds] });
        }}
        title={t("list.bulkArchive.title", { count: selectedIds.size })}
        description={
          <div className="space-y-3">
            <p>
              {t.rich("list.bulkArchive.intro", {
                count: selectedIds.size,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            {selectedClients && selectedClients.length > 0 && (
              <ul className="space-y-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-sm">
                {selectedClients.slice(0, 5).map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-medium">{c.name}</span>
                    {c.stats.unbilledAmount > 0 && (
                      <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">
                        {t("list.bulkArchive.unbilledShort", {
                          amount: formatKr(c.stats.unbilledAmount),
                        })}
                      </span>
                    )}
                  </li>
                ))}
                {selectedClients.length > 5 && (
                  <li className="pt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t("list.bulkArchive.andMore", {
                      count: selectedClients.length - 5,
                    })}
                  </li>
                )}
              </ul>
            )}
            {(selectedProjectCount > 0 || selectedUnbilledTotal > 0) && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                <strong>{t("list.bulkArchive.noteTitle")}</strong>
                <ul className="mt-1 ml-4 list-disc space-y-0.5">
                  {selectedProjectCount > 0 && (
                    <li>
                      {t("list.bulkArchive.projectsAffected", {
                        count: selectedProjectCount,
                      })}
                    </li>
                  )}
                  {selectedUnbilledTotal > 0 && (
                    <li>
                      {t("list.bulkArchive.unbilledTime", {
                        amount: formatKr(selectedUnbilledTotal),
                      })}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        }
        confirmLabel={t("list.bulkArchive.confirm", {
          count: selectedIds.size,
        })}
        cancelLabel={tc("cancel")}
        variant="danger"
        isLoading={bulkArchiveMutation.isPending}
      />

      {/* Bulk Delete (hard) Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showBulkDeleteConfirm}
        onClose={() => {
          setShowBulkDeleteConfirm(false);
          setDeleteConfirmText("");
        }}
        onConfirm={() => {
          if (deleteConfirmText === t("list.bulkDelete.confirmWord")) {
            bulkDeleteMutation.mutate({ ids: [...selectedIds] });
          }
        }}
        title={t("list.bulkDelete.title", { count: selectedIds.size })}
        description={
          <div className="space-y-3">
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
              {t.rich("list.bulkDelete.warning", {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </div>

            {selectedClients && selectedClients.length > 0 && (
              <ul className="space-y-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-sm">
                {selectedClients.slice(0, 5).map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-medium">{c.name}</span>
                    {c.stats.unbilledAmount > 0 && (
                      <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">
                        {t("list.bulkArchive.unbilledShort", {
                          amount: formatKr(c.stats.unbilledAmount),
                        })}
                      </span>
                    )}
                  </li>
                ))}
                {selectedClients.length > 5 && (
                  <li className="pt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t("list.bulkArchive.andMore", {
                      count: selectedClients.length - 5,
                    })}
                  </li>
                )}
              </ul>
            )}

            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <strong>{t("list.bulkDelete.alsoDeleted")}</strong>
              <ul className="mt-1 ml-4 list-disc space-y-0.5">
                <li>{t("list.bulkDelete.itemProjects")}</li>
                <li>{t("list.bulkDelete.itemEntries")}</li>
                <li>{t("list.bulkDelete.itemOther")}</li>
              </ul>
              <p className="mt-2 text-xs">
                {t("list.bulkDelete.invoicesNote")}
              </p>
            </div>

            <div>
              <label
                htmlFor="bulk-delete-confirm"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t.rich("list.bulkDelete.typeToConfirm", {
                  word: t("list.bulkDelete.confirmWord"),
                  code: (chunks) => (
                    <code className="font-mono text-red-600">{chunks}</code>
                  ),
                })}
              </label>
              <input
                id="bulk-delete-confirm"
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={t("list.bulkDelete.confirmWord")}
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono uppercase focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              />
            </div>
          </div>
        }
        confirmLabel={
          deleteConfirmText === t("list.bulkDelete.confirmWord")
            ? t("list.bulkDelete.confirm", { count: selectedIds.size })
            : t("list.bulkDelete.typeFirst", {
                word: t("list.bulkDelete.confirmWord"),
              })
        }
        cancelLabel={tc("cancel")}
        variant="danger"
        isLoading={bulkDeleteMutation.isPending}
        confirmDisabled={deleteConfirmText !== t("list.bulkDelete.confirmWord")}
      />
    </div>
  );
}

export default function ClientsPage() {
  return (
    <ModuleGuard module="clients">
      <RoleModuleGuard module="clients">
        <ClientsPageContent />
      </RoleModuleGuard>
    </ModuleGuard>
  );
}

function ClientAvatar({ name, color }: { name: string; color: string | null }) {
  const accent = color ? getClientAccent(color) : null;
  return (
    <div
      aria-hidden="true"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
        accent
          ? "bg-[var(--badge-bg-light)] text-[var(--badge-text-light)] dark:bg-[var(--badge-bg-dark)] dark:text-[var(--badge-text-dark)]"
          : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
      }`}
      style={
        accent
          ? ({
              "--badge-bg-light": accent.badgeBgLight,
              "--badge-text-light": accent.badgeTextLight,
              "--badge-bg-dark": accent.badgeBgDark,
              "--badge-text-dark": accent.badgeTextDark,
            } as CSSProperties)
          : undefined
      }
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
