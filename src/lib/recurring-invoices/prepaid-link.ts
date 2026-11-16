import { and, eq } from "drizzle-orm";
import type { db as DbClient } from "@/lib/db";
import { recurringInvoices } from "@/lib/db/schema";
import { toCopenhagenDateStr } from "@/lib/time/copenhagen";
import { anchorDayOf } from "./schedule";

type Db = typeof DbClient;

/**
 * Hold en gentagen faktura koblet til et klippekort i takt med kortet (#198).
 *
 * - Fornyelsen ændres (interval/næste dato): skabelonens kalender følger med,
 *   så listen viser de rigtige kommende datoer.
 * - Fornyelsen slås fra, eller kortet arkiveres/deaktiveres: koblingen løses,
 *   og skabelonen sættes på pause. Ellers hænger den på et kort der aldrig
 *   fornyes og ser aktiv ud uden nogensinde at oprette en kladde. Brugeren
 *   kan genoptage den med egen kalender.
 */
export async function syncPrepaidLinkedRecurringInvoice(
  db: Db,
  packageId: string,
  renewal: { interval: string; nextAt: Date } | null,
): Promise<void> {
  const where = and(
    eq(recurringInvoices.prepaidPackageId, packageId),
    eq(recurringInvoices.isArchived, false),
  );
  const now = new Date();
  if (!renewal) {
    await db
      .update(recurringInvoices)
      .set({ prepaidPackageId: null, isPaused: true, updatedAt: now })
      .where(where);
    return;
  }
  const nextRunDate = toCopenhagenDateStr(renewal.nextAt);
  await db
    .update(recurringInvoices)
    .set({
      interval: renewal.interval,
      nextRunDate,
      anchorDay: anchorDayOf(nextRunDate),
      updatedAt: now,
    })
    .where(where);
}
