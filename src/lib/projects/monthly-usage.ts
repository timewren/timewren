/**
 * Forbrug mod månedsbudgettet — én forespørgsel, ét prædikat (#592).
 *
 * `projects.list`, budget-cronen og rapportens budget-kolonne skal give det
 * SAMME tal for det samme projekt. Det gør de kun hvis de bruger de samme
 * månedsgrænser OG det samme scope-prædikat: strengt `organizationId = X`
 * taber legacy-poster uden org-id, så ét sted ville vise 17 t og et andet 14 t.
 *
 * Ligger adskilt fra `./budget.ts`, fordi den fil også importeres af
 * klientkomponenter og derfor skal være fri for drizzle og DB-schema.
 */

import { and, eq, gte, inArray, lt, type SQL, sql } from "drizzle-orm";
import type { db as defaultDb } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { inOrgOrLegacy } from "@/lib/enterprise/time-entry-scope";
import { monthBoundsCopenhagen } from "./budget";

type Db = typeof defaultDb;

/**
 * Prædikatet for "de tidsposter der hører til dette budget".
 * I en org: hele organisationens poster plus legacy-poster uden org-id.
 * Uden org (freelance): ejerens egne poster.
 */
export function monthlyUsageScope(orgId: string | null, userId: string): SQL {
  return orgId ? inOrgOrLegacy(orgId) : eq(timeEntries.userId, userId);
}

export interface LoadMonthlyUsageArgs {
  projectIds: string[];
  /** Fra `monthlyUsageScope` — hele holdets timer, ikke kun den kaldendes. */
  scope: SQL;
  /** Tidspunkt måneden udledes af (default: nu). */
  now?: Date;
}

/**
 * Timer brugt i indeværende kalendermåned (dansk tid) pr. projekt.
 * Øvre grænse er med, så fremdaterede registreringer ikke puster måneden op.
 */
export async function loadMonthlyUsage(
  db: Db,
  { projectIds, scope, now = new Date() }: LoadMonthlyUsageArgs,
): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  if (projectIds.length === 0) return used;

  const { start, next } = monthBoundsCopenhagen(now);
  const rows = await db
    .select({
      projectId: timeEntries.projectId,
      hours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
    })
    .from(timeEntries)
    .where(
      and(
        scope,
        inArray(timeEntries.projectId, projectIds),
        gte(timeEntries.date, start),
        lt(timeEntries.date, next),
      ),
    )
    .groupBy(timeEntries.projectId);

  for (const row of rows) {
    if (row.projectId) {
      used.set(row.projectId, Number.parseFloat(row.hours as string));
    }
  }
  return used;
}
