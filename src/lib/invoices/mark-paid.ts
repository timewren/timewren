import { and, eq, isNull, ne } from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { emitWebhookEvent } from "@/lib/webhooks/events";

/**
 * Markér en faktura betalt og send `invoice.paid`-webhooken (#1110).
 *
 * Fælles vej for regnskabssync (cron, Billy/Dinero-webhooks) og de manuelle
 * "tjek status"-knapper, som før satte status uden at sende eventet.
 * Opdateringen er vagtet med `status <> 'paid'`, så en faktura der allerede
 * er betalt (fx af en samtidig cron-kørsel og webhook) ikke ændres og ikke
 * annonceres to gange, og med `status = previousStatus`, så en faktura der er
 * slettet eller ændret siden kalderen læste den, ikke overskrives (samme
 * mønster som lockInvoiceStatus). Returnerer den opdaterede faktura, eller
 * null hvis intet blev ændret.
 *
 * Webhooken sendes til fakturaens ejer/org, ikke den der udløste synken.
 */
export async function markInvoicePaid(
  db: Pick<typeof dbType, "update">,
  params: {
    invoiceId: string;
    paidDate: Date;
    previousStatus: string | null;
  },
) {
  const [updated] = await db
    .update(invoices)
    .set({ status: "paid", paidDate: params.paidDate, updatedAt: new Date() })
    .where(
      and(
        eq(invoices.id, params.invoiceId),
        // `status <> 'paid'` er NULL for status NULL, så den gren vagtes alene
        params.previousStatus === null
          ? isNull(invoices.status)
          : and(
              ne(invoices.status, "paid"),
              eq(invoices.status, params.previousStatus),
            ),
      ),
    )
    .returning();

  if (!updated) return null;

  emitWebhookEvent({
    userId: updated.userId,
    orgId: updated.organizationId,
    eventType: "invoice.paid",
    eventId: updated.id,
    data: { invoice: updated, previousStatus: params.previousStatus },
    clientId: updated.clientId,
  });

  return updated;
}
