import { and, eq, isNotNull, lt } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { sendNotification } from "@/lib/notifications";
import { copenhagenDayStart, copenhagenToday } from "@/lib/time/copenhagen";
import { emitWebhookEvent } from "@/lib/webhooks/events";

// Automatisk overdue-status (#201): sendte fakturaer med overskredet
// forfaldsdato markeres som forfaldne. Uden dette står de som "sent" for
// evigt, og hverken rykker-flowet (#92), Revenue-at-risk (#153) eller
// invoice.overdue-webhooken har noget at arbejde med.
// Schedule: dagligt kl. 06:15 (cron-sidecar).

export const GET = withCronLogging("invoice-overdue", async (_request) => {
  const now = new Date();
  // Forfalden = dagen EFTER forfaldsdatoen (dansk konvention, og matcher
  // OpenInvoicesWidget der viser "Forfalder i dag" ved diffDays === 0).
  // Sammenlign derfor mod midnat i dag: kun dueDate FØR i dag rammes.
  // Dansk midnat uanset processens TZ (#649).
  const startOfToday = copenhagenDayStart(copenhagenToday(now));

  const marked = await db
    .update(invoices)
    .set({ status: "overdue", updatedAt: now })
    .where(
      and(
        eq(invoices.status, "sent"),
        eq(invoices.kind, "invoice"),
        isNotNull(invoices.dueDate),
        lt(invoices.dueDate, startOfToday),
      ),
    )
    .returning({
      id: invoices.id,
      userId: invoices.userId,
      organizationId: invoices.organizationId,
      clientId: invoices.clientId,
      invoiceNumber: invoices.invoiceNumber,
      amount: invoices.amount,
      dueDate: invoices.dueDate,
    });

  // Webhooks pr. faktura + én notifikation pr. bruger (ikke pr. faktura)
  const byUser = new Map<string, typeof marked>();
  for (const inv of marked) {
    emitWebhookEvent({
      userId: inv.userId,
      orgId: inv.organizationId,
      eventType: "invoice.overdue",
      eventId: inv.id,
      data: { invoice: inv },
      clientId: inv.clientId,
    });
    const list = byUser.get(inv.userId) ?? [];
    list.push(inv);
    byUser.set(inv.userId, list);
  }

  for (const [userId, list] of byUser) {
    try {
      const numbers = list.map((i) => i.invoiceNumber).join(", ");
      await sendNotification({
        type: "overdue_alert",
        userId,
        i18n: {
          key: list.length === 1 ? "invoiceOverdueOne" : "invoiceOverdueMany",
          values: { count: list.length, numbers },
        },
        url: "/dashboard/invoices?status=overdue",
      });
    } catch (err) {
      console.error("[Invoice Overdue] Notifikation fejlede:", err);
    }
  }

  if (marked.length > 0) {
    console.warn(
      `[Invoice Overdue] Markerede ${marked.length} faktura(er) som forfaldne`,
    );
  }

  return {
    itemsProcessed: marked.length,
    itemsSucceeded: marked.length,
    metadata: { usersNotified: byUser.size },
  };
});
