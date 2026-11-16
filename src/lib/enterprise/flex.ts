import { and, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { loadDayOffCalendar } from "@/lib/holidays/load";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { copenhagenDateSql } from "@/lib/time/date-bounds";
import { absenceCoversDate } from "./absence-registration";
import { loadEmploymentPeriodsForUser, normProfileAt } from "./employment";
import { ownTimeEntriesInOrg } from "./time-entry-scope";
import {
  calculateDailyNorm,
  DEFAULT_WORKING_DAYS,
  type OrgWorkSettings,
} from "./timesheet";
import { loadPlanLookups, loadPlanMembers } from "./work-plan-load";
import { loadOrgWorkSettings } from "./work-settings";

/**
 * Calculate flex delta for a single day: actual - expected.
 */
export function calculateFlexDelta(
  expectedHours: number,
  actualHours: number,
): number {
  return Math.round((actualHours - expectedHours) * 100) / 100;
}

/**
 * Get flex balance (sum of deltas) for a user in a given date range.
 * Uses SQL aggregation — does NOT load all entries into memory.
 *
 * @param db - Drizzle database instance
 * @param userId - User ID
 * @param orgId - Organization ID
 * @param dateRange - { start: YYYY-MM-DD, end: YYYY-MM-DD }
 * @returns Flex balance (sum of deltas) in hours
 */
export async function getFlexBalance(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  orgId: string,
  dateRange: { start: string; end: string },
): Promise<number> {
  const result = await db
    .select({
      totalDelta: sql<string>`COALESCE(SUM(${schema.flexEntries.delta}), 0)`,
    })
    .from(schema.flexEntries)
    .where(
      and(
        eq(schema.flexEntries.userId, userId),
        eq(schema.flexEntries.organizationId, orgId),
        gte(schema.flexEntries.date, dateRange.start),
        lte(schema.flexEntries.date, dateRange.end),
      ),
    );

  return Number(result[0]?.totalDelta ?? 0);
}

/**
 * Sum af optjent overtid (type='earned') pr. bruger — trækkes fra
 * flex-visninger, så timer over ugetærsklen kun tæller i overtidssaldoen.
 *
 * Med `options.end` (YYYY-MM-DD) medregnes kun uger med weekStart ≤ end;
 * manuelle posteringer uden weekStart tælles efter oprettelsesdato.
 */
export async function getEarnedOvertimeByUser(
  db: PostgresJsDatabase<typeof schema>,
  orgId: string,
  userIds: string[],
  options?: { end?: string },
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      // user_id er nullable (SET NULL ved sletning, #499) men filtreres på userIds
      userId: sql<string>`${schema.overtimeLedger.userId}`,
      total: sql<string>`COALESCE(SUM(${schema.overtimeLedger.hours}::numeric), 0)`,
    })
    .from(schema.overtimeLedger)
    .where(
      and(
        eq(schema.overtimeLedger.organizationId, orgId),
        eq(schema.overtimeLedger.type, "earned"),
        sql`${schema.overtimeLedger.userId} IN (${sql.join(
          userIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
        options?.end
          ? or(
              lte(schema.overtimeLedger.weekStart, options.end),
              and(
                isNull(schema.overtimeLedger.weekStart),
                sql`${copenhagenDateSql(schema.overtimeLedger.createdAt)} <= ${options.end}::date`,
              ),
            )
          : undefined,
      ),
    )
    .groupBy(schema.overtimeLedger.userId);
  return new Map(
    rows.map((r) => [r.userId, Math.round(Number(r.total) * 100) / 100]),
  );
}

/**
 * Recalculate and upsert the flex entry for a single user-day.
 *
 * Expected hours = daily norm (`calculateDailyNorm`: profil-override, org-
 * dagsnorm eller weeklyHours / working days), zeroed on holidays, approved
 * absences, and non-working days. Actual hours = sum of the user's time
 * entries that day. Shared by the flex router and the timesheet grid so both
 * write identical flex ledger rows.
 *
 * `orgSettings` kan gives med når mange dage genberegnes (script/batch), så
 * org-rækken kun hentes én gang.
 */
export async function recalculateFlexDay(
  db: PostgresJsDatabase<typeof schema>,
  params: {
    userId: string;
    orgId: string;
    date: string;
    orgSettings?: OrgWorkSettings;
  },
): Promise<typeof schema.flexEntries.$inferSelect | null> {
  const { userId, orgId, date } = params;

  const [profile, orgSettings] = await Promise.all([
    db.query.employeeProfiles.findFirst({
      where: and(
        eq(schema.employeeProfiles.userId, userId),
        eq(schema.employeeProfiles.organizationId, orgId),
      ),
    }),
    params.orgSettings ?? loadOrgWorkSettings(db, orgId),
  ]);
  if (!profile) return null;

  // Ansættelseshistorik (#465): ugetimer/arbejdsdage/norm-override som de
  // gjaldt på dagen. Ikke ansat på dagen (fratrådt/før tiltrædelse) →
  // normtid 0, så registrerede timer bliver ren flex.
  const effective = normProfileAt(
    await loadEmploymentPeriodsForUser(db, userId, orgId),
    profile,
    date,
  );
  const workingDays = effective?.workingDays ?? DEFAULT_WORKING_DAYS;
  let dailyNorm = effective ? calculateDailyNorm(effective, orgSettings) : 0;

  const dateParts = date.split("-").map(Number);
  const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
  const isoDay = dateObj.getDay() === 0 ? "7" : String(dateObj.getDay());
  let isWorkingDay = workingDays.includes(isoDay);

  // Fast arbejdsplan (#510): planens timer er dagens norm, og en afvigelse
  // er dagens faktiske arbejdstid. Uden afvigelse tæller dagen som planlagt
  // (eller tidsposterne, hvis de er flere).
  const plan = effective
    ? (
        await loadPlanLookups(
          db,
          orgId,
          await loadPlanMembers(db, orgId, [userId]),
        )
      ).get(userId)
    : undefined;
  const onPlan = plan?.hasPlan(date) ?? false;
  if (onPlan) {
    const planned = plan?.planFor(date) ?? null;
    isWorkingDay = planned !== null;
    dailyNorm = planned?.hours ?? 0;
  }
  const deviation = onPlan
    ? await db.query.workDayDeviations.findFirst({
        where: and(
          eq(schema.workDayDeviations.organizationId, orgId),
          eq(schema.workDayDeviations.userId, userId),
          eq(schema.workDayDeviations.date, date),
        ),
        columns: { hours: true },
      })
    : undefined;

  // Fridagskalenderen (#526): afdeling > org > standard-helligdage — aldrig
  // medarbejderens egen (#742)
  const holiday = (
    await loadDayOffCalendar(db, {
      orgId,
      userId,
      departmentId: profile.departmentId,
      isEmployee: true,
    })
  ).lookup(date);

  // Åben periode (endDate NULL, #460) dækker kun til og med i dag — en
  // fremtidig dag i en åben sygemelding har stadig normtid.
  const absenceRow = await db.query.absenceRequests.findFirst({
    where: and(
      eq(schema.absenceRequests.userId, userId),
      eq(schema.absenceRequests.organizationId, orgId),
      eq(schema.absenceRequests.status, "approved"),
      lte(schema.absenceRequests.startDate, date),
      or(
        isNull(schema.absenceRequests.endDate),
        gte(schema.absenceRequests.endDate, date),
      ),
    ),
  });
  const absence =
    absenceRow && absenceCoversDate(absenceRow, date, copenhagenToday())
      ? absenceRow
      : null;

  let expectedHours = 0;
  if (isWorkingDay) {
    if (absence || (holiday && !holiday.isHalfDay)) {
      expectedHours = 0;
    } else if (holiday?.isHalfDay) {
      expectedHours = dailyNorm / 2;
    } else {
      expectedHours = dailyNorm;
    }
  }

  const [year, month, day] = dateParts;
  const dayStart = new Date(year, month - 1, day, 0, 0, 0);
  const dayEnd = new Date(year, month - 1, day + 1, 0, 0, 0);
  const dayEntries = await db.query.timeEntries.findMany({
    where: and(
      ownTimeEntriesInOrg(userId, orgId),
      gte(schema.timeEntries.date, dayStart),
      lt(schema.timeEntries.date, dayEnd),
    ),
  });

  const entryHours = dayEntries.reduce(
    (sum, e) => sum + (Number(e.hours) || 0),
    0,
  );
  const actualHours = deviation
    ? Number(deviation.hours)
    : onPlan
      ? Math.max(entryHours, expectedHours)
      : entryHours;
  const delta = Math.round((actualHours - expectedHours) * 100) / 100;

  const existing = await db.query.flexEntries.findFirst({
    where: and(
      eq(schema.flexEntries.userId, userId),
      eq(schema.flexEntries.organizationId, orgId),
      eq(schema.flexEntries.date, date),
    ),
  });

  if (existing) {
    const [updated] = await db
      .update(schema.flexEntries)
      .set({
        expectedHours: String(expectedHours),
        actualHours: String(actualHours),
        delta: String(delta),
      })
      .where(eq(schema.flexEntries.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(schema.flexEntries)
    .values({
      userId,
      organizationId: orgId,
      date,
      expectedHours: String(expectedHours),
      actualHours: String(actualHours),
      delta: String(delta),
    })
    .returning();
  return created;
}
