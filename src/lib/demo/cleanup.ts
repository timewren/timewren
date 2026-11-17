import { and, asc, inArray, lt, or } from "drizzle-orm";
import {
  deleteUserAccountCompletely,
  planAccountDeletion,
} from "@/lib/account-deletion";
import type { db as Database } from "@/lib/db";
import {
  prepaidPackages,
  prepaidUsage,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { liveDemoUsersWhere } from "./create-demo-account";
import { DEMO_TTL_MS } from "./demo-mode";

type Db = typeof Database;

export interface DemoCleanupResult {
  found: number;
  deleted: number;
  failed: number;
}

/** Højst så mange konti pr. kørsel; resten tages ved næste kørsel. */
const BATCH_SIZE = 200;

/**
 * Sletter demokonti ældre end 24 timer (/api/cron/demo-cleanup). Kun
 * brugere med `isDemo = true` OG en adresse på det reserverede demodomæne
 * rammes: en rigtig bruger (isDemo false eller NULL) kan aldrig komme med,
 * heller ikke en adminmarkeret salgsdemo på timetrack.dk.
 *
 * Sletningen er den samme som kontosletning (deleteUserAccountCompletely):
 * FK-drevet i én transaktion pr. bruger, og brugerens solo-organisation med
 * alle data forsvinder med. Hård sletning er rigtig her, for demodata er
 * kasserede. En fejl på én konto stopper ikke resten.
 *
 * Klippekort-træk (prepaid_usage) har ingen org-kolonne og ingen cascade, så
 * den FK-drevne org-sletning kan ikke fjerne tidsposter og klippekort med
 * træk. De slettes derfor først for brugerens solo-orgs. Fejler resten
 * bagefter, prøves kontoen igen ved næste kørsel.
 */
export async function cleanupExpiredDemoUsers(
  db: Db,
  now: Date = new Date(),
): Promise<DemoCleanupResult> {
  const cutoff = new Date(now.getTime() - DEMO_TTL_MS);
  const expired = await db
    .select({ id: users.id })
    .from(users)
    .where(and(liveDemoUsersWhere(), lt(users.createdAt, cutoff)))
    .orderBy(asc(users.createdAt))
    .limit(BATCH_SIZE);

  let deleted = 0;
  let failed = 0;
  for (const { id } of expired) {
    try {
      await deleteDemoAccount(db, id);
      deleted++;
    } catch (err) {
      failed++;
      console.error(
        `[Demo] Oprydning af demobruger ${id} fejlede:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { found: expired.length, deleted, failed };
}

/** Sletter én demokonto helt (se cleanupExpiredDemoUsers). */
export async function deleteDemoAccount(db: Db, userId: string): Promise<void> {
  await deletePrepaidUsage(db, userId);
  await deleteUserAccountCompletely(db, userId);
}

async function deletePrepaidUsage(db: Db, userId: string): Promise<void> {
  const { soloOrgIds } = await planAccountDeletion(db, userId);
  if (soloOrgIds.length === 0) return;
  await db
    .delete(prepaidUsage)
    .where(
      or(
        inArray(
          prepaidUsage.prepaidPackageId,
          db
            .select({ id: prepaidPackages.id })
            .from(prepaidPackages)
            .where(inArray(prepaidPackages.organizationId, soloOrgIds)),
        ),
        inArray(
          prepaidUsage.timeEntryId,
          db
            .select({ id: timeEntries.id })
            .from(timeEntries)
            .where(inArray(timeEntries.organizationId, soloOrgIds)),
        ),
      ),
    );
}
