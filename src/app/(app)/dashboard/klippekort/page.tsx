"use client";

import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckCircle,
  ChevronDown,
  Clock,
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { KlippekortExplainer } from "@/components/adoption/KlippekortExplainer";
import { PageHeader } from "@/components/dashboard-nav";
import {
  KlippekortHuller,
  type KlippekortTone,
} from "@/components/klippekort/KlippekortHuller";
import { RenewalRequestsBanner } from "@/components/klippekort/RenewalRequestsBanner";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleModuleGuard } from "@/components/RoleModuleGuard";
import { Button, ConfirmDialog } from "@/components/ui";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { usePermission } from "@/hooks/usePermission";
import { useRememberedState } from "@/hooks/useRememberedState";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency, formatTime } from "@/lib/format";
import { prepaidBalanceLevel } from "@/lib/prepaid/balance";
import {
  formatPrepaidExpiry,
  prepaidDaysUntilExpiry,
} from "@/lib/prepaid/expiry";
import { trpc } from "@/providers/trpc-provider";

type FilterTab =
  | "all"
  | "active"
  | "low-balance"
  | "expiring"
  | "depleted"
  | "archived";

const FILTER_TABS: { id: FilterTab }[] = [
  { id: "all" },
  { id: "active" },
  { id: "low-balance" },
  { id: "expiring" },
  { id: "depleted" },
  { id: "archived" },
];

const FILTER_TAB_IDS = FILTER_TABS.map((tab) => tab.id);

const SORT_OPTIONS = [
  "status",
  "remaining",
  "expiry",
  "client",
  "name",
] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

function getClientName(pkg: {
  client?: { name: string } | { name: string }[] | null;
}) {
  const c = pkg.client;
  if (!c) return "";
  return (Array.isArray(c) ? c[0] : c)?.name ?? "";
}

function KlippekortPageContent() {
  const t = useTranslations("klippekort");
  const locale = useLocale();
  // Fane og sortering huskes mellem besøg
  const [activeFilter, setActiveFilter] = useRememberedState<FilterTab>(
    "klippekort-filter",
    FILTER_TAB_IDS,
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useRememberedState<SortOption>(
    "klippekort-sort",
    SORT_OPTIONS,
    "status",
  );
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const { canWrite: canWriteKlippekort } = usePermission("klippekort");
  // Gratis/Privat kan se eksisterende klippekort, men ikke oprette/ændre
  const canManage = canWriteKlippekort;
  const menuRef = useRef<HTMLDivElement>(null);

  const {
    data: packages,
    isLoading,
    isError,
    refetch,
  } = trpc.prepaid.list.useQuery({
    includeArchived: true,
  });

  const toggleActiveMutation = trpc.prepaid.toggleActive.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("list.updated"));
    },
    onError: (error) => {
      toast.error(error.message || t("list.updateFailed"));
    },
  });
  const duplicateMutation = trpc.prepaid.duplicate.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("list.duplicated"));
    },
    onError: (error) => {
      toast.error(error.message || t("list.duplicateFailed"));
    },
  });
  const archiveMutation = trpc.prepaid.archive.useMutation({
    onSuccess: (data) => {
      refetch();
      toast.success(data.isArchived ? t("list.archived") : t("list.restored"));
    },
    onError: (error) => {
      toast.error(error.message || t("list.archiveFailed"));
    },
  });

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    if (openMenuId) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [openMenuId]);

  // Close menu on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenMenuId(null);
      }
    }
    if (openMenuId) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [openMenuId]);

  // Compute per-package derived values
  const enrichedPackages = useMemo(() => {
    if (!packages) return [];
    return packages.map((pkg) => {
      const totalHours = parseFloat(pkg.totalHours || "0");
      const usedHours = parseFloat(pkg.usedHours || "0");
      const remainingHours = parseFloat(pkg.remainingHours || "0");
      const hourlyRate = parseFloat(pkg.hourlyRate);
      const percentage = totalHours > 0 ? (usedHours / totalHours) * 100 : 0;
      const remainingValue = remainingHours * hourlyRate;

      const expiryDate = pkg.expiryDate ? new Date(pkg.expiryDate) : null;
      // Hele danske kalenderdage; 0 = udløber i dag (kortet gælder hele
      // udløbsdagen, #736), negativ = udløbet.
      const daysUntilExpiry = prepaidDaysUntilExpiry(expiryDate);
      const isExpiringSoon =
        daysUntilExpiry !== null &&
        daysUntilExpiry <= 14 &&
        daysUntilExpiry >= 0;
      const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;
      const isDepleted = remainingHours <= 0;
      // Samme grænse som resten af UI'et og lav-saldo-mailen (#881) — opbrugte
      // kort tælles som "depleted", ikke "lowBalance".
      const isLowBalance =
        !isDepleted && prepaidBalanceLevel(remainingHours, totalHours) !== "ok";

      return {
        ...pkg,
        totalHours,
        usedHours,
        remainingHours,
        hourlyRate,
        percentage,
        remainingValue,
        expiryDate,
        daysUntilExpiry,
        isExpiringSoon,
        isExpired,
        isLowBalance,
        isDepleted,
        clientName: getClientName(pkg),
      };
    });
  }, [packages]);

  // Compute stats
  const stats = useMemo(() => {
    const active = enrichedPackages.filter((p) => p.isActive && !p.isArchived);
    // Kort med skjult beløb tæller ikke med i restværdien; er alle skjult,
    // vises kortet slet ikke.
    const valueVisible = active.filter((p) => !p.hideValue);
    const totalRemainingValue = valueVisible.reduce(
      (sum, p) => sum + p.remainingValue,
      0,
    );
    const hideTotalValue = active.length > 0 && valueVisible.length === 0;
    const totalRemainingHours = active.reduce(
      (sum, p) => sum + p.remainingHours,
      0,
    );
    const lowBalanceCount = enrichedPackages.filter(
      (p) => p.isLowBalance && !p.isArchived,
    ).length;
    const expiringCount = enrichedPackages.filter(
      (p) => p.isExpiringSoon && !p.isArchived,
    ).length;

    return {
      activeCount: active.length,
      totalRemainingValue,
      hideTotalValue,
      totalRemainingHours,
      needsAttention: lowBalanceCount + expiringCount,
      lowBalanceCount,
      expiringCount,
    };
  }, [enrichedPackages]);

  // Filter counts
  const filterCounts = useMemo(() => {
    const counts: Record<FilterTab, number> = {
      all: enrichedPackages.filter((p) => !p.isArchived).length,
      active: enrichedPackages.filter(
        (p) => p.isActive && !p.isArchived && !p.isLowBalance && !p.isDepleted,
      ).length,
      "low-balance": enrichedPackages.filter(
        (p) => p.isLowBalance && !p.isArchived,
      ).length,
      expiring: enrichedPackages.filter(
        (p) => p.isExpiringSoon && !p.isArchived,
      ).length,
      depleted: enrichedPackages.filter((p) => p.isDepleted && !p.isArchived)
        .length,
      archived: enrichedPackages.filter((p) => p.isArchived).length,
    };
    return counts;
  }, [enrichedPackages]);

  // Filter + search + sort
  const filteredPackages = useMemo(() => {
    let result = enrichedPackages;

    // Tab filter
    switch (activeFilter) {
      case "all":
        result = result.filter((p) => !p.isArchived);
        break;
      case "active":
        result = result.filter(
          (p) =>
            p.isActive && !p.isArchived && !p.isLowBalance && !p.isDepleted,
        );
        break;
      case "low-balance":
        result = result.filter((p) => p.isLowBalance && !p.isArchived);
        break;
      case "expiring":
        result = result.filter((p) => p.isExpiringSoon && !p.isArchived);
        break;
      case "depleted":
        result = result.filter((p) => p.isDepleted && !p.isArchived);
        break;
      case "archived":
        result = result.filter((p) => p.isArchived);
        break;
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.clientName.toLowerCase().includes(q),
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "status": {
          const priority = (p: (typeof result)[0]) => {
            if (p.isDepleted) return 0;
            if (p.isLowBalance) return 1;
            if (p.isExpiringSoon) return 2;
            if (p.isArchived) return 4;
            return 3;
          };
          const diff = priority(a) - priority(b);
          if (diff !== 0) return diff;
          return a.remainingHours - b.remainingHours;
        }
        case "remaining":
          return a.remainingHours - b.remainingHours;
        case "expiry": {
          const aTime = a.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
          const bTime = b.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
          return aTime - bTime;
        }
        case "client":
          return a.clientName.localeCompare(b.clientName, locale);
        case "name":
          return a.name.localeCompare(b.name, locale);
        default:
          return 0;
      }
    });

    return result;
  }, [enrichedPackages, activeFilter, searchQuery, sortBy, locale]);

  // Samme tærskler som den tidligere bjælke: tom/90 % brugt = rød,
  // 75 % brugt eller lav saldo = gul.
  const getHulTone = (pkg: {
    percentage: number;
    isDepleted: boolean;
    isLowBalance: boolean;
  }): KlippekortTone => {
    if (pkg.isDepleted || pkg.percentage >= 90) return "tom";
    if (pkg.percentage >= 75 || pkg.isLowBalance) return "lav";
    return "normal";
  };

  const getBorderAccent = (pkg: {
    isDepleted: boolean;
    isLowBalance: boolean;
    isExpired: boolean;
    isExpiringSoon: boolean;
  }) => {
    if (pkg.isDepleted || pkg.isExpired)
      return "border-l-[3px] border-l-red-500";
    if (pkg.isLowBalance || pkg.isExpiringSoon)
      return "border-l-[3px] border-l-amber-500";
    return "";
  };

  const getStatusBadge = (pkg: {
    isArchived: boolean | null;
    isDepleted: boolean;
    isLowBalance: boolean;
    isExpiringSoon: boolean;
    isExpired: boolean;
    isActive: boolean | null;
  }) => {
    if (pkg.isArchived) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
          <Archive className="h-3 w-3" />
          {t("list.badgeArchived")}
        </span>
      );
    }
    if (pkg.isDepleted) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/20 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
          <XCircle className="h-3 w-3" />
          {t("list.badgeDepleted")}
        </span>
      );
    }
    if (pkg.isExpired) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/20 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
          <Clock className="h-3 w-3" />
          {t("list.badgeExpired")}
        </span>
      );
    }
    if (pkg.isLowBalance) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/20 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          {t("list.badgeLow")}
        </span>
      );
    }
    if (pkg.isExpiringSoon) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/20 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          <Clock className="h-3 w-3" />
          {t("list.badgeExpiring")}
        </span>
      );
    }
    if (pkg.isActive) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/20 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
          <CheckCircle className="h-3 w-3" />
          {t("list.badgeActive")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
        {t("list.badgeInactive")}
      </span>
    );
  };

  return (
    <div className="space-y-4" data-tour="klippekort-list">
      <RenewalRequestsBanner />
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        helpTopicId="klippekort"
        actions={
          canManage ? (
            <Link
              href="/dashboard/klippekort/new"
              className="shrink-0"
              data-tour="klippekort-add-btn"
              title={t("list.shortcut")}
              aria-keyshortcuts="n"
            >
              <Button leftIcon={<Plus className="h-4 w-4 sm:h-5 sm:w-5" />}>
                <span className="xs:hidden">{t("list.createShort")}</span>
                <span className="hidden xs:inline">{t("list.create")}</span>
              </Button>
            </Link>
          ) : null
        }
      />

      {isError && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="mb-4 text-gray-500 dark:text-gray-400">
            {t("list.loadError")}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            {t("list.retry")}
          </button>
        </div>
      )}

      {/* Stats Strip */}
      {!isLoading && !isError && packages && (
        <div
          className={`grid grid-cols-2 gap-px bg-gray-200 dark:bg-gray-800 rounded-xl overflow-hidden ${
            stats.hideTotalValue ? "lg:grid-cols-3" : "lg:grid-cols-4"
          }`}
        >
          <div className="bg-white dark:bg-gray-900 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("list.statActive")}
            </div>
            <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white mt-1">
              {stats.activeCount}
            </div>
          </div>
          {!stats.hideTotalValue && (
            <div className="bg-white dark:bg-gray-900 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("list.statValue")}
              </div>
              <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white mt-1">
                {formatCurrency(stats.totalRemainingValue)}
              </div>
            </div>
          )}
          <div className="bg-white dark:bg-gray-900 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("list.statHours")}
            </div>
            <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white mt-1">
              {formatTime(stats.totalRemainingHours)}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-900 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("list.statAttention")}
            </div>
            {/* Advarselsfarve kun når der faktisk er noget at gøre */}
            <div
              className={`text-2xl font-bold tabular-nums mt-1 ${
                stats.needsAttention > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-gray-900 dark:text-white"
              }`}
            >
              {stats.needsAttention}
            </div>
            {stats.needsAttention > 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {stats.lowBalanceCount > 0 &&
                  t("list.attentionLow", { count: stats.lowBalanceCount })}
                {stats.lowBalanceCount > 0 && stats.expiringCount > 0 && ", "}
                {stats.expiringCount > 0 &&
                  t("list.attentionExpiring", { count: stats.expiringCount })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="space-y-3">
        {/* Pill Tabs */}
        <div className="flex gap-1 flex-wrap">
          {FILTER_TABS.map((tab) => {
            const count = filterCounts[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeFilter === tab.id
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {t(`list.tabs.${tab.id}`)}
                {count > 0 && ` (${count})`}
              </button>
            );
          })}
        </div>

        {/* Search + Sort */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder={t("list.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-9 pr-3 py-1.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            />
          </div>
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="appearance-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-3 pr-8 py-1.5 text-sm text-gray-700 dark:text-gray-300 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              <option value="status">{t("list.sortStatus")}</option>
              <option value="remaining">{t("list.sortRemaining")}</option>
              <option value="expiry">{t("list.sortExpiry")}</option>
              <option value="client">{t("list.sortClient")}</option>
              <option value="name">{t("list.sortName")}</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <InlineSpinner className="h-6 w-6" />
        </div>
      ) : filteredPackages.length > 0 ? (
        <div
          role="table"
          aria-label={t("list.tableLabel")}
          className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden"
        >
          {/* Header row */}
          <div
            role="row"
            className="flex items-center px-6 py-2 border-b border-gray-200 dark:border-gray-800 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
          >
            <div role="columnheader" className="flex-[2.5]">
              {t("list.colPackage")}
            </div>
            <div role="columnheader" className="flex-1 text-center">
              {t("list.colStatus")}
            </div>
            <div
              role="columnheader"
              className="flex-[1.5] text-center hidden sm:block"
            >
              {t("list.colUsage")}
            </div>
            <div role="columnheader" className="flex-1 text-right">
              {t("list.colRemaining")}
            </div>
            <div
              role="columnheader"
              className="flex-1 text-right hidden md:block"
            >
              {t("list.colValue")}
            </div>
            <div
              role="columnheader"
              className="flex-[0.8] text-right hidden lg:block"
            >
              {t("list.colExpiry")}
            </div>
            <div className="flex-[0.5]" />
          </div>

          {/* Data rows */}
          {filteredPackages.map((pkg) => (
            <div
              key={pkg.id}
              className="relative group"
              ref={openMenuId === pkg.id ? menuRef : undefined}
            >
              <Link
                role="row"
                href={`/dashboard/klippekort/${pkg.id}`}
                className={`flex items-center px-6 py-3 border-b border-gray-100 dark:border-gray-800/50 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${getBorderAccent(pkg)}`}
              >
                {/* Klippekort name + client */}
                <div role="cell" className="flex-[2.5] min-w-0 pr-3">
                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {pkg.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {pkg.clientName}
                  </div>
                </div>

                {/* Status badge */}
                <div role="cell" className="flex-1 flex justify-center">
                  {getStatusBadge(pkg)}
                </div>

                {/* Forbrug som klippekortets huller */}
                <div
                  role="cell"
                  className="flex-[1.5] px-3 hidden sm:flex justify-center"
                >
                  <KlippekortHuller
                    size="sm"
                    totalHours={pkg.totalHours}
                    remainingHours={pkg.remainingHours}
                    tone={getHulTone(pkg)}
                  />
                </div>

                {/* Remaining hours */}
                <div role="cell" className="flex-1 text-right">
                  <span
                    className={`text-sm tabular-nums font-semibold ${
                      pkg.isDepleted
                        ? "text-red-600 dark:text-red-400"
                        : pkg.isLowBalance
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-gray-900 dark:text-white"
                    }`}
                  >
                    {formatTime(pkg.remainingHours)}
                  </span>
                  <div className="text-xs text-gray-400 dark:text-gray-500">
                    / {formatTime(pkg.totalHours)}
                  </div>
                </div>

                {/* Value */}
                <div role="cell" className="flex-1 text-right hidden md:block">
                  <span className="text-sm tabular-nums text-gray-900 dark:text-white">
                    {pkg.hideValue ? "–" : formatCurrency(pkg.remainingValue)}
                  </span>
                </div>

                {/* Expiry */}
                <div
                  role="cell"
                  className="flex-[0.8] text-right hidden lg:block"
                >
                  {pkg.expiryDate ? (
                    <span
                      className={`text-xs ${
                        pkg.isExpired
                          ? "text-red-600 dark:text-red-400 font-medium"
                          : pkg.isExpiringSoon
                            ? "text-amber-600 dark:text-amber-400 font-medium"
                            : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {pkg.isExpired
                        ? t("list.expired")
                        : pkg.daysUntilExpiry === 0
                          ? t("list.today")
                          : pkg.daysUntilExpiry !== null &&
                              pkg.daysUntilExpiry <= 30
                            ? t("list.daysShort", { days: pkg.daysUntilExpiry })
                            : formatPrepaidExpiry(
                                pkg.expiryDate,
                                {
                                  day: "numeric",
                                  month: "short",
                                },
                                toIntlLocale(locale),
                              )}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300 dark:text-gray-600">
                      &ndash;
                    </span>
                  )}
                </div>

                {/* Spacer for menu button */}
                <div className="flex-[0.5]" />
              </Link>

              {/* Actions menu button - positioned absolutely */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === pkg.id ? null : pkg.id);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity z-10"
                aria-label={t("list.actions")}
                aria-expanded={openMenuId === pkg.id}
                aria-haspopup="menu"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>

              {/* Dropdown menu */}
              {openMenuId === pkg.id && (
                <div
                  role="menu"
                  aria-label={t("list.menuLabel")}
                  className="absolute right-3 top-full -mt-1 z-20 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
                >
                  <Link
                    href={`/dashboard/klippekort/${pkg.id}/edit`}
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(null);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t("list.edit")}
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      duplicateMutation.mutate({ id: pkg.id });
                      setOpenMenuId(null);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("list.duplicate")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleActiveMutation.mutate({ id: pkg.id });
                      setOpenMenuId(null);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    {pkg.isActive ? (
                      <>
                        <XCircle className="h-3.5 w-3.5" />
                        {t("list.deactivate")}
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-3.5 w-3.5" />
                        {t("list.activate")}
                      </>
                    )}
                  </button>
                  {canManage && (
                    <>
                      <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setArchiveConfirmId(pkg.id);
                          setOpenMenuId(null);
                        }}
                        className={`flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${
                          pkg.isArchived
                            ? "text-green-600 dark:text-green-400"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {pkg.isArchived ? (
                          <>
                            <ArchiveRestore className="h-3.5 w-3.5" />
                            {t("list.restore")}
                          </>
                        ) : (
                          <>
                            <Archive className="h-3.5 w-3.5" />
                            {t("list.archive")}
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : !searchQuery.trim() && activeFilter === "all" && canManage ? (
        // Ingen klippekort endnu: forklar modellen og vis forslag (#90)
        <KlippekortExplainer />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Clock className="h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">
            {t("list.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {searchQuery.trim() || activeFilter !== "all"
              ? t("list.emptyFiltered")
              : t("list.emptyNone")}
          </p>
          {!searchQuery.trim() && activeFilter === "all" && canManage && (
            <Link
              href="/dashboard/klippekort/new"
              className="mt-4 inline-block"
            >
              <Button leftIcon={<Plus className="h-4 w-4" />}>
                {t("list.create")}
              </Button>
            </Link>
          )}
        </div>
      )}

      {/* Archive Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!archiveConfirmId}
        onClose={() => setArchiveConfirmId(null)}
        onConfirm={async () => {
          if (archiveConfirmId) {
            try {
              await archiveMutation.mutateAsync({ id: archiveConfirmId });
              setArchiveConfirmId(null);
            } catch {
              // Fejlen vises af mutationens onError.
            }
          }
        }}
        title={
          packages?.find((p) => p.id === archiveConfirmId)?.isArchived
            ? t("list.restoreTitle")
            : t("list.archiveTitle")
        }
        description={
          packages?.find((p) => p.id === archiveConfirmId)?.isArchived
            ? t("list.restoreDescription")
            : t("list.archiveDescription")
        }
        confirmLabel={
          packages?.find((p) => p.id === archiveConfirmId)?.isArchived
            ? t("list.restore")
            : t("list.archive")
        }
        variant={
          packages?.find((p) => p.id === archiveConfirmId)?.isArchived
            ? "default"
            : "warning"
        }
        isLoading={archiveMutation.isPending}
      />
    </div>
  );
}

export default function KlippekortPage() {
  return (
    <ModuleGuard module="klippekort">
      <RoleModuleGuard module="klippekort">
        <KlippekortPageContent />
      </RoleModuleGuard>
    </ModuleGuard>
  );
}
