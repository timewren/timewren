import { FileText, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadError } from "@/components/ui/LoadError";
import { formatCurrency, formatDate } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { InvoiceDraft } from "@/lib/types";
import { toast } from "@/stores/toastStore";
import { EntrySelector } from "./EntrySelector";
import { InvoiceEditor } from "./InvoiceEditor";

type FilterTab = "alle" | "draft" | "sent" | "exported";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-400",
  sent: "bg-blue-500/15 text-blue-400",
  exported: "bg-emerald-500/15 text-emerald-400",
};

export function InvoiceList() {
  const { t } = useTranslation();

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "alle", label: t("invoices.all") },
    { key: "draft", label: t("invoices.drafts") },
    { key: "sent", label: t("invoices.sent") },
    { key: "exported", label: t("invoices.exported") },
  ];

  const STATUS_LABELS: Record<string, string> = {
    draft: t("invoices.draft"),
    sent: t("invoices.sent"),
    exported: t("invoices.exported"),
  };

  const [invoices, setInvoices] = useState<InvoiceDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("alle");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceDraft | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    try {
      const result = await tauriInvoke<InvoiceDraft[]>("list_invoices", {
        status: null,
      });
      setInvoices(result);
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to fetch invoices:", err);
      setLoadFailed(true);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const filtered = useMemo(() => {
    let items = invoices;

    if (tab !== "alle") {
      items = items.filter((i) => i.status === tab);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.title?.toLowerCase().includes(q) ||
          i.client_name?.toLowerCase().includes(q),
      );
    }

    return items;
  }, [invoices, tab, search]);

  // Summary stats
  const stats = useMemo(() => {
    const drafts = invoices.filter((i) => i.status === "draft").length;
    const totalDraftValue = invoices
      .filter((i) => i.status === "draft")
      .reduce((sum, i) => sum + (i.total || 0), 0);
    const totalExported = invoices
      .filter((i) => i.status === "exported")
      .reduce((sum, i) => sum + (i.total || 0), 0);
    return { drafts, totalDraftValue, totalExported };
  }, [invoices]);

  function handleCreated(invoice: InvoiceDraft) {
    setInvoices((prev) => [invoice, ...prev]);
    setEditing(invoice);
  }

  function handleUpdated(invoice: InvoiceDraft) {
    setInvoices((prev) => prev.map((i) => (i.id === invoice.id ? invoice : i)));
    setEditing(invoice);
  }

  async function handleDelete(id: string) {
    try {
      await tauriInvoke("delete_invoice", { id });
      setInvoices((prev) => prev.filter((i) => i.id !== id));
      if (editing?.id === id) setEditing(null);
      toast.success(t("invoices.invoiceDeleted"));
    } catch (err) {
      console.error("Failed to delete invoice:", err);
      toast.error(t("invoices.couldNotDelete"));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
      </div>
    );
  }

  // Show editor if an invoice is selected
  if (editing) {
    return (
      <InvoiceEditor
        invoice={editing}
        onBack={() => {
          setEditing(null);
          fetchInvoices();
        }}
        onUpdated={handleUpdated}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15">
            <FileText size={14} className="text-amber-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-(--color-text) font-mono leading-none">
              {stats.drafts}
            </p>
            <p className="text-[10px] text-(--color-text-muted) mt-0.5">
              {t("invoices.drafts")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15">
            <FileText size={14} className="text-blue-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-(--color-text) font-mono leading-none">
              {formatCurrency(Math.round(stats.totalDraftValue), 0)}
            </p>
            <p className="text-[10px] text-(--color-text-muted) mt-0.5">
              {t("invoices.uninvoiced")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
            <FileText size={14} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-(--color-text) font-mono leading-none">
              {formatCurrency(Math.round(stats.totalExported), 0)}
            </p>
            <p className="text-[10px] text-(--color-text-muted) mt-0.5">
              {t("invoices.exported")}
            </p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
          />
          <input
            type="text"
            aria-label={t("invoices.searchInvoices")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("invoices.searchInvoices")}
            className="h-9 w-full rounded-md border border-(--color-border) bg-(--color-bg) pl-9 pr-3 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          />
        </div>

        <Button size="sm" onClick={() => setSelectorOpen(true)}>
          <Plus size={14} />
          {t("invoices.new")}
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-(--color-bg) p-1 border border-(--color-border)">
        {TABS.map((t) => {
          const count =
            t.key === "alle"
              ? invoices.length
              : invoices.filter((i) => i.status === t.key).length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-(--color-surface) text-(--color-text) shadow-sm"
                  : "text-(--color-text-muted) hover:text-(--color-text)"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-[10px] opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Invoice list */}
      {loadFailed ? (
        <LoadError
          message={t("invoices.listLoadFailed")}
          onRetry={() => {
            setLoading(true);
            fetchInvoices();
          }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          hasInvoices={invoices.length > 0}
          onCreateClick={() => setSelectorOpen(true)}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((invoice) => (
            <button
              key={invoice.id}
              type="button"
              onClick={() => setEditing(invoice)}
              className="flex items-center gap-4 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-3 text-left transition-colors hover:border-(--color-accent)/30 hover:bg-(--color-accent)/5 group"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-(--color-border)/30">
                <FileText size={16} className="text-(--color-text-muted)" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-(--color-text) truncate">
                  {invoice.title || t("invoices.noTitle")}
                </p>
                <p className="text-xs text-(--color-text-muted)">
                  {invoice.client_name || t("invoices.unknownClient")}
                  {invoice.due_date &&
                    ` · ${t("invoices.dueDate")}: ${invoice.due_date}`}
                </p>
              </div>

              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  STATUS_COLORS[invoice.status] || STATUS_COLORS.draft
                }`}
              >
                {STATUS_LABELS[invoice.status] || invoice.status}
              </span>

              <span className="text-sm font-mono font-medium text-(--color-text) w-28 text-right">
                {formatCurrency(invoice.total || 0, 2)}
              </span>

              <span className="text-xs text-(--color-text-muted) w-20 text-right">
                {formatDate(invoice.created_at)}
              </span>

              <button
                type="button"
                aria-label={`${t("common.delete")} ${invoice.title || t("invoices.noTitle")}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirmId(invoice.id);
                }}
                className="flex h-7 w-7 items-center justify-center rounded text-(--color-text-muted) opacity-0 group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-400 transition-all"
              >
                <Trash2 size={13} />
              </button>
            </button>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        title={t("invoiceActions.deleteConfirmTitle")}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteConfirmId(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (deleteConfirmId) handleDelete(deleteConfirmId);
                setDeleteConfirmId(null);
              }}
            >
              {t("invoiceActions.deleteButton")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-(--color-text-muted)">
          {t("invoiceActions.deleteConfirmText")}
        </p>
      </Dialog>

      {/* Entry selector dialog */}
      <EntrySelector
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}

function EmptyState({
  hasInvoices,
  onCreateClick,
}: {
  hasInvoices: boolean;
  onCreateClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-(--color-border)/40 mb-4">
        <FileText size={22} className="text-(--color-text-muted)" />
      </div>
      <h3 className="text-sm font-medium text-(--color-text) mb-1">
        {hasInvoices ? t("common.noResults") : t("invoices.noInvoices")}
      </h3>
      <p className="text-xs text-(--color-text-muted) mb-4 max-w-[240px]">
        {hasInvoices
          ? t("projects.noResultsFilter")
          : t("invoices.createFirst")}
      </p>
      {!hasInvoices && (
        <Button size="sm" onClick={onCreateClick}>
          <Plus size={14} />
          {t("invoices.new")}
        </Button>
      )}
    </div>
  );
}
