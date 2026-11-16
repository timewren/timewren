/**
 * Planlagte satsændringer — databaselaget: genstempling ved oprettelse/
 * annullering og det daglige cron-job der anvender forfaldne ændringer.
 */

import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import {
  clients,
  projects,
  rateHistory,
  scheduledRateChanges,
  timeEntries,
} from "@/lib/db/schema";
import { notBilledFilter } from "@/lib/invoicing/unbilled";
import {
  buildRateLookupCache,
  type RateLookupCache,
} from "@/lib/trpc/routers/time";
import { countPlanned, planRestamp } from "./restamp";
import {
  indexScheduledChanges,
  type ScheduledRateChangeLite,
} from "./scheduled";
import { loadScheduledChangesForScope } from "./scheduled-db";

type Db = PostgresJsDatabase<typeof schema>;

/** Dagen før en "YYYY-MM-DD"-dato som UTC-midnat — grov SQL-afgrænsning. */
function dayBeforeUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1));
}

/** Middag UTC på datoen — vises som samme dag i enhver tidszone. */
export function effectiveDateTimestamp(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

interface RestampTarget {
  orgId: string | null | undefined;
  userId: string;
  clientId: string | null;
  projectId: string | null;
  effectiveDate: string;
}

/**
 * Genstempl ikke-fakturerede poster efter en ændring af de planlagte satser.
 *
 * Kaldes EFTER ændringen er skrevet (oprettet eller annulleret). `toggled`
 * er ændringen selv; "før"-billedet fås ved at slå den fra/til i hukommelsen,
 * så databasen kun læses én gang pr. scope.
 *
 * @param toggled ændringen som den ser ud nu, og om den fandtes før kaldet
 * @returns antal genstemplede poster
 */
export async function restampForScheduledChange(
  db: Db,
  target: RestampTarget,
  toggled: { change: ScheduledRateChangeLite; existedBefore: boolean },
): Promise<number> {
  const scopeFilter = target.orgId
    ? eq(timeEntries.organizationId, target.orgId)
    : eq(timeEntries.userId, target.userId);

  let targetFilter: ReturnType<typeof eq> | ReturnType<typeof or>;
  if (target.projectId) {
    targetFilter = eq(timeEntries.projectId, target.projectId);
  } else if (target.clientId) {
    const clientProjects = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.clientId, target.clientId));
    const projectIds = clientProjects.map((p) => p.id);
    targetFilter =
      projectIds.length > 0
        ? or(
            eq(timeEntries.clientId, target.clientId),
            inArray(timeEntries.projectId, projectIds),
          )
        : eq(timeEntries.clientId, target.clientId);
  } else {
    return 0;
  }

  const candidates = await db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      projectId: timeEntries.projectId,
      clientId: timeEntries.clientId,
      date: timeEntries.date,
      billableRate: timeEntries.billableRate,
    })
    .from(timeEntries)
    .where(
      and(
        scopeFilter,
        targetFilter,
        notBilledFilter(),
        isNull(timeEntries.invoiceId),
        // Grov afgrænsning; den præcise datosammenligning sker i dansk tid
        gte(timeEntries.date, dayBeforeUtc(target.effectiveDate)),
      ),
    );
  if (candidates.length === 0) return 0;

  // Nuværende (efter) og tidligere (før) sæt af planlagte ændringer
  const now = await loadScheduledChangesForScope(
    db,
    target.userId,
    target.orgId,
  );
  const withoutToggled = now.filter((c) => c.id !== toggled.change.id);
  const beforeList = toggled.existedBefore
    ? [...withoutToggled, { ...toggled.change, cancelledAt: null }]
    : withoutToggled;
  const beforeIndex = indexScheduledChanges(beforeList);
  const afterIndex = indexScheduledChanges(now);

  // Medlemssatser er personlige, så caches bygges pr. postens ejer
  const byUser = new Map<string, typeof candidates>();
  for (const entry of candidates) {
    const list = byUser.get(entry.userId) ?? [];
    list.push(entry);
    byUser.set(entry.userId, list);
  }

  const merged = new Map<string, string[]>();
  for (const [entryUserId, entries] of byUser) {
    const base: RateLookupCache = await buildRateLookupCache(
      db,
      entryUserId,
      target.orgId,
    );
    const plan = planRestamp(
      entries,
      { ...base, scheduled: beforeIndex },
      { ...base, scheduled: afterIndex },
      toggled.change.effectiveDate,
    );
    for (const [rate, ids] of plan) {
      merged.set(rate, [...(merged.get(rate) ?? []), ...ids]);
    }
  }

  if (merged.size === 0) return 0;
  await db.transaction(async (tx) => {
    for (const [rate, ids] of merged) {
      await tx
        .update(timeEntries)
        .set({ billableRate: rate === "null" ? null : rate })
        .where(and(inArray(timeEntries.id, ids), notBilledFilter()));
    }
  });
  return countPlanned(merged);
}

// ---------------------------------------------------------------------------
// Cron: anvend forfaldne ændringer
// ---------------------------------------------------------------------------

export interface DueRateChange {
  id: string;
  userId: string;
  organizationId: string | null;
  clientId: string | null;
  projectId: string | null;
  newRate: string;
  effectiveDate: string;
  appliedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export interface ApplyRateChangeStore {
  /** Ikke-anvendte, ikke-annullerede ændringer med effectiveDate ≤ today */
  listDue(today: string): Promise<DueRateChange[]>;
  /**
   * Anvend én ændring atomisk. Returnerer false hvis den allerede er anvendt
   * eller annulleret (fx af en samtidig kørsel) — så sker intet.
   */
  apply(change: DueRateChange, appliedAt: Date): Promise<boolean>;
}

export interface ApplyResult {
  due: number;
  applied: number;
  skipped: number;
  failed: number;
  errors: { id: string; message: string }[];
}

/**
 * Anvend alle forfaldne ændringer i datoorden. Idempotent: en ændring der
 * allerede er anvendt, springes over (både af filteret og af store.apply).
 */
export async function applyDueRateChanges(
  store: ApplyRateChangeStore,
  today: string,
  now: Date = new Date(),
): Promise<ApplyResult> {
  const due = (await store.listDue(today))
    // Forsvar i dybden: filteret gælder også hvis store'en er for bred
    .filter((c) => !c.appliedAt && !c.cancelledAt && c.effectiveDate <= today)
    .sort((a, b) =>
      a.effectiveDate === b.effectiveDate
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : a.effectiveDate < b.effectiveDate
          ? -1
          : 1,
    );

  const result: ApplyResult = {
    due: due.length,
    applied: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  const blockedTargets = new Set<string>();
  for (const change of due) {
    const targetKey = change.projectId
      ? `project:${change.projectId}`
      : `client:${change.clientId}`;
    // Fejlede en tidligere ændring for samme klient/projekt i denne kørsel,
    // venter resten — ellers blev en senere ændring anvendt foran en
    // tidligere, og oldRate-kæden ville knække.
    if (blockedTargets.has(targetKey)) {
      result.skipped++;
      continue;
    }
    try {
      if (await store.apply(change, now)) result.applied++;
      else result.skipped++;
    } catch (error) {
      blockedTargets.add(targetKey);
      result.failed++;
      result.errors.push({
        id: change.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/** Drizzle-implementationen af store'en. */
export function createDrizzleApplyStore(db: Db): ApplyRateChangeStore {
  return {
    async listDue(today) {
      return db
        .select({
          id: scheduledRateChanges.id,
          userId: scheduledRateChanges.userId,
          organizationId: scheduledRateChanges.organizationId,
          clientId: scheduledRateChanges.clientId,
          projectId: scheduledRateChanges.projectId,
          newRate: scheduledRateChanges.newRate,
          effectiveDate: scheduledRateChanges.effectiveDate,
          appliedAt: scheduledRateChanges.appliedAt,
          cancelledAt: scheduledRateChanges.cancelledAt,
          createdAt: scheduledRateChanges.createdAt,
        })
        .from(scheduledRateChanges)
        .where(
          and(
            isNull(scheduledRateChanges.appliedAt),
            isNull(scheduledRateChanges.cancelledAt),
            lte(scheduledRateChanges.effectiveDate, today),
          ),
        )
        .orderBy(
          asc(scheduledRateChanges.effectiveDate),
          asc(scheduledRateChanges.createdAt),
        );
    },

    async apply(change, appliedAt) {
      return db.transaction(async (tx) => {
        // Gør krav på rækken først: kun én kørsel kan sætte appliedAt
        const [claimed] = await tx
          .update(scheduledRateChanges)
          .set({ appliedAt })
          .where(
            and(
              eq(scheduledRateChanges.id, change.id),
              isNull(scheduledRateChanges.appliedAt),
              isNull(scheduledRateChanges.cancelledAt),
            ),
          )
          .returning({ id: scheduledRateChanges.id });
        if (!claimed) return false;

        let oldRate: string | null;
        let historyClientId: string | null;
        if (change.projectId) {
          const [project] = await tx
            .select({
              hourlyRate: projects.hourlyRate,
              clientId: projects.clientId,
            })
            .from(projects)
            .where(eq(projects.id, change.projectId))
            .for("update");
          if (!project) throw new Error("Projektet findes ikke længere");
          oldRate = project.hourlyRate;
          historyClientId = project.clientId;
          await tx
            .update(projects)
            .set({ hourlyRate: change.newRate, updatedAt: appliedAt })
            .where(eq(projects.id, change.projectId));
        } else if (change.clientId) {
          const [client] = await tx
            .select({ defaultHourlyRate: clients.defaultHourlyRate })
            .from(clients)
            .where(eq(clients.id, change.clientId))
            .for("update");
          if (!client) throw new Error("Klienten findes ikke længere");
          oldRate = client.defaultHourlyRate;
          historyClientId = change.clientId;
          await tx
            .update(clients)
            .set({ defaultHourlyRate: change.newRate, updatedAt: appliedAt })
            .where(eq(clients.id, change.clientId));
        } else {
          throw new Error("Ændringen har hverken klient eller projekt");
        }

        await tx
          .update(scheduledRateChanges)
          .set({ oldRate })
          .where(eq(scheduledRateChanges.id, change.id));

        await tx.insert(rateHistory).values({
          userId: change.userId,
          organizationId: change.organizationId,
          clientId: historyClientId,
          projectId: change.projectId,
          oldRate,
          newRate: change.newRate,
          rateType: change.projectId ? "project" : "client",
          effectiveDate: effectiveDateTimestamp(change.effectiveDate),
          reason: "Planlagt satsændring",
        });
        return true;
      });
    },
  };
}
