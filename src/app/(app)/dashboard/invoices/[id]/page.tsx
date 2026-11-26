"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  DollarSign,
  Download,
  Edit,
  ExternalLink,
  FileText,
  Mail,
  MailOpen,
  Printer,
  Send,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { use, useCallback, useState } from "react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/dashboard-nav";
import {
  BillyExportModal,
  type BillyExportSettings,
} from "@/components/invoices/BillyExportModal";
import {
  DineroExportModal,
  type DineroExportSettings,
} from "@/components/invoices/DineroExportModal";
import { InvoiceLineEditor } from "@/components/invoices/InvoiceLineEditor";
import { InvoicePDFViewer } from "@/components/invoices/InvoicePDFViewer";
import { ProviderEmailUncertainBanner } from "@/components/invoices/ProviderEmailUncertainBanner";
import {
  type ReviewedInvoice,
  SendInvoiceDialog,
} from "@/components/invoices/SendInvoiceDialog";
import { ConfirmDialog } from "@/components/ui";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { usePermission } from "@/hooks/usePermission";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency, toLocalDateStr } from "@/lib/format";
import { formatInvoiceNumber } from "@/lib/invoices/draft-number";
import { broadcastDataChange } from "@/lib/query/cross-tab";
import {
  INVOICE_DOMAINS,
  invalidateDomains,
} from "@/lib/query/invalidate-domains";
import { trpc } from "@/providers/trpc-provider";

export default function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const currency = t("detail.currencyShort");
  // Beløb og timer i sprogets format (2.125,00 og 2,5 på dansk), ikke som
  // "2125.00" og "2.50" (gennemgang af første oplevelse, 2026-11-22).
  const displayAmount = (amount: string | number) =>
    formatCurrency(amount, { locale, suffix: "", decimals: 2 });
  const displayHours = (hours: string | number) =>
    Number(hours).toLocaleString(toIntlLocale(locale), {
      maximumFractionDigits: 2,
    });
  const router = useRouter();
  const { canWrite: canInvoice } = usePermission("invoices");

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const closeEmailModal = useCallback(() => setShowEmailModal(false), []);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editAmount, setEditAmount] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Billy export state
  const [showBillyModal, setShowBillyModal] = useState(false);
  const [isExportingToBilly, setIsExportingToBilly] = useState(false);

  // Dinero export state
  const [showDineroModal, setShowDineroModal] = useState(false);
  const [isExportingToDinero, setIsExportingToDinero] = useState(false);

  const { data: invoice, isLoading } = trpc.invoices.getById.useQuery({ id });

  // Normalize client relation (Drizzle may return array or single object)
  const client = invoice
    ? Array.isArray(invoice.client)
      ? invoice.client[0]
      : invoice.client
    : null;

  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const updateMutation = trpc.invoices.update.useMutation({
    onSuccess: () => {
      utils.invoices.getById.invalidate({ id });
    },
  });

  const creditNoteMutation = trpc.invoices.createCreditNote.useMutation({
    onSuccess: (cn) => {
      utils.invoices.getById.invalidate({ id });
      utils.invoices.list.invalidate();
      toast.success(
        t("detail.creditNoteCreated", { number: cn.invoiceNumber }),
      );
      router.push(`/dashboard/invoices/${cn.id}`);
    },
    onError: (err) => {
      toast.error(err.message || t("detail.creditNoteFailed"));
    },
  });

  const deleteMutation = trpc.invoices.delete.useMutation({
    onSuccess: () => {
      router.push("/dashboard/invoices");
    },
  });

  // Billy export mutation
  const exportToBillyMutation =
    trpc.integrations.exportInvoiceToBilly.useMutation();

  // Dinero export mutation
  const exportToDineroMutation =
    trpc.integrations.exportInvoiceToDinero.useMutation();

  // Check integration status
  const { data: integrationStatus } = trpc.user.getIntegrationStatus.useQuery();

  // Email delivery status
  const { data: emailStatus } = trpc.emailActivity.getInvoiceStatus.useQuery(
    { invoiceId: id },
    { enabled: !!id },
  );

  const [showCreditConfirm, setShowCreditConfirm] = useState(false);

  const handleDelete = async () => {
    if (invoice?.status !== "draft") {
      toast.warning(t("detail.onlyDraftsDeletable"));
      return;
    }

    setShowDeleteConfirm(true);
  };

  const startEditing = () => {
    if (!invoice) return;
    setEditAmount(invoice.amount);
    setEditDueDate(
      invoice.dueDate ? toLocalDateStr(new Date(invoice.dueDate)) : "",
    );
    setEditNotes(invoice.notes || "");
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!invoice) return;
    try {
      const updates: {
        id: string;
        amount?: string;
        dueDate?: string;
        notes?: string;
      } = { id };

      if (invoice.status === "draft") {
        if (editAmount !== invoice.amount) updates.amount = editAmount;
        const currentDueDate = invoice.dueDate
          ? toLocalDateStr(new Date(invoice.dueDate))
          : "";
        if (editDueDate !== currentDueDate)
          updates.dueDate = editDueDate || undefined;
      }
      if (editNotes !== (invoice.notes || "")) updates.notes = editNotes;

      await updateMutation.mutateAsync(updates);
      toast.success(t("detail.updated"));
      setIsEditing(false);
    } catch (error) {
      toast.error(
        t("detail.updateFailedWith", { message: (error as Error).message }),
      );
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateMutation.mutateAsync({
        id,
        status: newStatus as "draft" | "sent" | "paid" | "overdue",
      });
    } catch (error) {
      // Vis serverens besked (fx plan-grænse) i stedet for en tavs fejl
      toast.error(
        error instanceof Error ? error.message : t("detail.updateFailed"),
      );
    }
  };

  // Handle Billy export
  const handleBillyExport = async (settings: BillyExportSettings) => {
    setIsExportingToBilly(true);
    try {
      await exportToBillyMutation.mutateAsync({
        invoiceId: id,
        action: settings.action,
        expectedRecipient: settings.expectedRecipient,
        expectedInvoice: settings.expectedInvoice,
        productId: settings.productId,
        paymentTermsDays: settings.paymentTermsDays,
        contactMessage: settings.contactMessage || undefined,
        lineType: settings.lineType,
        lineTemplate: settings.lineTemplate,
      });
      if (settings.expectedRecipient) {
        toast.success(
          t("sendConfirmation.sent", { email: settings.expectedRecipient }),
        );
      } else {
        toast.success(t("detail.billyExported"));
      }
      setShowBillyModal(false);
      // Refresh to show updated billyInvoiceId
      utils.invoices.invalidate();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : t("detail.unknownError");
      toast.error(
        msg.includes("Kunne ikke eksportere")
          ? msg
          : t("detail.billyExportFailed", { message: msg }),
      );
    } finally {
      setIsExportingToBilly(false);
      if (settings.expectedInvoice) void utils.invoices.invalidate();
    }
  };

  // Handle Dinero export
  const handleDineroExport = async (settings: DineroExportSettings) => {
    setIsExportingToDinero(true);
    try {
      await exportToDineroMutation.mutateAsync({
        invoiceId: id,
        action: settings.action,
        expectedRecipient: settings.expectedRecipient,
        expectedInvoice: settings.expectedInvoice,
        accountNumber: settings.accountNumber,
        paymentTermsDays: settings.paymentTermsDays,
        contactMessage: settings.contactMessage || undefined,
        lineType: settings.lineType,
        lineTemplate: settings.lineTemplate,
      });
      if (settings.expectedRecipient) {
        toast.success(
          t("sendConfirmation.sent", { email: settings.expectedRecipient }),
        );
      } else {
        toast.success(t("detail.dineroExported"));
      }
      setShowDineroModal(false);
      // Refresh to show updated dineroInvoiceGuid
      utils.invoices.invalidate();
    } catch (error) {
      toast.error(
        t("detail.dineroExportFailed", { message: (error as Error).message }),
      );
    } finally {
      setIsExportingToDinero(false);
      if (settings.expectedInvoice) void utils.invoices.invalidate();
    }
  };

  const handleDownloadPDF = async () => {
    try {
      const response = await fetch(`/api/invoices/${id}/pdf`);
      if (!response.ok) {
        toast.error(t("detail.pdfFailed"));
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${t("detail.pdfFilePrefix")}_${formatInvoiceNumber(invoice?.invoiceNumber, t("status.draft"))}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(t("detail.pdfDownloaded"));
    } catch (error) {
      console.error("PDF download error:", error);
      toast.error(t("detail.pdfDownloadError"));
    }
  };

  const handlePrintPDF = async () => {
    try {
      const response = await fetch(`/api/invoices/${id}/pdf`);
      if (!response.ok) {
        toast.error(t("detail.pdfFailed"));
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = url;
      document.body.appendChild(iframe);

      iframe.onload = () => {
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
          window.URL.revokeObjectURL(url);
        }, 1000);
      };
    } catch (error) {
      console.error("PDF print error:", error);
      toast.error(t("detail.pdfPrintError"));
    }
  };

  const handleOpenEmailModal = () => {
    // Pre-fill with client email if available
    setRecipientEmail(client?.email || "");
    setShowEmailModal(true);
  };

  const handleSendEmail = async (
    recipientEmail: string,
    expectedInvoice: ReviewedInvoice,
  ) => {
    try {
      const response = await fetch(`/api/invoices/${id}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipientEmail,
          expectedInvoice,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || t("detail.sendEmailFailed"));
        return;
      }

      toast.success(t("sendConfirmation.sent", { email: recipientEmail }));
      setShowEmailModal(false);

      // Afsendelsen går via REST og dermed uden om MutationCache: opdatér
      // status, ufaktureret tid, likviditet og moms — også i andre faner.
      void invalidateDomains(queryClient, INVOICE_DOMAINS);
      broadcastDataChange(INVOICE_DOMAINS);
    } catch (error) {
      console.error("Email sending error:", error);
      toast.error(t("detail.emailSendError"));
    }
  };

  const getStatusBadge = (status: string | null) => {
    const statusColors: Record<string, string> = {
      draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
      sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      paid: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      overdue: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    };

    const key = status && status in statusColors ? status : "draft";
    const color = statusColors[key];
    const label = t(`detail.status.${key}`);

    return (
      <span
        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
      >
        {label}
      </span>
    );
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "–";
    return new Date(date).toLocaleDateString(toIntlLocale(locale), {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  if (isLoading) {
    return <LoadingScreen message={t("detail.loading")} />;
  }

  if (!invoice) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-600 dark:text-gray-400">
          {t("detail.notFound")}
        </p>
        <Link
          href="/dashboard/invoices"
          className="mt-4 inline-flex items-center gap-2 text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("detail.back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Header */}
      <div>
        <Breadcrumbs
          items={[
            { label: t("detail.breadcrumb"), href: "/dashboard/invoices" },
            {
              label: formatInvoiceNumber(
                invoice.invoiceNumber,
                t("status.draft"),
              ),
            },
          ]}
        />

        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
              {formatInvoiceNumber(invoice.invoiceNumber, t("status.draft"))}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("detail.to", { name: client?.name ?? "" })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {getStatusBadge(invoice.status)}
            {canInvoice &&
              (isEditing ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    {tc("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={updateMutation.isPending}
                    className="rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
                  >
                    {updateMutation.isPending
                      ? t("detail.saving")
                      : t("detail.save")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startEditing}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Edit className="mr-2 inline-block h-4 w-4" />
                  {tc("edit")}
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {canInvoice && invoice.status === "draft" && (
          <button
            type="button"
            onClick={() => handleStatusChange("sent")}
            disabled={updateMutation.isPending}
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg bg-tt-gran px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {t("list.markSent")}
          </button>
        )}

        {canInvoice && invoice.status === "sent" && (
          <button
            type="button"
            onClick={() => handleStatusChange("paid")}
            disabled={updateMutation.isPending}
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg bg-green-600 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            <DollarSign className="h-4 w-4" />
            {t("detail.markPaid")}
          </button>
        )}

        {canInvoice &&
          invoice.kind !== "credit_note" &&
          (invoice.status === "sent" ||
            invoice.status === "overdue" ||
            invoice.status === "paid") && (
            <button
              type="button"
              onClick={() => setShowCreditConfirm(true)}
              disabled={creditNoteMutation.isPending}
              className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border border-red-300 bg-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <FileText className="h-4 w-4" />
              {t("detail.createCreditNote")}
            </button>
          )}

        <button
          type="button"
          onClick={handleDownloadPDF}
          className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <Download className="h-4 w-4" />
          {t("detail.downloadPdf")}
        </button>

        <button
          type="button"
          onClick={handlePrintPDF}
          className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <Printer className="h-4 w-4" />
          {t("detail.print")}
        </button>

        {canInvoice && (
          <button
            type="button"
            onClick={handleOpenEmailModal}
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <Mail className="h-4 w-4" />
            {t(
              invoice.status === "draft"
                ? "sendConfirmation.title"
                : "list.reminderTitle",
            )}
          </button>
        )}

        {/* Billy Export - only show if connected and not already exported */}
        {canInvoice &&
          integrationStatus?.billyConnected &&
          !invoice.billyInvoiceId && (
            <button
              type="button"
              onClick={() => setShowBillyModal(true)}
              className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border border-green-300 bg-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-green-700 transition-colors hover:bg-green-50 dark:border-green-800 dark:bg-transparent dark:text-green-400 dark:hover:bg-green-900/20"
            >
              <ExternalLink className="h-4 w-4" />
              {t("detail.sendToBilly")}
            </button>
          )}

        {/* Show if already exported to Billy */}
        {invoice.billyInvoiceId && (
          <span className="inline-flex items-center gap-2 rounded-lg bg-green-100 px-4 py-2 text-sm font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <ExternalLink className="h-4 w-4" />
            {t("detail.sentToBilly")}
          </span>
        )}

        {/* Dinero Export - only show if connected and not already exported */}
        {canInvoice &&
          integrationStatus?.dineroConnected &&
          !invoice.dineroInvoiceGuid && (
            <button
              type="button"
              onClick={() => setShowDineroModal(true)}
              className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border border-brand-300 bg-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 dark:border-brand-600 dark:bg-transparent dark:text-brand-400 dark:hover:bg-tt-gran-lys"
            >
              <ExternalLink className="h-4 w-4" />
              {t("detail.sendToDinero")}
            </button>
          )}

        {/* Show if already exported to Dinero */}
        {invoice.dineroInvoiceGuid && (
          <span className="inline-flex items-center gap-2 rounded-lg bg-brand-100 px-4 py-2 text-sm font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400">
            <ExternalLink className="h-4 w-4" />
            {t("detail.sentToDinero")}
          </span>
        )}

        {canInvoice && invoice.status === "draft" && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border border-red-300 bg-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-4 w-4" />
            {tc("delete")}
          </button>
        )}
      </div>

      {/* Invoice Details */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        {/* Main Information */}
        <div className="lg:col-span-2 space-y-4">
          {/* Invoice Info Card */}
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
              {t("detail.about")}
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.invoiceNumber")}
                </dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {formatInvoiceNumber(
                    invoice.invoiceNumber,
                    t("status.draft"),
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.statusLabel")}
                </dt>
                <dd className="mt-1">{getStatusBadge(invoice.status)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.issueDate")}
                </dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  <Calendar className="mr-1 inline-block h-4 w-4 text-gray-400" />
                  {formatDate(invoice.issueDate)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("detail.dueDate")}
                </dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {isEditing && invoice.status === "draft" ? (
                    <input
                      type="date"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                    />
                  ) : (
                    <>
                      <Calendar className="mr-1 inline-block h-4 w-4 text-gray-400" />
                      {formatDate(invoice.dueDate)}
                    </>
                  )}
                </dd>
              </div>
              {invoice.paidDate && (
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {t("detail.paidDate")}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    <Calendar className="mr-1 inline-block h-4 w-4 text-gray-400" />
                    {formatDate(invoice.paidDate)}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <ProviderEmailUncertainBanner invoiceId={id} />

          {/* E-mailstatus */}
          {emailStatus && (
            <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                <Mail className="mr-2 inline-block h-5 w-5" />
                {t("detail.emailStatus")}
              </h2>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  {emailStatus.latestStatus === "delivered" && (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  )}
                  {emailStatus.latestStatus === "opened" && (
                    <MailOpen className="h-5 w-5 text-emerald-500" />
                  )}
                  {emailStatus.latestStatus === "bounced" && (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  {emailStatus.latestStatus === "sent" && (
                    <Mail className="h-5 w-5 text-brand-500 dark:text-brand-400" />
                  )}
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {emailStatus.latestStatus === "delivered" &&
                      t("detail.emailDelivered")}
                    {emailStatus.latestStatus === "opened" &&
                      t("detail.emailOpened")}
                    {emailStatus.latestStatus === "bounced" &&
                      t("detail.emailBounced")}
                    {emailStatus.latestStatus === "sent" &&
                      t("detail.emailSentStatus")}
                    {!["delivered", "opened", "bounced", "sent"].includes(
                      emailStatus.latestStatus,
                    ) && emailStatus.latestStatus}
                  </span>
                </div>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {t("detail.emailTo", { email: emailStatus.recipientEmail })}
                </span>
                <span className="text-sm text-gray-400 dark:text-gray-500">
                  {new Date(emailStatus.sentAt).toLocaleString(
                    toIntlLocale(locale),
                    {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}
                </span>
              </div>
              {emailStatus.openedAt && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {t("detail.emailOpenedAt", {
                    date: new Date(emailStatus.openedAt).toLocaleString(
                      toIntlLocale(locale),
                      {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    ),
                  })}
                </p>
              )}
            </div>
          )}

          {/* Time Entries */}
          {invoice.timeEntries && invoice.timeEntries.length > 0 && (
            <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                <FileText className="mr-2 inline-block h-5 w-5" />
                {t("detail.includedEntries", {
                  count: invoice.timeEntries.length,
                })}
              </h2>
              <div className="space-y-2">
                {invoice.timeEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-800 p-3"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {entry.description || t("detail.noDescription")}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {t("detail.entryMeta", {
                          date: new Date(entry.date).toLocaleDateString(
                            toIntlLocale(locale),
                          ),
                          hours: displayHours(entry.hours),
                        })}
                        {entry.project && ` • ${entry.project.name}`}
                      </p>
                    </div>
                    <div className="text-sm font-medium tabular-nums text-gray-900 dark:text-white">
                      {t("detail.amountKr", {
                        amount: displayAmount(
                          Number.parseFloat(entry.hours) *
                            Number.parseFloat(entry.billableRate || "0"),
                        ),
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invoice Lines Editor */}
          <InvoiceLineEditor
            invoiceId={id}
            readOnly={invoice.status !== "draft"}
          />

          {/* Amount */}
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
              {t("detail.amountTitle")}
            </h2>
            {invoice.timeEntries && invoice.timeEntries.length > 0 && (
              <div className="space-y-2 border-b border-gray-200 dark:border-gray-800 pb-4 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("detail.totalHours")}
                  </span>
                  <span className="tabular-nums text-gray-900 dark:text-white">
                    {t("detail.hoursShort", {
                      hours: displayHours(
                        invoice.timeEntries.reduce(
                          (sum, entry) => sum + Number.parseFloat(entry.hours),
                          0,
                        ),
                      ),
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("detail.entryCount")}
                  </span>
                  <span className="tabular-nums text-gray-900 dark:text-white">
                    {invoice.timeEntries.length}
                  </span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-800 pt-4">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("detail.total")}
              </span>
              {isEditing && invoice.status === "draft" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="w-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-right text-lg font-bold tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  />
                  <span className="text-lg font-bold text-gray-900 dark:text-white">
                    {currency}
                  </span>
                </div>
              ) : (
                <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                  {t("detail.amountKr", {
                    amount: displayAmount(invoice.amount),
                  })}
                </span>
              )}
            </div>
          </div>

          {/* Notes */}
          {(invoice.notes || isEditing) && (
            <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                <FileText className="mr-2 inline-block h-5 w-5" />
                {t("detail.notes")}
              </h2>
              {isEditing ? (
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={4}
                  placeholder={t("detail.notesPlaceholder")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              ) : (
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {invoice.notes}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Client Info */}
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
              <User className="mr-2 inline-block h-5 w-5" />
              {t("detail.client")}
            </h2>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {client?.name}
                </p>
                {client?.company && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {client?.company}
                  </p>
                )}
              </div>
              {client?.email && (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Mail className="h-4 w-4" />
                  {client?.email}
                </div>
              )}
              <Link
                href={`/dashboard/clients/${client?.id}`}
                className="inline-flex items-center gap-2 text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
              >
                {t("detail.viewClient")}
              </Link>
            </div>
          </div>

          {/* PDF Preview */}
          <InvoicePDFViewer
            invoiceId={id}
            invoiceNumber={invoice.invoiceNumber}
          />
        </div>
      </div>

      <SendInvoiceDialog
        invoiceId={showEmailModal ? id : null}
        onClose={closeEmailModal}
        onSend={handleSendEmail}
        recipient={recipientEmail}
        onRecipientChange={setRecipientEmail}
      />

      {/* Billy Export Modal */}
      <BillyExportModal
        isOpen={showBillyModal}
        onClose={() => setShowBillyModal(false)}
        onExport={handleBillyExport}
        invoiceId={id}
        clientEmail={client?.email || undefined}
        isLoading={isExportingToBilly}
      />

      {/* Dinero Export Modal */}
      <DineroExportModal
        isOpen={showDineroModal}
        onClose={() => setShowDineroModal(false)}
        onExport={handleDineroExport}
        invoiceId={id}
        clientEmail={client?.email || undefined}
        isLoading={isExportingToDinero}
      />
      <ConfirmDialog
        isOpen={showCreditConfirm}
        onClose={() => setShowCreditConfirm(false)}
        onConfirm={async () => {
          try {
            await creditNoteMutation.mutateAsync({ invoiceId: id });
            setShowCreditConfirm(false);
          } catch {
            // Fejlen vises af mutationens onError.
          }
        }}
        title={t("detail.creditConfirmTitle")}
        description={t("detail.creditConfirmDescription", {
          number: invoice.invoiceNumber,
        })}
        confirmLabel={t("detail.createCreditNote")}
        variant="warning"
        isLoading={creditNoteMutation.isPending}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={async () => {
          try {
            await deleteMutation.mutateAsync({ id });
            setShowDeleteConfirm(false);
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : t("detail.deleteFailed"),
            );
          }
        }}
        title={t("detail.deleteTitle")}
        description={t("detail.deleteDescription")}
        confirmLabel={tc("delete")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
