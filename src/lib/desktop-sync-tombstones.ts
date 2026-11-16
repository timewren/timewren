// Tombstones for desktop sync. A hard-deleted row leaves nothing to `pull`, so
// a device that still holds the row never hears it is gone — its next edit fails
// with "Entity not found", og kø-loggen prøver igen for evigt. Appen arkiverer
// lokalt når serveren svarer `action: "delete"` (engine.rs), så det er den
// eneste vej tilbage.
//
// Resterne af synklogikken ligger i desktop-sync.ts; den er bevidst ren
// (enhedstestbar uden DB), derfor bor de to DB-helper her.

import { and, eq, gte, or } from "drizzle-orm";
import { desktopSyncTombstones } from "@/lib/db/schema";

export interface SyncTombstone {
  type: string;
  action: "delete";
  data: { id: string };
}

/**
 * Executor-lignende type: både `db` og en transaktion har `.insert`.
 */
// biome-ignore lint/suspicious/noExplicitAny: db og tx er strukturelt ens her
type InsertExecutor = { insert: (table: any) => any };

let warnedMissingTable = false;

function warnMissingTable(error: unknown): void {
  // Migrationen er skrevet, men Mads kører den — indtil da skal en sletning i
  // browseren og en push ikke fejle, og pull skal ikke svare 500.
  if (warnedMissingTable) return;
  warnedMissingTable = true;
  console.warn(
    "[desktop-sync] Tombstones kunne ikke læses/skrives (mangler migrationen 0128?):",
    error instanceof Error ? error.message : error,
  );
}

/**
 * Skriv en tombstone for en slettet række. `userId` er ejeren af rækken (ikke
 * den slettende), så den ejers enheder hører om sletningen.
 *
 * Fejler ikke hårdt: tabellen kan mangle indtil migrationen er kørt, og en
 * slettet tidspost må ikke blive liggende fordi vi ikke fik skrevet en
 * notits-række.
 */
export async function recordSyncTombstone(
  executor: InsertExecutor,
  tombstone: {
    entityType: string;
    entityId: string;
    userId: string;
    organizationId?: string | null;
  },
): Promise<void> {
  try {
    await executor.insert(desktopSyncTombstones).values({
      entityType: tombstone.entityType,
      entityId: tombstone.entityId,
      userId: tombstone.userId,
      organizationId: tombstone.organizationId ?? null,
    });
  } catch (error) {
    warnMissingTable(error);
  }
}

/** De felter en slettet række skal have med i sin tombstone. */
export interface TombstoneRow {
  id: string;
  /** Ejeren af rækken, ikke den slettende. */
  userId: string;
  organizationId?: string | null;
}

/**
 * Skriv tombstones for flere slettede rækker i én statement — til de
 * mutationer der sletter i bulk (`time.bulkDelete`, `projects.bulkDelete`).
 *
 * Samme kontrakt som `recordSyncTombstone`: en række der ikke kan få skrevet
 * en notits-række må ikke blive liggende, så fejl sluges (tombstones-tabellen
 * kan mangle indtil migrationen er kørt).
 */
export async function recordDeletionTombstones(
  executor: InsertExecutor,
  args: { entityType: string; rows: TombstoneRow[] },
): Promise<void> {
  if (args.rows.length === 0) return;
  try {
    await executor.insert(desktopSyncTombstones).values(
      args.rows.map((row) => ({
        entityType: args.entityType,
        entityId: row.id,
        userId: row.userId,
        organizationId: row.organizationId ?? null,
      })),
    );
  } catch (error) {
    warnMissingTable(error);
  }
}

/**
 * Tombstones siden `sinceDate` for de enheder der må høre om dem: egne
 * poster (userId) og organisationsdelte poster (organizationId).
 *
 * Kun sletninger — en post der findes, pulles som create/update fra sin egen
 * tabel, så en række der både er slettet og genskabt ikke giver modstridende
 * beskeder.
 */
export async function readSyncTombstones(args: {
  // biome-ignore lint/suspicious/noExplicitAny: db og tx er strukturelt ens her
  db: any;
  userId: string;
  organizationId?: string | null;
  sinceDate: Date;
}): Promise<SyncTombstone[]> {
  const { db, userId, organizationId, sinceDate } = args;
  const scope = organizationId
    ? or(
        eq(desktopSyncTombstones.userId, userId),
        eq(desktopSyncTombstones.organizationId, organizationId),
      )
    : eq(desktopSyncTombstones.userId, userId);

  try {
    const rows = await db
      .select({
        entityType: desktopSyncTombstones.entityType,
        entityId: desktopSyncTombstones.entityId,
        userId: desktopSyncTombstones.userId,
      })
      .from(desktopSyncTombstones)
      .where(and(scope, gte(desktopSyncTombstones.deletedAt, sinceDate)));

    return rows
      .filter(
        (row: { entityType: string; userId: string }) =>
          row.entityType !== "time_entry" || row.userId === userId,
      )
      .map((row: { entityType: string; entityId: string }) => ({
        type: row.entityType,
        action: "delete" as const,
        data: { id: row.entityId },
      }));
  } catch (error) {
    warnMissingTable(error);
    return [];
  }
}
