// DB-lag for ressourceplanen (#508) uden for routeren: planlagte timer der
// endnu ikke er brugt på et projekt — til projektets budget-bar (#213).

import { and, eq, gte, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { copenhagenDayStart, copenhagenToday } from "@/lib/time/copenhagen";
import { copenhagenDateSql } from "@/lib/time/date-bounds";
import { remainingPlannedHours, toWeekStart } from "./plan";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Planlagt fremover på projektet: fra og med den igangværende uge,
 * pr. uge max(0, planlagt − registreret). 0 når projektet ikke er planlagt.
 */
export async function loadRemainingPlannedHours(
  db: Db,
  orgId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<number> {
  const currentWeek = toWeekStart(copenhagenToday(now));
  const planRows = await db
    .select({
      weekStart: schema.resourcePlanEntries.weekStart,
      hours: sql<string>`SUM(${schema.resourcePlanEntries.hours})`,
    })
    .from(schema.resourcePlanEntries)
    .where(
      and(
        eq(schema.resourcePlanEntries.organizationId, orgId),
        eq(schema.resourcePlanEntries.projectId, projectId),
        gte(schema.resourcePlanEntries.weekStart, currentWeek),
      ),
    )
    .groupBy(schema.resourcePlanEntries.weekStart);
  if (planRows.length === 0) return 0;

  const t = schema.timeEntries;
  const weekExpr = sql<string>`to_char(date_trunc('week', ${copenhagenDateSql(t.date)}), 'YYYY-MM-DD')`;
  const regRows = await db
    .select({
      weekStart: weekExpr,
      hours: sql<string>`COALESCE(SUM(${t.hours}), 0)`,
    })
    .from(t)
    .where(
      and(
        eq(t.organizationId, orgId),
        eq(t.projectId, projectId),
        gte(t.date, copenhagenDayStart(currentWeek)),
        ne(t.approvalStatus, "rejected"),
      ),
    )
    .groupBy(weekExpr);
  const reg = new Map(
    regRows.map((r) => [r.weekStart, Number.parseFloat(r.hours) || 0]),
  );
  return remainingPlannedHours(
    planRows.map((p) => ({
      weekStart: p.weekStart,
      planned: Number.parseFloat(p.hours) || 0,
      registered: reg.get(p.weekStart) ?? 0,
    })),
    currentWeek,
  );
}
