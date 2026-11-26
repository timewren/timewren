import { and, eq, isNull, lte } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { recurringInvoices } from "@/lib/db/schema";
import { runWithOwnerCurrency } from "@/lib/demo/server-currency";
import { formatCurrency } from "@/lib/format";
import { sendNotification } from "@/lib/notifications";
import { ownerAllowsRecurringInvoices } from "@/lib/recurring-invoices/plan";
import { runDueRecurringInvoice } from "@/lib/recurring-invoices/run";
import { copenhagenToday } from "@/lib/time/copenhagen";

// Gentagne fakturaer (#198): dagligt cron der opretter KLADDER for skabeloner
// hvis næste kørselsdato er nået, og giver brugeren besked. Intet sendes til
// kunden — brugeren gennemgår, udsteder og eksporterer selv (Billy/Dinero/
// e-conomic). Skabeloner koblet til et klippekort faktureres af
// prepaid-renewals i stedet. Schedule: dagligt 06:50 (cron-sidecar), lige
// efter klippekort-fornyelserne.

export const GET = withCronLogging("recurring-invoices", async () => {
  const now = new Date();
  const today = copenhagenToday(now);

  const due = await db.query.recurringInvoices.findMany({
    where: and(
      eq(recurringInvoices.isPaused, false),
      eq(recurringInvoices.isArchived, false),
      isNull(recurringInvoices.prepaidPackageId),
      lte(recurringInvoices.nextRunDate, today),
    ),
    columns: { id: true, userId: true, organizationId: true },
  });

  // Abonnements-gate pr. ejer (brugbart abonnement, alle planer) — samme regel
  // som subscribedProcedure. Skabeloner uden brugbart abonnement bliver
  // stående og kører igen, når abonnementet er i orden.
  const planCache = new Map<string, boolean>();
  // Pr. bruger og organisation: beløbene står i organisationens valuta.
  const createdByOwner = new Map<
    string,
    {
      userId: string;
      organizationId: string | null;
      list: Array<{ name: string; amount: number }>;
    }
  >();
  let created = 0;
  let empty = 0;
  let duplicates = 0;
  let skippedPlan = 0;
  let failed = 0;

  for (const row of due) {
    const planKey = `${row.organizationId ?? ""}:${row.userId}`;
    let allowed = planCache.get(planKey);
    if (allowed === undefined) {
      allowed = await ownerAllowsRecurringInvoices(
        db,
        row.userId,
        row.organizationId,
        now,
      );
      planCache.set(planKey, allowed);
    }
    if (!allowed) {
      skippedPlan++;
      continue;
    }

    try {
      const outcome = await runDueRecurringInvoice(db, row.id, today, now);
      for (const result of outcome.results) {
        if (result.status === "created" && outcome.template) {
          created++;
          const owner = createdByOwner.get(planKey) ?? {
            userId: row.userId,
            organizationId: row.organizationId,
            list: [],
          };
          owner.list.push({
            name: outcome.template.name,
            amount: result.amount,
          });
          createdByOwner.set(planKey, owner);
        } else if (result.status === "empty") {
          empty++;
        } else {
          duplicates++;
        }
      }
    } catch (err) {
      failed++;
      console.error(
        `[Recurring Invoices] ${row.id} fejlede:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Én besked pr. bruger og organisation, ikke pr. kladde. Fejl her må ikke
  // vælte kørslen.
  for (const { userId, organizationId, list } of createdByOwner.values()) {
    try {
      await runWithOwnerCurrency({ userId, organizationId }, () =>
        sendNotification({
          type: "recurring_invoice_draft",
          userId,
          i18n:
            list.length === 1
              ? {
                  key: "recurringOne",
                  values: {
                    name: list[0].name,
                    amount: formatCurrency(list[0].amount),
                  },
                }
              : {
                  key: "recurringMany",
                  values: {
                    count: list.length,
                    list: list
                      .map((l) => `"${l.name}" (${formatCurrency(l.amount)})`)
                      .join(", "),
                  },
                },
          url: "/dashboard/invoices?status=draft",
        }),
      );
    } catch (err) {
      console.error("[Recurring Invoices] Notifikation fejlede:", err);
    }
  }

  return {
    itemsProcessed: due.length,
    itemsSucceeded: created,
    itemsFailed: failed,
    metadata: { created, empty, duplicates, skippedPlan },
  };
});
