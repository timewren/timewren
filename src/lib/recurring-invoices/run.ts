import { eq } from "drizzle-orm";
import type { db as DbClient } from "@/lib/db";
import { clients, recurringInvoices } from "@/lib/db/schema";
import {
  type GenerateRecurringResult,
  generateRecurringInvoiceInTx,
} from "./generate";
import { isRecurringInvoiceInterval, nextRunDate } from "./schedule";

type Db = typeof DbClient;

/**
 * Højst så mange perioder indhentes pr. kørsel, hvis cron har været nede.
 * Resten tages ved de næste daglige kørsler — aldrig en lavine af kladder.
 */
export const MAX_CATCH_UP_RUNS = 3;

export interface DueRunOutcome {
  template: { id: string; name: string; userId: string } | null;
  results: GenerateRecurringResult[];
}

/**
 * Kør én forfalden skabelon: lås rækken, opret kladder for de perioder hvis
 * kørselsdato er nået (op til `MAX_CATCH_UP_RUNS`), og ryk `nextRunDate`
 * frem. Låsen + idempotens-nøglen i `generateRecurringInvoiceInTx` gør det
 * sikkert at køre samtidigt eller igen.
 *
 * Skabeloner koblet til et klippekort springes over — dem fakturerer
 * klippekort-fornyelsen.
 */
export async function runDueRecurringInvoice(
  db: Db,
  templateId: string,
  today: string,
  now: Date = new Date(),
): Promise<DueRunOutcome> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(recurringInvoices)
      .where(eq(recurringInvoices.id, templateId))
      .for("update");
    if (
      !locked ||
      locked.isPaused ||
      locked.isArchived ||
      locked.prepaidPackageId ||
      locked.nextRunDate > today ||
      !isRecurringInvoiceInterval(locked.interval)
    ) {
      return { template: null, results: [] };
    }

    // Arkiveret kunde: ingen kladder. Datoen rykkes ikke, så skabelonen
    // fortsætter hvis kunden gendannes.
    const client = await tx.query.clients.findFirst({
      where: eq(clients.id, locked.clientId),
      columns: { isArchived: true },
    });
    if (!client || client.isArchived) {
      return { template: null, results: [] };
    }

    const results: GenerateRecurringResult[] = [];
    let runDate = locked.nextRunDate;
    for (let i = 0; runDate <= today && i < MAX_CATCH_UP_RUNS; i++) {
      results.push(
        await generateRecurringInvoiceInTx(tx, locked, runDate, { now }),
      );
      runDate = nextRunDate(runDate, locked.interval, locked.anchorDay);
    }

    await tx
      .update(recurringInvoices)
      .set({ nextRunDate: runDate, updatedAt: now })
      .where(eq(recurringInvoices.id, locked.id));

    return {
      template: { id: locked.id, name: locked.name, userId: locked.userId },
      results,
    };
  });
}
