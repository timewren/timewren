/**
 * Fakturaens beløb, som PDF'en viser dem: subtotal (linjernes sum, ellers
 * fakturaens beløb), moms efter skabelonens sats, når virksomheden er
 * momsregistreret, og total. Begge PDF-motorer (InvoicePDF og
 * InvoiceDocument), afsendelsens forhåndsvisning og device-API'ets
 * `extension.invoices.totals` regner herfra, så de aldrig kan vise
 * forskellige tal.
 */
export interface InvoicePdfTotalsInput {
  invoice: {
    amount: string;
    lines?: { amount: string }[] | null;
  };
  companyProfile?: { vatRegistered: boolean | null } | null;
  template?: { vatRate: string | null; currency: string | null } | null;
  /** Kontoens valuta (demo-konti); vinder over skabelonens. */
  currency?: string;
}

export interface InvoicePdfTotals {
  currency: string;
  vatRate: number;
  showVat: boolean;
  subtotal: number;
  vatAmount: number;
  total: number;
}

export function invoicePdfTotals({
  invoice,
  companyProfile,
  template,
  currency: accountCurrency,
}: InvoicePdfTotalsInput): InvoicePdfTotals {
  const currency = accountCurrency || template?.currency || "DKK";
  const vatRate = Number.parseFloat(template?.vatRate || "25.00");
  const showVat = companyProfile?.vatRegistered === true;
  const lines = invoice.lines ?? [];
  const subtotal =
    lines.length > 0
      ? lines.reduce((sum, line) => sum + Number.parseFloat(line.amount), 0)
      : Number.parseFloat(invoice.amount);
  const vatAmount = showVat ? subtotal * (vatRate / 100) : 0;
  return {
    currency,
    vatRate,
    showVat,
    subtotal,
    vatAmount,
    total: subtotal + vatAmount,
  };
}
