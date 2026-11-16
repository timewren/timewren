import { and, asc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { recalculateFlexDay } from "./flex";
import { loadOrgWorkSettings } from "./work-settings";

type Db = PostgresJsDatabase<typeof schema>;

/** Genberegn eksisterende poster i samme transaktion som kalenderændringen. */
export async function recalculateCalendarFlex(
  db: Db,
  params: { orgId: string; departmentId?: string },
): Promise<void> {
  const { orgId, departmentId } = params;
  const entries = await db.query.flexEntries.findMany({
    where: and(
      eq(schema.flexEntries.organizationId, orgId),
      departmentId
        ? inArray(
            schema.flexEntries.userId,
            db
              .select({ userId: schema.employeeProfiles.userId })
              .from(schema.employeeProfiles)
              .where(
                and(
                  eq(schema.employeeProfiles.organizationId, orgId),
                  eq(schema.employeeProfiles.departmentId, departmentId),
                ),
              ),
          )
        : undefined,
    ),
    columns: { userId: true, date: true },
    orderBy: [asc(schema.flexEntries.userId), asc(schema.flexEntries.date)],
  });
  if (entries.length === 0) return;
  const orgSettings = await loadOrgWorkSettings(db, orgId);
  for (const entry of entries) {
    if (!entry.userId) continue;
    await recalculateFlexDay(db, {
      ...entry,
      userId: entry.userId,
      orgId,
      orgSettings,
    });
  }
}
