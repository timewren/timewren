import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { toIntlLocale } from "@/i18n/format-locale";
import { activeLocale, tr } from "@/i18n/server-text";
import type { db as DbClient } from "@/lib/db";
import { orgPeriodLocks } from "@/lib/db/schema";

type Db = typeof DbClient;
type TxOrDb = Pick<Db, "query">;

// Org-periodelås (#144): "luk marts" — revisionssikkerhed når løn/faktura
// er kørt. Effektiv lås = seneste række (append-only audit-historik).

export async function getEffectivePeriodLock(
  db: TxOrDb,
  orgId: string,
): Promise<Date | null> {
  const latest = await db.query.orgPeriodLocks.findFirst({
    where: eq(orgPeriodLocks.organizationId, orgId),
    orderBy: [desc(orgPeriodLocks.createdAt)],
    columns: { lockedBefore: true },
  });
  return latest?.lockedBefore ?? null;
}

/**
 * Kaster BAD_REQUEST hvis nogen af datoerne ligger før org'ens periodelås.
 * No-op for solo-brugere (orgId null) og orgs uden lås. Kaldes fra ALLE
 * tids-mutationer — både den nye og den gamle dato ved flytninger.
 */
export async function assertPeriodUnlocked(
  db: TxOrDb,
  orgId: string | null | undefined,
  dates: (Date | string | null | undefined)[],
): Promise<void> {
  if (!orgId) return;
  const lock = await getEffectivePeriodLock(db, orgId);
  if (!lock) return;

  for (const d of dates) {
    if (!d) continue;
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) continue;
    if (date < lock) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "common.periodLocked", {
          date: lock.toLocaleDateString(toIntlLocale(activeLocale()), {
            timeZone: "Europe/Copenhagen",
          }),
        }),
      });
    }
  }
}
