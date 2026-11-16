import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  employeeProfiles,
  organizationModules,
  timeEntries,
  timesheetWeeks,
  users,
} from "@/lib/db/schema";
import {
  isEmployedInRange,
  loadEmploymentPeriods,
} from "@/lib/enterprise/employment";
import { notify } from "@/lib/notifications/bus";
import {
  addDaysToDateStr,
  copenhagenDayStart,
  copenhagenToday,
  weekStartDateStr,
} from "@/lib/time/copenhagen";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 0 12 * * 5 (fredag kl. 12 dansk tid — cron-sidecaren kører Europe/Copenhagen)
// Minder enterprise-medarbejdere om at indsende ugens timeseddel.

export const GET = withCronLogging("timesheet-reminder", async () => {
  // Mandag i indeværende uge
  const now = new Date();
  // Dansk uge uanset processens TZ (#649)
  const weekStartStr = weekStartDateStr(copenhagenToday(now));
  const monday = copenhagenDayStart(weekStartStr);
  const weekEnd = copenhagenDayStart(addDaysToDateStr(weekStartStr, 7));

  // Organisationer med enterprise-modulet aktivt
  const enterpriseOrgs = await db.query.organizationModules.findMany({
    where: and(
      eq(organizationModules.moduleKey, "enterprise"),
      eq(organizationModules.isEnabled, true),
    ),
    columns: { organizationId: true },
  });
  const orgIds = enterpriseOrgs.map((o) => o.organizationId);
  if (orgIds.length === 0) {
    return { itemsProcessed: 0, itemsSucceeded: 0, itemsFailed: 0 };
  }

  const activeProfiles = await db.query.employeeProfiles.findMany({
    where: and(
      inArray(employeeProfiles.organizationId, orgIds),
      eq(employeeProfiles.isActive, true),
    ),
    columns: { userId: true, organizationId: true },
  });
  // Ansættelseshistorik (#465): fratrådte (eller endnu ikke tiltrådte) i
  // ugen får ingen påmindelse — ét opslag pr. org
  const weekEndStr = addDaysToDateStr(weekStartStr, 6);
  const employmentByOrg = new Map<
    string,
    Awaited<ReturnType<typeof loadEmploymentPeriods>>
  >();
  for (const orgId of orgIds) {
    employmentByOrg.set(
      orgId,
      await loadEmploymentPeriods(
        db,
        orgId,
        activeProfiles
          .filter((p) => p.organizationId === orgId)
          .map((p) => p.userId),
      ),
    );
  }
  const profiles = activeProfiles.filter((p) =>
    isEmployedInRange(
      employmentByOrg.get(p.organizationId)?.get(p.userId) ?? [],
      weekStartStr,
      weekEndStr,
    ),
  );
  if (profiles.length === 0) {
    return { itemsProcessed: 0, itemsSucceeded: 0, itemsFailed: 0 };
  }
  const userIds = profiles.map((p) => p.userId);

  const [submittedWeeks, weekTotals, userRows] = await Promise.all([
    db.query.timesheetWeeks.findMany({
      where: and(
        eq(timesheetWeeks.weekStart, weekStartStr),
        inArray(timesheetWeeks.userId, userIds),
      ),
      columns: { userId: true, status: true },
    }),
    db
      .select({
        userId: timeEntries.userId,
        total: sql<string>`SUM(${timeEntries.hours}::numeric)`,
      })
      .from(timeEntries)
      .where(
        and(
          inArray(timeEntries.userId, userIds),
          gte(timeEntries.date, monday),
          lt(timeEntries.date, weekEnd),
        ),
      )
      .groupBy(timeEntries.userId),
    db.query.users.findMany({
      where: inArray(users.id, userIds),
      columns: { id: true, name: true, email: true },
    }),
  ]);

  // Indsendt/godkendt = ingen påmindelse; afvist = påmind (skal genindsendes)
  const handledUsers = new Set(
    submittedWeeks
      .filter((w) => w.status === "submitted" || w.status === "approved")
      .map((w) => w.userId),
  );
  const hoursByUser = new Map(
    weekTotals.map((t) => [t.userId, Number(t.total) || 0]),
  );
  const userById = new Map(userRows.map((u) => [u.id, u]));

  let sent = 0;
  let failed = 0;
  const pending = profiles.filter((p) => !handledUsers.has(p.userId));

  // Via notifikationsbussen (E10): e-mail som før + in-app/push efter
  // præferencer. Bussen kaster aldrig; fejl ligger i notification_deliveries.
  for (const profile of pending) {
    if (!userById.has(profile.userId)) continue;
    try {
      const result = await notify({
        orgId: profile.organizationId,
        event: "reminder.timesheet_missing",
        payload: {
          weekStart: weekStartStr,
          registeredHours: hoursByUser.get(profile.userId) ?? 0,
        },
        userIds: [profile.userId],
      });
      if (result.failed > 0 && result.sent === 0) failed++;
      else sent++;
    } catch (error) {
      failed++;
      captureRouteError(error, {
        route: "cron/timesheet-reminder",
        userId: profile.userId,
      });
    }
  }

  return {
    itemsProcessed: pending.length,
    itemsSucceeded: sent,
    itemsFailed: failed,
    metadata: { weekStart: weekStartStr, totalEmployees: profiles.length },
  };
});
