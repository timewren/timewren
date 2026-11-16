"use client";

import {
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Save,
  Send,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import {
  BillyExportModal,
  type BillyExportSettings,
} from "@/components/invoices/BillyExportModal";
import {
  DineroExportModal,
  type DineroExportSettings,
} from "@/components/invoices/DineroExportModal";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { formatCurrency, formatTime, toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

interface CreateInvoiceSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
  clientEmail?: string | null;
  selectedEntryIds: string[];
  totalHours: number;
  totalValue: number;
  onSuccess: () => void;
}

type Destination = "draft" | "send" | "billy" | "dinero";

export function CreateInvoiceSlideOver({
  isOpen,
  onClose,
  clientId,
  clientName,
  clientEmail,
  selectedEntryIds,
  totalHours,
  totalValue,
  onSuccess,
}: CreateInvoiceSlideOverProps) {
  const fid = useId();
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  useEscapeKey(onClose, isOpen);
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    // Default to 14 days from now
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return toLocalDateStr(date);
  });
  const [destination, setDestination] = useState<Destination>("draft");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Billy export modal state
  const [showBillyModal, setShowBillyModal] = useState(false);
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);

  // Dinero export modal state
  const [showDineroModal, setShowDineroModal] = useState(false);

  const utils = trpc.useUtils();

  // Get next invoice number
  const { data: nextNumber } = trpc.invoices.getNextInvoiceNumber.useQuery();

  const createInvoiceMutation = trpc.invoices.create.useMutation({
    onSuccess: async (_invoice) => {
      // For Billy/Dinero, don't close yet - let handleSubmit show the modal
      if (destination === "billy" || destination === "dinero") {
        return; // handleSubmit will handle the rest
      }

      // Handle different destinations
      if (destination === "send") {
        toast.success(t("createInvoice.sentToClient"));
      } else {
        toast.success(t("createInvoice.savedAsDraft"));
      }

      // Invalidate relevant queries
      utils.invoices.list.invalidate();
      utils.time.list.invalidate();

      onSuccess();
      onClose();
    },
    onError: (error) => {
      toast.error(error.message || t("createInvoice.createFailed"));
      setIsSubmitting(false);
    },
  });

  const exportToBillyMutation =
    trpc.integrations.exportInvoiceToBilly.useMutation();
  const exportToDineroMutation =
    trpc.integrations.exportInvoiceToDinero.useMutation();

  const handleSubmit = async () => {
    if (selectedEntryIds.length === 0) {
      toast.error(t("createInvoice.selectEntries"));
      return;
    }

    setIsSubmitting(true);

    try {
      // Create the invoice
      const invoice = await createInvoiceMutation.mutateAsync({
        clientId,
        amount: totalValue.toFixed(2),
        issueDate: toLocalDateStr(new Date()),
        dueDate,
        notes: notes || undefined,
        status: destination === "draft" ? "draft" : "sent",
        timeEntryIds: selectedEntryIds,
      });

      // Handle integration exports
      if (destination === "billy") {
        // Show Billy settings modal before exporting
        setPendingInvoiceId(invoice.id);
        setShowBillyModal(true);
        setIsSubmitting(false);
        return; // Don't close yet - wait for modal
      } else if (destination === "dinero") {
        // Show Dinero settings modal before exporting
        setPendingInvoiceId(invoice.id);
        setShowDineroModal(true);
        setIsSubmitting(false);
        return; // Don't close yet - wait for modal
      }
    } catch (_error) {
      // Fejlen vises af mutationens onError — frigiv knappen igen
      setIsSubmitting(false);
    }
  };

  // Handle Billy export after modal submission
  const handleBillyExport = async (settings: BillyExportSettings) => {
    if (!pendingInvoiceId) return;

    setIsSubmitting(true);
    try {
      await exportToBillyMutation.mutateAsync({
        invoiceId: pendingInvoiceId,
        action: settings.action,
        productId: settings.productId,
        paymentTermsDays: settings.paymentTermsDays,
        contactMessage: settings.contactMessage || undefined,
        lineType: settings.lineType,
        lineTemplate: settings.lineTemplate,
      });
      toast.success(t("createInvoice.exportedBilly"));

      // Invalidate relevant queries
      utils.invoices.list.invalidate();
      utils.time.list.invalidate();

      onSuccess();
      onClose();
    } catch (_err) {
      toast.warning(t("createInvoice.exportBillyFailed"));
      // Still close the slide-over since invoice was created
      onSuccess();
      onClose();
    } finally {
      setIsSubmitting(false);
      setShowBillyModal(false);
      setPendingInvoiceId(null);
    }
  };

  // Handle Dinero export after modal submission
  const handleDineroExport = async (settings: DineroExportSettings) => {
    if (!pendingInvoiceId) return;

    setIsSubmitting(true);
    try {
      await exportToDineroMutation.mutateAsync({
        invoiceId: pendingInvoiceId,
        action: settings.action,
        accountNumber: settings.accountNumber,
        paymentTermsDays: settings.paymentTermsDays,
        contactMessage: settings.contactMessage || undefined,
        lineType: settings.lineType,
        lineTemplate: settings.lineTemplate,
      });
      toast.success(t("createInvoice.exportedDinero"));

      // Invalidate relevant queries
      utils.invoices.list.invalidate();
      utils.time.list.invalidate();

      onSuccess();
      onClose();
    } catch (_err) {
      toast.warning(t("createInvoice.exportDineroFailed"));
      // Still close the slide-over since invoice was created
      onSuccess();
      onClose();
    } finally {
      setIsSubmitting(false);
      setShowDineroModal(false);
      setPendingInvoiceId(null);
    }
  };

  // Reset form when opening
  useEffect(() => {
    if (isOpen) {
      setNotes("");
      setDestination("draft");
      const date = new Date();
      date.setDate(date.getDate() + 14);
      setDueDate(toLocalDateStr(date));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-gray-900 shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
              <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t("createInvoice.title")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {clientName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc("close")}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Summary */}
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("createInvoice.entries")}
                </p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {selectedEntryIds.length}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("createInvoice.hours")}
                </p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {formatTime(totalHours)}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("createInvoice.totalAmount")}
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(totalValue)}
              </p>
            </div>
          </div>

          {/* Invoice number */}
          <div>
            <label
              htmlFor={`${fid}-f1`}
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              {t("createInvoice.invoiceNumber")}
            </label>
            <input
              id={`${fid}-f1`}
              type="text"
              value={nextNumber || "..."}
              disabled
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
            />
          </div>

          {/* Due date */}
          <div>
            <label
              htmlFor={`${fid}-f2`}
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              {t("createInvoice.dueDate")}
            </label>
            <input
              id={`${fid}-f2`}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              min={toLocalDateStr(new Date())}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <div className="mt-2 flex gap-2">
              {[7, 14, 30].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => {
                    const date = new Date();
                    date.setDate(date.getDate() + days);
                    setDueDate(toLocalDateStr(date));
                  }}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  {t("createInvoice.days", { count: days })}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor={`${fid}-f3`}
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              {t("createInvoice.notesLabel")}
            </label>
            <textarea
              id={`${fid}-f3`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t("createInvoice.notesPlaceholder")}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {/* Destination */}
          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              {t("createInvoice.action")}
            </span>
            <div className="grid grid-cols-2 gap-3">
              <DestinationButton
                active={destination === "draft"}
                onClick={() => setDestination("draft")}
                icon={Save}
                label={t("createInvoice.saveDraft")}
                description={t("createInvoice.saveDraftHint")}
              />
              <DestinationButton
                active={destination === "send"}
                onClick={() => setDestination("send")}
                icon={Send}
                label={t("createInvoice.sendToClient")}
                description={
                  clientEmail
                    ? t("createInvoice.sendTo", { email: clientEmail })
                    : t("createInvoice.emailRequired")
                }
                disabled={!clientEmail}
              />
              <DestinationButton
                active={destination === "billy"}
                onClick={() => setDestination("billy")}
                icon={ExternalLink}
                label={t("createInvoice.exportBilly")}
                description={t("createInvoice.exportBillyHint")}
              />
              <DestinationButton
                active={destination === "dinero"}
                onClick={() => setDestination("dinero")}
                icon={ExternalLink}
                label={t("createInvoice.exportDinero")}
                description={t("createInvoice.exportDineroHint")}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              {tc("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || selectedEntryIds.length === 0}
              className="flex-1 rounded-lg bg-tt-gran px-4 py-2.5 font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("createInvoice.creating")}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {t("createInvoice.title")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Billy Export Modal */}
      <BillyExportModal
        isOpen={showBillyModal}
        onClose={() => {
          setShowBillyModal(false);
          setPendingInvoiceId(null);
          // Invoice was created, so complete the flow
          if (pendingInvoiceId) {
            toast.info(t("createInvoice.exportCancelled"));
            utils.invoices.list.invalidate();
            utils.time.list.invalidate();
            onSuccess();
            onClose();
          }
        }}
        onExport={handleBillyExport}
        invoiceId={pendingInvoiceId || ""}
        clientEmail={clientEmail || undefined}
        isLoading={isSubmitting}
      />

      {/* Dinero Export Modal */}
      <DineroExportModal
        isOpen={showDineroModal}
        onClose={() => {
          setShowDineroModal(false);
          setPendingInvoiceId(null);
          // Invoice was created, so complete the flow
          if (pendingInvoiceId) {
            toast.info(t("createInvoice.exportCancelled"));
            utils.invoices.list.invalidate();
            utils.time.list.invalidate();
            onSuccess();
            onClose();
          }
        }}
        onExport={handleDineroExport}
        invoiceId={pendingInvoiceId || ""}
        clientEmail={clientEmail || undefined}
        isLoading={isSubmitting}
      />
    </>
  );
}

// Helper component for destination buttons
function DestinationButton({
  active,
  onClick,
  icon: Icon,
  label,
  description,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-colors ${
        active
          ? "border-brand-600 bg-brand-50 dark:bg-tt-gran-lys"
          : disabled
            ? "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 opacity-50 cursor-not-allowed"
            : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon
          className={`h-4 w-4 ${
            active ? "text-brand-600 dark:text-brand-400" : "text-gray-400"
          }`}
        />
        <span
          className={`text-sm font-medium ${
            active
              ? "text-brand-600 dark:text-brand-400"
              : "text-gray-700 dark:text-gray-300"
          }`}
        >
          {label}
        </span>
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {description}
      </span>
    </button>
  );
}
