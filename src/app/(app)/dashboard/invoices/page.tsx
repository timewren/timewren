"use client";

import {
  ArrowUpDown,
  CheckCircle,
  Clock,
  Download,
  Eye,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { GenerateFromTimeEntriesModal } from "@/components/invoices/GenerateFromTimeEntriesModal";
import { InvoicesEmptyState } from "@/components/invoices/InvoicesEmptyState";
import { RecurringInvoicesPanel } from "@/components/invoices/RecurringInvoicesPanel";
import {
  type ReviewedInvoice,
  SendInvoiceDialog,
} from "@/components/invoices/SendInvoiceDialog";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleModuleGuard } from "@/components/RoleModuleGuard";
import {
  Button,
  InvoicesPageSkeleton,
  ModuleDisabledState,
} from "@/components/ui";
import { useDebounce } from "@/hooks/useDebounce";
import { usePermission } from "@/hooks/usePermission";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency } from "@/lib/format";
import { formatInvoiceNumber } from "@/lib/invoices/draft-number";
import { isModuleDisabledError } from "@/lib/modules/forbidden-error";
import { trpc } from "@/providers/trpc-provider";

const STATUS_CONFIG: Record<string, { bg: string; text: string }> = {
  draft: {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-600 dark:text-gray-400",
  },
  sent: {
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-400",
  },
  paid: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  overdue: {
    bg: "bg-red-50 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-400",
  },
};

function getStatusBadge(status: string | null, t: (key: string) => string) {
  const key = status && status in STATUS_CONFIG ? status : "draft";
  const s = STATUS_CONFIG[key];

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
    >
      {t(`status.${key}`)}
    </span>
  );
}

function getRowAccent(status: string | null): string {
  switch (status) {
    case "overdue":
      return "border-l-[3px] border-l-red-500 dark:border-l-red-400";
    case "sent":
      return "border-l-[3px] border-l-amber-400 dark:border-l-amber-500";
    case "paid":
      return "border-l-[3px] border-l-emerald-400 dark:border-l-emerald-500";
    default:
      return "border-l-[3px] border-l-transparent";
  }
}

type SortField =
  | "invoiceNumber"
  | "client"
  | "amount"
  | "issueDate"
  | "dueDate"
  | "status";
type SortDir = "asc" | "desc";

function InvoicesPageContent() {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWrite: canWriteInvoices } = usePermission("invoices");
  // Gratis/Privat kan se eksisterende fakturaer, men ikke oprette nye
  const canInvoice = canWriteInvoices;
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [statusFilter, setStatusFilter] = useState<string>(
    searchParams.get("status") || "all",
  );
  // ?fraTid=1 (fx fra "ufaktureret"-genvejen på Overblik) åbner direkte
  const [showGenerateModal, setShowGenerateModal] = useState(
    () => searchParams.get("fraTid") === "1",
  );
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("issueDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Sync filters to URL
  const debouncedSearch = useDebounce(searchQuery, 300);
  const debouncedStatus = useDebounce(statusFilter, 300);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (debouncedStatus !== "all") params.set("status", debouncedStatus);
    const paramStr = params.toString();
    const newUrl = paramStr
      ? `/dashboard/invoices?${paramStr}`
      : "/dashboard/invoices";
    router.replace(newUrl, { scroll: false });
  }, [debouncedSearch, debouncedStatus, router]);

  // Dismiss dropdown on Escape
  useEffect(() => {
    if (!openMenuId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openMenuId]);

  const { data: invoices, isLoading, error } = trpc.invoices.list.useQuery();
  const { data: stats } = trpc.invoices.getStats.useQuery();
  const { data: seriesAudit } = trpc.invoices.numberSeriesAudit.useQuery();
  // Kun til den tomme liste: ufaktureret tid gør "Fakturér tiden" til første
  // skridt. Samme opslag som GenerateFromTimeEntriesModal (hele
  // organisationens fakturerbare tid), så knappen og modalen er enige.
  const emptyList = canInvoice && invoices?.length === 0;
  const uninvoiced = trpc.invoices.getUninvoicedSummary.useQuery(undefined, {
    enabled: emptyList,
  });
  const unbilledHours = uninvoiced.data
    ? uninvoiced.data.reduce((sum, c) => sum + c.totalHours, 0)
    : undefined;
  // Den første faktura kræver virksomhedsoplysninger (#91).
  const { data: companyProfile } = trpc.onboarding.getCompanyProfile.useQuery(
    undefined,
    { enabled: emptyList },
  );
  const utils = trpc.useUtils();

  const updateMutation = trpc.invoices.update.useMutation({
    onSuccess: () => {
      utils.invoices.list.invalidate();
      utils.invoices.getStats.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || t("list.updateFailed"));
    },
  });

  const sendEmailMutation = trpc.invoices.sendEmail.useMutation();

  const filteredInvoices = useMemo(() => {
    if (!invoices) return undefined;

    const query = debouncedSearch.toLowerCase();
    return invoices
      .filter((invoice) => {
        const invoiceClient = Array.isArray(invoice.client)
          ? invoice.client[0]
          : invoice.client;
        const matchesSearch =
          invoice.invoiceNumber.toLowerCase().includes(query) ||
          (invoiceClient?.name || "").toLowerCase().includes(query);
        const matchesStatus =
          statusFilter === "all" || invoice.status === statusFilter;
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        switch (sortField) {
          case "invoiceNumber":
            return dir * a.invoiceNumber.localeCompare(b.invoiceNumber, locale);
          case "client": {
            const aName =
              (Array.isArray(a.client) ? a.client[0] : a.client)?.name || "";
            const bName =
              (Array.isArray(b.client) ? b.client[0] : b.client)?.name || "";
            return dir * aName.localeCompare(bName, locale);
          }
          case "amount":
            return dir * (Number(a.amount) - Number(b.amount));
          case "issueDate":
            return (
              dir *
              (new Date(a.issueDate).getTime() -
                new Date(b.issueDate).getTime())
            );
          case "dueDate": {
            const aDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;
            const bDate = b.dueDate ? new Date(b.dueDate).getTime() : 0;
            return dir * (aDate - bDate);
          }
          case "status":
            return dir * (a.status || "").localeCompare(b.status || "");
          default:
            return 0;
        }
      });
  }, [invoices, debouncedSearch, statusFilter, sortField, sortDir, locale]);

  const statusCounts = useMemo(() => {
    if (!invoices) return { all: 0, draft: 0, sent: 0, paid: 0, overdue: 0 };
    return {
      all: invoices.length,
      draft: invoices.filter((i) => i.status === "draft").length,
      sent: invoices.filter((i) => i.status === "sent").length,
      paid: invoices.filter((i) => i.status === "paid").length,
      overdue: invoices.filter((i) => i.status === "overdue").length,
    };
  }, [invoices]);

  const formatDate = useCallback(
    (date: Date | string) => {
      const d = new Date(date);
      return d.toLocaleDateString(toIntlLocale(locale), {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/Copenhagen",
      });
    },
    [locale],
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const handleMarkAsPaid = (id: string) => {
    updateMutation.mutate(
      { id, status: "paid" },
      {
        onSuccess: () => {
          toast.success(t("list.markedPaid"));
          setOpenMenuId(null);
        },
      },
    );
  };

  const handleMarkAsSent = (id: string) => {
    updateMutation.mutate(
      { id, status: "sent" },
      {
        onSuccess: () => {
          toast.success(t("list.markedSent"));
          setOpenMenuId(null);
        },
      },
    );
  };

  const [sendInvoiceId, setSendInvoiceId] = useState<string | null>(null);

  const handleSendEmail = async (
    email: string,
    expectedInvoice: ReviewedInvoice,
  ) => {
    if (!sendInvoiceId) return;
    try {
      await sendEmailMutation.mutateAsync({
        id: sendInvoiceId,
        expectedRecipient: email,
        expectedInvoice,
      });
      toast.success(t("sendConfirmation.sent", { email }));
      setSendInvoiceId(null);
      void utils.invoices.list.invalidate();
      void utils.invoices.getStats.invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("list.sendFailed"),
      );
    }
  };

  if (isLoading) {
    return <InvoicesPageSkeleton />;
  }

  if (error) {
    if (isModuleDisabledError(error)) {
      return <ModuleDisabledState />;
    }
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">
          {t("list.loadError")}
        </p>
      </div>
    );
  }

  const statCards = [
    {
      label: t("list.statRevenue"),
      value: stats ? formatCurrency(stats.totalInvoiced) : "–",
      sub: t("list.statRevenueSub"),
      color: "text-gray-900 dark:text-white",
    },
    {
      label: t("list.statOutstanding"),
      value: stats ? formatCurrency(stats.totalPending) : "–",
      color:
        stats && Number(stats.totalPending) > 0
          ? "text-amber-600 dark:text-amber-400"
          : "text-gray-900 dark:text-white",
    },
    {
      label: t("list.statOverdue"),
      value: stats ? `${stats.overdue}` : "0",
      sub: stats && stats.overdue > 0 ? t("list.statOverdueSub") : undefined,
      color:
        stats && stats.overdue > 0
          ? "text-red-600 dark:text-red-400"
          : "text-gray-900 dark:text-white",
    },
    {
      label: t("list.statCount"),
      value: stats ? `${stats.total}` : "0",
      color: "text-gray-900 dark:text-white",
    },
  ];

  const pillTabs = [
    { value: "all", label: t("list.tabAll") },
    { value: "draft", label: t("status.draft") },
    { value: "sent", label: t("status.sent") },
    { value: "paid", label: t("status.paid") },
    { value: "overdue", label: t("status.overdue") },
  ] as const;

  return (
    <div className="space-y-5" data-tour="invoices-list">
      {/* Header */}
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        helpTopicId="invoices"
        actions={
          canInvoice ? (
            <div
              className="flex flex-col gap-2 sm:flex-row"
              data-tour="invoices-actions"
            >
              <Button
                variant="secondary"
                leftIcon={<Clock className="h-4 w-4" />}
                onClick={() => setShowGenerateModal(true)}
              >
                {t("list.fromTime")}
              </Button>
              <Link
                href="/dashboard/invoices/new"
                title={t("list.shortcut")}
                aria-keyshortcuts="n"
              >
                <Button leftIcon={<Plus className="h-4 w-4" />}>
                  {t("list.newInvoice")}
                </Button>
              </Link>
            </div>
          ) : null
        }
      />

      {/* Gentagne fakturaer / retainere (#198) — kommende kladder */}
      <RecurringInvoicesPanel />

      {/* Cap-notits (#186): søgning/filtrering dækker kun de hentede */}
      {invoices && invoices.length >= 500 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("list.cap")}
        </p>
      )}

      {/* Nummerserie-tjek (#196): kun synligt hvis serien har huller —
          dokumentation ved skattekontrol (arv fra gammel kladde-adfærd) */}
      {seriesAudit && seriesAudit.gapCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>{t("list.gapTitle")}</strong>{" "}
          {t("list.gapText", {
            min: seriesAudit.min ?? "",
            max: seriesAudit.max ?? "",
            count: seriesAudit.gapCount,
          })}
          {seriesAudit.gaps.length > 0 && (
            <>
              {" "}
              {t("list.gapMissing", {
                numbers: seriesAudit.gaps.slice(0, 20).join(", "),
                more: seriesAudit.gapCount > 20 ? ", ..." : "",
              })}
            </>
          )}
          . {t("list.gapExplain")}
        </div>
      )}

      {/* Stats strip */}
      {stats && (
        <div
          className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-xl bg-gray-200/80 dark:bg-gray-800 overflow-hidden"
          data-tour="invoices-stats"
          role="region"
          aria-label={t("list.statsAria")}
        >
          {statCards.map((card) => (
            <div
              key={card.label}
              className="bg-white dark:bg-gray-900 px-4 py-3 sm:px-5 sm:py-4"
            >
              <p className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {card.label}
              </p>
              <p
                className={`mt-1 text-lg sm:text-xl font-semibold tabular-nums ${card.color}`}
              >
                {card.value}
              </p>
              {card.sub && (
                <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                  {card.sub}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pill filter tabs */}
      <div
        className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
        role="tablist"
        aria-label={t("list.filterAria")}
      >
        {pillTabs.map((tab) => {
          const count = statusCounts[tab.value as keyof typeof statusCounts];
          const isActive = statusFilter === tab.value;
          return (
            <button
              type="button"
              key={tab.value}
              role="tab"
              aria-selected={isActive}
              onClick={() => setStatusFilter(tab.value)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  isActive
                    ? "bg-white/20 text-white dark:bg-black/20 dark:text-gray-900"
                    : tab.value === "overdue" && count > 0
                      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                      : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          placeholder={t("list.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label={t("list.searchAria")}
          className="w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 py-2 pl-9 pr-4 focus:border-gray-300 dark:focus:border-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-200/60 dark:focus:ring-gray-700/40"
        />
      </div>

      {/* Table / Empty state */}
      {!filteredInvoices || filteredInvoices.length === 0 ? (
        <InvoicesEmptyState
          filtered={!!searchQuery || statusFilter !== "all"}
          canInvoice={canInvoice}
          unbilledHours={unbilledHours}
          unbilledFailed={uninvoiced.isError}
          missingCompanyProfile={companyProfile === null}
          onInvoiceUnbilled={() => setShowGenerateModal(true)}
        />
      ) : (
        <>
          {/* Mobile card view */}
          <div className="space-y-2 md:hidden">
            {filteredInvoices.map((invoice) => {
              const invoiceClient = Array.isArray(invoice.client)
                ? invoice.client[0]
                : invoice.client;
              return (
                <Link
                  key={invoice.id}
                  href={`/dashboard/invoices/${invoice.id}`}
                  className={`block rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60 ${getRowAccent(invoice.status)}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs tabular-nums font-medium text-gray-900 dark:text-gray-100">
                          {formatInvoiceNumber(
                            invoice.invoiceNumber,
                            t("status.draft"),
                          )}
                        </span>
                        {invoice.kind === "credit_note" && (
                          <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                            {t("list.creditNote")}
                          </span>
                        )}
                        {getStatusBadge(invoice.status, t)}
                      </div>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 truncate">
                        {invoiceClient?.name || t("list.unknownClient")}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                      {formatCurrency(invoice.amount)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
                    <span>{formatDate(invoice.issueDate)}</span>
                    {invoice.dueDate && (
                      <span>
                        {t("list.dueOn", { date: formatDate(invoice.dueDate) })}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div role="table" aria-label={t("tableLabel")}>
              {/* Header */}
              <div
                role="row"
                className="grid grid-cols-[1fr_1.2fr_0.8fr_0.7fr_0.7fr_0.6fr_48px] gap-x-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/80 px-4 py-2.5"
              >
                {(
                  [
                    ["invoiceNumber", t("list.colNumber")],
                    ["client", t("list.colClient")],
                    ["amount", t("list.colAmount")],
                    ["issueDate", t("list.colDate")],
                    ["dueDate", t("list.colDueDate")],
                    ["status", t("list.colStatus")],
                  ] as const
                ).map(([field, label]) => (
                  <div
                    key={field}
                    role="columnheader"
                    aria-sort={
                      sortField === field
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(field)}
                      className={`flex w-full items-center gap-1 text-[11px] font-medium uppercase tracking-wide transition-colors ${
                        sortField === field
                          ? "text-gray-900 dark:text-gray-100"
                          : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                      } ${field === "amount" ? "justify-end" : "text-left"}`}
                    >
                      {label}
                      {sortField === field && (
                        <ArrowUpDown className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                ))}
                <div role="columnheader" className="sr-only">
                  {t("list.actions")}
                </div>
              </div>

              {/* Rows */}
              {filteredInvoices.map((invoice) => {
                const invoiceClient = Array.isArray(invoice.client)
                  ? invoice.client[0]
                  : invoice.client;
                const isMenuOpen = openMenuId === invoice.id;

                return (
                  <div
                    key={invoice.id}
                    role="row"
                    tabIndex={0}
                    className={`group grid grid-cols-[1fr_1.2fr_0.8fr_0.7fr_0.7fr_0.6fr_48px] gap-x-4 items-center px-4 py-2.5 border-b border-gray-50 dark:border-gray-800/60 transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/40 cursor-pointer ${getRowAccent(invoice.status)}`}
                    onClick={() =>
                      router.push(`/dashboard/invoices/${invoice.id}`)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/dashboard/invoices/${invoice.id}`);
                      }
                    }}
                  >
                    {/* Invoice number */}
                    <div
                      role="cell"
                      className="min-w-0 flex items-center gap-2"
                    >
                      <span className="text-sm tabular-nums font-medium text-gray-900 dark:text-gray-100">
                        {formatInvoiceNumber(
                          invoice.invoiceNumber,
                          t("status.draft"),
                        )}
                      </span>
                      {invoice.kind === "credit_note" && (
                        <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                          {t("list.creditNote")}
                        </span>
                      )}
                    </div>

                    {/* Client */}
                    <div role="cell" className="min-w-0">
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate block">
                        {invoiceClient?.name || t("list.unknownClient")}
                      </span>
                    </div>

                    {/* Amount */}
                    <div role="cell" className="text-right min-w-0">
                      <span className="text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">
                        {formatCurrency(invoice.amount)}
                      </span>
                    </div>

                    {/* Issue date */}
                    <div role="cell" className="min-w-0">
                      <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                        {formatDate(invoice.issueDate)}
                      </span>
                    </div>

                    {/* Due date */}
                    <div role="cell" className="min-w-0">
                      <span
                        className={`text-xs tabular-nums ${
                          invoice.status === "overdue"
                            ? "text-red-600 dark:text-red-400 font-medium"
                            : "text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {invoice.dueDate ? formatDate(invoice.dueDate) : "–"}
                      </span>
                    </div>

                    {/* Status badge */}
                    <div role="cell">{getStatusBadge(invoice.status, t)}</div>

                    {/* Actions menu */}
                    <div role="cell" className="relative flex justify-end">
                      <button
                        type="button"
                        aria-label={t("list.actions")}
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(isMenuOpen ? null : invoice.id);
                        }}
                        className="rounded-md p-1.5 text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>

                      {isMenuOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            aria-hidden="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(null);
                            }}
                          />
                          <div
                            role="menu"
                            className="absolute right-0 top-full z-30 mt-1 w-52 rounded-lg border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 py-1 shadow-lg"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(
                                  `/dashboard/invoices/${invoice.id}`,
                                );
                                setOpenMenuId(null);
                              }}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                              <Eye className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                              {t("list.viewDetails")}
                            </button>

                            {invoice.status === "draft" && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMarkAsSent(invoice.id);
                                }}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                              >
                                <TrendingUp className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                                {t("list.markSent")}
                              </button>
                            )}

                            {(invoice.status === "sent" ||
                              invoice.status === "overdue") && (
                              <>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(null);
                                    setSendInvoiceId(invoice.id);
                                  }}
                                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                                >
                                  <Mail className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                                  {t("list.sendReminder")}
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMarkAsPaid(invoice.id);
                                  }}
                                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                  {t("list.markPaid")}
                                </button>
                              </>
                            )}

                            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />

                            <button
                              type="button"
                              role="menuitem"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(
                                  `/dashboard/invoices/${invoice.id}?download=pdf`,
                                );
                                setOpenMenuId(null);
                              }}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                              <Download className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                              {t("list.downloadPdf")}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/60 px-4 py-2.5">
              <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                {t("list.footer", {
                  count: filteredInvoices.length,
                  filtered:
                    statusFilter !== "all" ? t("list.filteredSuffix") : "",
                })}
              </p>
            </div>
          </div>
        </>
      )}

      {/* Generate from Time Entries Modal */}
      <GenerateFromTimeEntriesModal
        isOpen={showGenerateModal && canInvoice}
        onClose={() => setShowGenerateModal(false)}
        missingCompanyProfile={emptyList && companyProfile === null}
      />

      <SendInvoiceDialog
        invoiceId={sendInvoiceId}
        onClose={() => setSendInvoiceId(null)}
        onSend={handleSendEmail}
      />
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <ModuleGuard module="invoicing">
      <RoleModuleGuard module="invoices">
        <InvoicesPageContent />
      </RoleModuleGuard>
    </ModuleGuard>
  );
}
