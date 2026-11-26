import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { scheduledRateChanges } from "@/lib/db/schema";
import {
  type ScheduledRateChangeLite,
  toScheduledRateChangeLite,
} from "./scheduled";

type Db = PostgresJsDatabase<typeof schema>;

const LITE_COLUMNS = {
  id: true,
  clientId: true,
  projectId: true,
  newRate: true,
  oldRate: true,
  effectiveDate: true,
  appliedAt: true,
  cancelledAt: true,
  createdAt: true,
} as const;

/**
 * Ikke-annullerede ændringer for de givne klienter/projekter — én query.
 * Kalderen har allerede verificeret ejerskab af klient/projekt.
 */
export async function loadScheduledChangesForTargets(
  db: Db,
  targets: { clientIds: string[]; projectIds: string[] },
): Promise<ScheduledRateChangeLite[]> {
  const clientIds = [...new Set(targets.clientIds.filter(Boolean))];
  const projectIds = [...new Set(targets.projectIds.filter(Boolean))];
  if (clientIds.length === 0 && projectIds.length === 0) return [];

  const targetFilters = [
    ...(clientIds.length > 0
      ? [inArray(scheduledRateChanges.clientId, clientIds)]
      : []),
    ...(projectIds.length > 0
      ? [inArray(scheduledRateChanges.projectId, projectIds)]
      : []),
  ];

  const rows = await db.query.scheduledRateChanges.findMany({
    where: and(
      isNull(scheduledRateChanges.cancelledAt),
      targetFilters.length === 1 ? targetFilters[0] : or(...targetFilters),
    ),
    columns: LITE_COLUMNS,
  });
  return rows.map(toScheduledRateChangeLite);
}

/**
 * Alle ikke-annullerede ændringer i brugerens/organisationens scope — én
 * query, til batch-opslag (rate-cache).
 */
export async function loadScheduledChangesForScope(
  db: Db,
  userId: string,
  orgId: string | null | undefined,
  targets?: { projectIds: string[]; clientIds: string[] },
): Promise<ScheduledRateChangeLite[]> {
  const rows = await db.query.scheduledRateChanges.findMany({
    where: and(
      isNull(scheduledRateChanges.cancelledAt),
      orgId
        ? eq(scheduledRateChanges.organizationId, orgId)
        : eq(scheduledRateChanges.userId, userId),
      targets
        ? or(
            inArray(scheduledRateChanges.projectId, targets.projectIds),
            inArray(scheduledRateChanges.clientId, targets.clientIds),
          )
        : undefined,
    ),
    columns: LITE_COLUMNS,
  });
  return rows.map(toScheduledRateChangeLite);
}
