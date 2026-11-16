import { Calendar, FileText, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { formatCurrency, formatHours } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { InvoiceDraft, Klippekort } from "@/lib/types";

interface AutoInvoiceDialogProps {
  open: boolean;
  onClose: () => void;
  klippekort: Klippekort;
  onInvoiceCreated: (invoice: InvoiceDraft) => void;
}

interface PreviewLine {
  description: string;
  hours: number;
  rate: number;
  amount: number;
  entry_count: number;
}

interface AutoInvoicePreview {
  entry_count: number;
  total_hours: number;
  total_amount: number;
  lines: PreviewLine[];
}

type PeriodPreset = "this_month" | "last_month" | "custom";

function getMonthRange(offset: number): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + offset;

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);

  return {
    from: formatDate(start),
    to: formatDate(end),
  };
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function AutoInvoiceDialog({
  open,
  onClose,
  klippekort,
  onInvoiceCreated,
}: AutoInvoiceDialogProps) {
  const { t } = useTranslation();

  const [preset, setPreset] = useState<PeriodPreset>("this_month");
  const [from, setFrom] = useState(() => getMonthRange(0).from);
  const [to, setTo] = useState(() => getMonthRange(0).to);
  const [preview, setPreview] = useState<AutoInvoicePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update from/to when preset changes
  useEffect(() => {
    if (preset === "this_month") {
      const range = getMonthRange(0);
      setFrom(range.from);
      setTo(range.to);
    } else if (preset === "last_month") {
      const range = getMonthRange(-1);
      setFrom(range.from);
      setTo(range.to);
    }
  }, [preset]);

  // Load preview when dates or dialog state change
  const loadPreview = useCallback(async () => {
    if (!open || !from || !to) return;
    setLoading(true);
    setError(null);
    try {
      const result = await tauriInvoke<AutoInvoicePreview>(
        "preview_klippekort_invoice",
        {
          klippekortId: klippekort.id,
          from,
          to,
        },
      );
      setPreview(result);
    } catch (err) {
      setError(String(err));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [open, klippekort.id, from, to]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const invoice = await tauriInvoke<InvoiceDraft>(
        "generate_invoice_from_klippekort",
        {
          klippekortId: klippekort.id,
          from,
          to,
        },
      );
      onInvoiceCreated(invoice);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  }

  const presetOptions: { value: PeriodPreset; label: string }[] = [
    { value: "this_month", label: t("autoInvoice.thisMonth") },
    {
      value: "last_month",
      label: t("autoInvoice.lastMonth"),
    },
    { value: "custom", label: t("autoInvoice.custom") },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("autoInvoice.title")}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleGenerate}
            disabled={
              generating || loading || !preview || preview.entry_count === 0
            }
          >
            {generating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("autoInvoice.generating")}
              </>
            ) : (
              <>
                <FileText size={14} />
                {t("autoInvoice.generate")}
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Klippekort info */}
        <div className="rounded-lg border border-(--color-border) bg-(--color-bg) p-3">
          <p className="text-xs text-(--color-text-muted)">
            {t("autoInvoice.klippekort")}
          </p>
          <p className="text-sm font-semibold text-(--color-text)">
            {klippekort.name}
          </p>
          <p className="text-xs text-(--color-text-muted)">
            {klippekort.client_name}
          </p>
        </div>

        {/* Period selector */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-(--color-text-muted)">
            {t("autoInvoice.period")}
          </span>
          <div className="flex gap-1.5">
            {presetOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPreset(opt.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  preset === opt.value
                    ? "bg-(--color-accent) text-white"
                    : "bg-(--color-bg) text-(--color-text-muted) hover:bg-(--color-border)/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          {preset === "custom" && (
            <div className="flex items-center gap-2">
              <label className="flex-1">
                <span className="text-[10px] text-(--color-text-muted) mb-1 block">
                  {t("autoInvoice.from")}
                </span>
                <div className="relative">
                  <Calendar
                    size={12}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
                  />
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full rounded-md border border-(--color-border) bg-(--color-bg) pl-7 pr-2 py-1.5 text-xs text-(--color-text)"
                  />
                </div>
              </label>
              <label className="flex-1">
                <span className="text-[10px] text-(--color-text-muted) mb-1 block">
                  {t("autoInvoice.to")}
                </span>
                <div className="relative">
                  <Calendar
                    size={12}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
                  />
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full rounded-md border border-(--color-border) bg-(--color-bg) pl-7 pr-2 py-1.5 text-xs text-(--color-text)"
                  />
                </div>
              </label>
            </div>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2
              size={20}
              className="animate-spin text-(--color-text-muted)"
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Preview */}
        {!loading && preview && (
          <div className="space-y-2">
            {preview.entry_count === 0 ? (
              <div className="rounded-lg border border-(--color-border) bg-(--color-bg) p-4 text-center">
                <p className="text-xs text-(--color-text-muted)">
                  {t("autoInvoice.noEntries")}
                </p>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="flex items-center gap-4 rounded-lg border border-(--color-border) bg-(--color-bg) p-3">
                  <div>
                    <p className="text-[10px] text-(--color-text-muted)">
                      {t("autoInvoice.entries")}
                    </p>
                    <p className="text-sm font-semibold text-(--color-text)">
                      {preview.entry_count}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-(--color-text-muted)">
                      {t("autoInvoice.hours")}
                    </p>
                    <p className="text-sm font-semibold text-(--color-text)">
                      {formatHours(preview.total_hours)}
                    </p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-[10px] text-(--color-text-muted)">
                      {t("autoInvoice.subtotal")}
                    </p>
                    <p className="text-sm font-semibold text-(--color-text)">
                      {formatCurrency(preview.total_amount, 2)}
                    </p>
                  </div>
                </div>

                {/* Lines preview */}
                <div className="max-h-40 overflow-y-auto rounded-lg border border-(--color-border)">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-(--color-border) bg-(--color-bg)">
                        <th className="px-3 py-1.5 text-left font-medium text-(--color-text-muted)">
                          {t("autoInvoice.description")}
                        </th>
                        <th className="px-3 py-1.5 text-right font-medium text-(--color-text-muted)">
                          {t("autoInvoice.hoursShort")}
                        </th>
                        <th className="px-3 py-1.5 text-right font-medium text-(--color-text-muted)">
                          {t("autoInvoice.amount")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((line) => (
                        <tr
                          key={`${line.description}-${line.rate}`}
                          className="border-b border-(--color-border)/50 last:border-0"
                        >
                          <td className="px-3 py-1.5 text-(--color-text)">
                            {line.description}
                            <span className="ml-1 text-(--color-text-muted)">
                              ({line.entry_count})
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-(--color-text-muted)">
                            {formatHours(line.hours)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-(--color-text)">
                            {formatCurrency(line.amount, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* VAT note */}
                <p className="text-[10px] text-(--color-text-muted)">
                  {t("autoInvoice.vatNote")}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
