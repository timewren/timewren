import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type {
  CreateLineInput,
  InvoiceDraft,
  InvoiceLine,
  UpdateInvoiceInput,
  UpdateLineInput,
} from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface InvoiceEditorProps {
  invoice: InvoiceDraft;
  onBack: () => void;
  onUpdated: (invoice: InvoiceDraft) => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-400",
  sent: "bg-blue-500/15 text-blue-400",
  exported: "bg-emerald-500/15 text-emerald-400",
};

/**
 * Status er en nøgle, ikke en etiket: etiketten lå som dansk i `STATUS_LABELS`,
 * så etiketten på fakturaens badge var den ene del af skærmen, en svensk bruger
 * aldrig kunne få oversat. En status koden ikke kender viser sit rå navn — en
 * ny tilstand må ikke låne en andens etiket, fordi den deler nøgle med den.
 */
const STATUS_KEYS: Record<string, string> = {
  draft: "invoices.draft",
  sent: "invoices.sent",
  exported: "invoices.exported",
};

export function InvoiceEditor({
  invoice,
  onBack,
  onUpdated,
}: InvoiceEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(invoice.title || "");
  const [dueDate, setDueDate] = useState(invoice.due_date || "");
  const [notes, setNotes] = useState(invoice.notes || "");
  const [vatRate, setVatRate] = useState(invoice.vat_rate);
  const [lines, setLines] = useState<InvoiceLine[]>(invoice.lines);
  const [exporting, setExporting] = useState(false);
  const [billyExporting, setBillyExporting] = useState(false);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + (l.amount || 0), 0),
    [lines],
  );
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  /**
   * Gemmer fakturaens felter. **Returnerer om det lykkedes.**
   *
   * Returværdien er hele pointen: `handleExportPdf` og `handleBillyExport`
   * kalder denne før de sender noget, og de må ikke færdiggøre en faktura på
   * de gamle felter. Den gamle kode slugte fejlen, så en låst database gav en
   * PDF med den gamle titel og den gamle betalingsdato — sendt til kunden som
   * om det var den brugeren lige havde skrevet.
   */
  const saveInvoice = useCallback(async (): Promise<boolean> => {
    try {
      const input: UpdateInvoiceInput = {
        id: invoice.id,
        title: title || null,
        due_date: dueDate || null,
        notes: notes || null,
        vat_rate: vatRate,
      };
      const updated = await tauriInvoke<InvoiceDraft>("update_invoice", {
        input,
      });
      onUpdated(updated);
      return true;
    } catch (err) {
      console.error("Failed to save invoice:", err);
      toast.error(t("invoices.couldNotSave"));
      return false;
    }
  }, [invoice.id, title, dueDate, notes, vatRate, onUpdated, t]);

  /**
   * Genindlæser fakturaen, så totalerne på skærmen følger det der står i
   * databasen.
   *
   * Kaldes **efter** en skrivning der allerede er lykkedes. Derfor har den
   * sin egen fejl: en fejl her må ikke sige «kunne ikke gemme linjen», for
   * linjen ligger gemt — kun totalerne er ude af trit. Den gamle kode havde
   * begge kalde i én `try`, så en låst database efter en vellykket skrivning
   * sagde til brugeren, at hans ændring var gået tabt, og han ville prøve igen.
   */
  async function genindlæsEfterSkrivning() {
    try {
      const updated = await tauriInvoke<InvoiceDraft>("get_invoice", {
        id: invoice.id,
      });
      onUpdated(updated);
    } catch (err) {
      console.error("Failed to refresh invoice after write:", err);
      toast.error(t("invoices.couldNotShowTotals"));
    }
  }

  async function addLine() {
    const newLine: CreateLineInput = {
      // Foreslået beskrivelse. Den skrives i fakturaen og kommer med i den
      // eksporterede PDF, så den følger og med sprog — brugeren er ment til at
      // overskrive den.
      description: t("invoices.newLine"),
      quantity: 1,
      unit_price: 0,
      amount: 0,
      sort_order: lines.length,
    };
    try {
      const line = await tauriInvoke<InvoiceLine>("add_invoice_line", {
        invoiceId: invoice.id,
        line: newLine,
      });
      setLines((prev) => [...prev, line]);
    } catch (err) {
      console.error("Failed to add line:", err);
      toast.error(t("invoices.couldNotAddLine"));
      return;
    }
    await genindlæsEfterSkrivning();
  }

  async function removeLine(lineId: number) {
    try {
      await tauriInvoke("remove_invoice_line", { lineId });
      setLines((prev) => prev.filter((l) => l.id !== lineId));
    } catch (err) {
      console.error("Failed to remove line:", err);
      toast.error(t("invoices.couldNotRemoveLine"));
      return;
    }
    await genindlæsEfterSkrivning();
  }

  async function updateLineLocal(
    lineId: number,
    field: keyof InvoiceLine,
    value: string,
  ) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const updated = { ...l };
        if (field === "description") {
          updated.description = value;
        } else if (field === "quantity") {
          updated.quantity = Number.parseFloat(value) || 0;
          updated.amount = (updated.quantity || 0) * (updated.unit_price || 0);
        } else if (field === "unit_price") {
          updated.unit_price = Number.parseFloat(value) || 0;
          updated.amount = (updated.quantity || 0) * (updated.unit_price || 0);
        }
        return updated;
      }),
    );
  }

  /**
   * Skriver den redigerede linje tilbage.
   *
   * Den gamle kode slettede linjen og oprettede den igen, fordi der ikke var
   * en opdateringskommando. Det var **to** skrivninger, så en fejl i den anden
   * efterlod fakturaen uden linjen: brugeren rettede en enhedspris, skærmen
   * viste den nye pris og et nyt beløb, og den reelle faktura — den han er ved
   * at sende til kunden — havde mistet den post. Nu er det én `UPDATE`, der
   * enten lykkes helt eller fejler helt, og fejlen er synlig.
   *
   * `time_entry_id` sendes ikke med: bindingen til den registrerede tid hører
   * til den række der redigeres, og den læses derfra.
   */
  async function saveLineToBackend(lineId: number) {
    const line = lines.find((l) => l.id === lineId);
    if (!line) return;
    try {
      const rettet: UpdateLineInput = {
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        amount: line.amount,
        sort_order: line.sort_order,
      };
      const saved = await tauriInvoke<InvoiceLine>("update_invoice_line", {
        lineId,
        line: rettet,
      });
      setLines((prev) => prev.map((l) => (l.id === lineId ? saved : l)));
    } catch (err) {
      console.error("Failed to save line:", err);
      // Skærmen viste den rettede pris, men den lå aldrig i databasen. Uden
      // denne besked stod brugeren med et beløb, der ikke findes nogen steder.
      toast.error(t("invoices.couldNotSaveLine"));
      return;
    }
    await genindlæsEfterSkrivning();
  }

  async function handleExportCsv() {
    if (!dueDate) return;
    setExporting(true);
    try {
      // Use invoice date range or last 30 days as fallback
      const from = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const to = new Date().toISOString();

      const csv = await tauriInvoke<string>("export_time_entries_csv", {
        from,
        to,
        separator: ";",
        dateFormat: "DD-MM-YYYY",
      });

      // Download via Blob
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `faktura-${invoice.id.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV export failed:", err);
      toast.error(t("invoices.exportCsvFailed"));
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPdf() {
    setExporting(true);
    try {
      // Gem ændringerne først. Kunde de ikke gemmes, må vi ikke færdiggøre
      // og sende: PDF'en ville få den gamle titel, den gamle betalingsdato og
      // den gamle momssats, uden at brugeren ved det.
      if (!(await saveInvoice())) return;

      // Finalise: assign the legal invoice number atomically and validate the
      // required sender fields. Blocks with a Danish error if anything is missing.
      let finalized: InvoiceDraft;
      try {
        finalized = await tauriInvoke<InvoiceDraft>("finalize_invoice", {
          invoiceId: invoice.id,
        });
      } catch (err) {
        // Rust kan give en streng, og den er allerede dansk, fordi backend'en
        // ikke kender brugerens sprog. Kun den anden gren er oversat — den er
        // den, der er synlig, når backend'en svarer med noget andet end tekst.
        toast.error(
          typeof err === "string" ? err : t("invoices.finalizeFailed"),
        );
        return;
      }
      onUpdated(finalized);

      const html = await tauriInvoke<string>("generate_invoice_html", {
        invoiceId: invoice.id,
      });

      // Open in a new window for print
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      }
    } catch (err) {
      console.error("PDF export failed:", err);
      toast.error(t("invoices.exportPdfFailed"));
    } finally {
      setExporting(false);
    }
  }

  async function handleBillyExport() {
    setBillyExporting(true);
    try {
      // Samme som PDF-vejen: en fejlet gemning må ikke føre til en sendt
      // faktura bygget på de gamle felter.
      if (!(await saveInvoice())) return;

      // Get Billy API key from settings
      const apiKey = await tauriInvoke<string | null>("get_setting", {
        key: "billy_api_key",
      });

      if (!apiKey) {
        toast.error(t("invoices.billyNoApiKey"));
        return;
      }

      await tauriInvoke<string>("export_invoice_to_billy", {
        invoiceId: invoice.id,
        apiKey,
      });

      toast.success(t("invoices.exportedToBilly"));

      // Refresh invoice to get updated status
      const updated = await tauriInvoke<InvoiceDraft>("get_invoice", {
        id: invoice.id,
      });
      onUpdated(updated);
    } catch (err) {
      console.error("Billy export failed:", err);
      toast.error(t("invoices.billyExportFailed"));
    } finally {
      setBillyExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("common.back")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-text-muted) hover:bg-(--color-border)/40 hover:text-(--color-text) transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveInvoice}
            className="text-lg font-semibold text-(--color-text) bg-transparent border-none outline-none w-full"
            placeholder={t("invoices.titlePlaceholder")}
            aria-label={t("invoices.titleField")}
          />
          <p className="text-xs text-(--color-text-muted)">
            {invoice.client_name}
            {invoice.invoice_number ? ` · ${invoice.invoice_number}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            STATUS_COLORS[invoice.status] || STATUS_COLORS.draft
          }`}
        >
          {t(STATUS_KEYS[invoice.status] ?? invoice.status)}
        </span>
      </div>

      {/* Meta fields */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="invoice-due-date"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("invoices.dueDate")}
          </label>
          <input
            id="invoice-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            onBlur={saveInvoice}
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="invoice-vat-rate"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("invoices.vatRate")}
          </label>
          <input
            id="invoice-vat-rate"
            type="number"
            value={vatRate}
            onChange={(e) => setVatRate(Number.parseFloat(e.target.value) || 0)}
            onBlur={saveInvoice}
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
          />
        </div>
      </div>

      {/* Line items table */}
      <div className="rounded-lg border border-(--color-border) overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-(--color-bg)">
              <th className="px-3 py-2 text-left text-xs font-medium text-(--color-text-muted) uppercase tracking-wider">
                {t("invoices.description")}
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-(--color-text-muted) uppercase tracking-wider w-24">
                {t("invoices.quantity")}
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-(--color-text-muted) uppercase tracking-wider w-28">
                {t("invoices.unitPrice")}
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-(--color-text-muted) uppercase tracking-wider w-28">
                {t("invoices.amount")}
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr
                key={line.id}
                className="border-t border-(--color-border) hover:bg-(--color-border)/20 transition-colors"
              >
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={line.description || ""}
                    aria-label={t("invoices.description")}
                    onChange={(e) =>
                      updateLineLocal(line.id, "description", e.target.value)
                    }
                    onBlur={() => saveLineToBackend(line.id)}
                    className="w-full bg-transparent text-sm text-(--color-text) outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    value={line.quantity ?? ""}
                    aria-label={t("invoices.quantity")}
                    onChange={(e) =>
                      updateLineLocal(line.id, "quantity", e.target.value)
                    }
                    onBlur={() => saveLineToBackend(line.id)}
                    className="w-full bg-transparent text-sm text-(--color-text) text-right outline-none font-mono"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    value={line.unit_price ?? ""}
                    aria-label={t("invoices.unitPrice")}
                    onChange={(e) =>
                      updateLineLocal(line.id, "unit_price", e.target.value)
                    }
                    onBlur={() => saveLineToBackend(line.id)}
                    className="w-full bg-transparent text-sm text-(--color-text) text-right outline-none font-mono"
                  />
                </td>
                <td className="px-3 py-2 text-right text-sm font-mono font-medium text-(--color-text)">
                  {formatCurrency(line.amount || 0)}
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    aria-label={t("invoices.removeLine")}
                    className="flex h-6 w-6 items-center justify-center rounded text-(--color-text-muted) hover:bg-red-500/15 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-(--color-border) px-3 py-2">
          <button
            type="button"
            onClick={addLine}
            className="flex items-center gap-1.5 text-xs text-(--color-accent) hover:text-(--color-accent-hover) transition-colors"
          >
            <Plus size={12} />
            {t("invoices.addLine")}
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="flex justify-end">
        <div className="w-64 flex flex-col gap-1">
          <div className="flex justify-between text-sm text-(--color-text-muted)">
            <span>{t("invoices.subtotal")}</span>
            <span className="font-mono">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-(--color-text-muted)">
            <span>{t("invoices.vat", { rate: vatRate })}</span>
            <span className="font-mono">{formatCurrency(vatAmount)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold text-(--color-text) border-t border-(--color-border) pt-1 mt-1">
            <span>{t("invoices.total")}</span>
            <span className="font-mono">{formatCurrency(total)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="invoice-notes"
          className="text-xs font-medium text-(--color-text-muted)"
        >
          {t("common.notes")}
        </label>
        <textarea
          id="invoice-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveInvoice}
          rows={3}
          placeholder={t("invoices.notesPlaceholder")}
          className="rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 focus:border-(--color-accent) focus:outline-none resize-none"
        />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 border-t border-(--color-border) pt-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleExportCsv}
          disabled={exporting}
        >
          <Download size={14} />
          {t("invoices.exportCsv")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleExportPdf}
          disabled={exporting}
        >
          <FileText size={14} />
          {exporting ? t("invoices.generating") : t("invoices.exportPdf")}
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={handleBillyExport}
          disabled={billyExporting || invoice.status === "exported"}
        >
          {billyExporting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          {billyExporting ? t("invoices.exporting") : t("invoices.sendToBilly")}
        </Button>
      </div>
    </div>
  );
}
