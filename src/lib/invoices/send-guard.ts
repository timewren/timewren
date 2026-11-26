import type { db as DbClient } from "@/lib/db";
import type { buildInvoicePdfProps } from "@/lib/invoice-pdf";
import { findUncertainProviderEmail } from "@/lib/invoices/provider-export-state";
import {
  invoiceSendReview,
  matchesInvoiceReview,
  type ReviewedInvoice,
} from "@/lib/invoices/send-review";

/**
 * Why TimeTrack must not mail the invoice now, as a `serverErrors` key, or
 * null when it may. Shared by tRPC `invoices.sendEmail` and the REST send
 * route, so every send path refuses the same cases:
 * - Billy or Dinero may already have mailed it (uncertain result), until the
 *   user has checked the accounting system.
 * - The invoice changed after the user confirmed it in SendInvoiceDialog
 *   (only when the caller passes what was confirmed).
 */
export async function invoiceSendBlocker(
  database: Pick<typeof DbClient, "query">,
  pdfData: NonNullable<Awaited<ReturnType<typeof buildInvoicePdfProps>>>,
  recipient: string,
  expected: ReviewedInvoice | undefined,
) {
  if (await findUncertainProviderEmail(database, pdfData.invoice)) {
    return "invoices.providerEmailUncertain" as const;
  }
  if (
    expected &&
    !matchesInvoiceReview(expected, invoiceSendReview(pdfData, recipient))
  ) {
    return "invoices.sendReviewChanged" as const;
  }
  return null;
}
