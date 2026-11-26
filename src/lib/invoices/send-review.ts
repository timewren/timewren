import { z } from "zod";
import type { buildInvoicePdfProps } from "@/lib/invoice-pdf";
import { invoicePdfTotals } from "@/lib/invoices/pdf-totals";

/**
 * What SendInvoiceDialog showed the user before they confirmed a send. The
 * server rebuilds the same review right before sending and refuses the send
 * when it no longer matches, so an invoice edited (or a client changed) after
 * the dialog opened is never sent unseen.
 */
export const reviewedInvoiceSchema = z.object({
  invoiceNumber: z.string(),
  /** Total as the PDF shows it: incl. VAT when the company is VAT registered. */
  total: z.number(),
  currency: z.string(),
  /** Lines on the PDF: the invoice lines, else the time entries. */
  lineCount: z.number().int().nonnegative(),
  /** The address the user confirmed the invoice goes to. */
  recipient: z.string(),
});

export type ReviewedInvoice = z.infer<typeof reviewedInvoiceSchema>;

type InvoicePdfData = NonNullable<
  Awaited<ReturnType<typeof buildInvoicePdfProps>>
>;

/** The review of an invoice as it would be sent now. */
export function invoiceSendReview(
  { invoice, pdfProps }: Pick<InvoicePdfData, "invoice" | "pdfProps">,
  recipient: string,
): ReviewedInvoice {
  const totals = invoicePdfTotals(pdfProps);
  return {
    invoiceNumber: invoice.invoiceNumber,
    total: totals.total,
    currency: totals.currency,
    lineCount:
      pdfProps.invoice.lines.length ||
      (pdfProps.invoice.timeEntries?.length ?? 0),
    recipient: normalizeRecipient(recipient),
  };
}

export function normalizeRecipient(email: string | null | undefined) {
  return (email ?? "").trim().toLowerCase();
}

/** Amounts are compared in whole øre, as the dialog shows two decimals. */
export function matchesInvoiceReview(
  expected: ReviewedInvoice,
  actual: ReviewedInvoice,
) {
  return (
    expected.invoiceNumber === actual.invoiceNumber &&
    Math.round(expected.total * 100) === Math.round(actual.total * 100) &&
    expected.currency === actual.currency &&
    expected.lineCount === actual.lineCount &&
    normalizeRecipient(expected.recipient) ===
      normalizeRecipient(actual.recipient)
  );
}
