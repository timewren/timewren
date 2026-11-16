import { overtimeLedger } from "@/lib/db/schema";
import { type AuditDb, resolveUserLabel } from "@/lib/org-audit";

/**
 * Postér én række i overtime_ledger (append-only, 5 års retention) med
 * tekst-snapshot af medarbejderen (#499), så posteringen forbliver læsbar
 * efter brugeren er slettet (user_id bliver SET NULL, user_label
 * anonymiseres til "Slettet bruger"). Skal kaldes med den transaktion
 * saldo-mutationen kører i.
 */
export async function insertOvertimeLedger(
  tx: AuditDb,
  entry: Omit<typeof overtimeLedger.$inferInsert, "userLabel"> & {
    userId: string;
  },
) {
  const userLabel = await resolveUserLabel(tx, entry.userId);
  return tx
    .insert(overtimeLedger)
    .values({ ...entry, userLabel })
    .returning();
}
