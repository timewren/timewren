import { eq } from "drizzle-orm";
import { tr } from "@/i18n/server-text";
import { invoices } from "@/lib/db/schema";
import { conflict, Errors } from "@/lib/trpc/errors";

/**
 * Row-lock fakturaen i den skrivende transaktion og bekræft, at statussen
 * stadig er den, mutationen validerede imod (#1110).
 *
 * update/transition/delete læser og validerer statussen uden for
 * transaktionen. Uden låsen kan fx en sletning og en udstedelse af samme
 * kladde køre samtidig: sletningen frigiver de nu fakturerede tidsposter,
 * eller udstedelsen forbruger et fakturanummer på en slettet faktura.
 * Låsen tages før fakturanummer-serien (advisory lock), samme rækkefølge som
 * createCreditNote, så der ikke opstår deadlocks.
 */
export async function lockInvoiceStatus(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx typing is complex
  tx: any,
  invoiceId: string,
  expectedStatus: string | null,
): Promise<{ id: string; invoiceNumber: string; status: string | null }> {
  const [locked] = await tx
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .for("update");
  if (!locked) {
    throw Errors.invoiceNotFound();
  }
  if (locked.status !== expectedStatus) {
    throw conflict(await tr("serverErrors", "invoices.statusChangedElsewhere"));
  }
  return locked;
}
