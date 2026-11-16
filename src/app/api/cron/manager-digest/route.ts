import { and, eq, inArray, or } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  absenceRequests,
  departmentManagers,
  employeeProfiles,
  members,
  organizationModules,
  orgNotificationSettings,
  timesheetWeeks,
  users,
} from "@/lib/db/schema";
import {
  type Managership,
  resolveVisibleProfileIds,
} from "@/lib/enterprise/scope";
import { notify } from "@/lib/notifications/bus";
import {
  buildDigest,
  type DigestSource,
  digestIsEmpty,
} from "@/lib/notifications/bus/digest";
import { maxOrgRole, type OrgRole } from "@/lib/permissions/org-role";
import {
  addDaysToDateStr,
  copenhagenToday,
  isoWeekdayOfDateStr,
  weekStartDateStr,
} from "@/lib/time/copenhagen";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 30 5 * * * (~07:30 dansk tid). Leder-digest (E10, #468):
// daily = alle hverdage, weekly = mandage. Pr. leder: eget scope (E6);
// admins/ejere: hele org'en + eskaleringsflag når noget har ventet ≥ N dage.
// Teams får ét org-kort (admin-visningen) pr. kørsel.

export const GET = withCronLogging("manager-digest", async () => {
  const now = new Date();
  // Dansk dag/ugedag uanset processens TZ (#649)
  const today = copenhagenToday(now);
  const dow = isoWeekdayOfDateStr(today);
  const isMonday = dow === 1;
  const isWeekend = dow === 6 || dow === 7;
  const lastWeekStart = addDaysToDateStr(weekStartDateStr(today), -7);

  const [enterpriseOrgs, settingsRows] = await Promise.all([
    db.query.organizationModules.findMany({
      where: and(
        eq(organizationModules.moduleKey, "enterprise"),
        eq(organizationModules.isEnabled, true),
      ),
      columns: { organizationId: true },
    }),
    db.query.orgNotificationSettings.findMany({
      where: or(
        eq(orgNotificationSettings.managerDigest, "daily"),
        eq(orgNotificationSettings.managerDigest, "weekly"),
      ),
      columns: {
        organizationId: true,
        managerDigest: true,
        escalationDays: true,
      },
    }),
  ]);
  const enterpriseIds = new Set(enterpriseOrgs.map((o) => o.organizationId));
  const dueOrgs = settingsRows.filter((s) => {
    if (!enterpriseIds.has(s.organizationId)) return false;
    if (s.managerDigest === "weekly") return isMonday;
    return !isWeekend;
  });
  if (dueOrgs.length === 0) {
    return { itemsProcessed: 0, itemsSucceeded: 0, itemsFailed: 0 };
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const org of dueOrgs) {
    const orgId = org.organizationId;
    const period = org.managerDigest === "weekly" ? "weekly" : "daily";
    try {
      const [profiles, memberRows, managerships] = await Promise.all([
        db.query.employeeProfiles.findMany({
          where: eq(employeeProfiles.organizationId, orgId),
          columns: {
            id: true,
            userId: true,
            departmentId: true,
            managerId: true,
            isActive: true,
            role: true,
          },
        }),
        db.query.members.findMany({
          where: eq(members.organizationId, orgId),
          columns: { userId: true, role: true },
        }),
        db.query.departmentManagers.findMany({
          where: eq(departmentManagers.organizationId, orgId),
          columns: {
            userId: true,
            departmentId: true,
            role: true,
            validFrom: true,
            validTo: true,
          },
        }),
      ]);
      const active = profiles.filter((p) => p.isActive);
      const userIds = active.map((p) => p.userId);
      if (userIds.length === 0) continue;

      const [userRows, lastWeekRows, pendingWeeks, pendingAbsence] =
        await Promise.all([
          db.query.users.findMany({
            where: inArray(users.id, userIds),
            columns: { id: true, name: true, locale: true },
          }),
          db.query.timesheetWeeks.findMany({
            where: and(
              eq(timesheetWeeks.organizationId, orgId),
              eq(timesheetWeeks.weekStart, lastWeekStart),
              inArray(timesheetWeeks.userId, userIds),
            ),
            columns: { userId: true, status: true },
          }),
          db.query.timesheetWeeks.findMany({
            where: and(
              eq(timesheetWeeks.organizationId, orgId),
              eq(timesheetWeeks.status, "submitted"),
              inArray(timesheetWeeks.userId, userIds),
            ),
            columns: { userId: true, weekStart: true, submittedAt: true },
          }),
          db.query.absenceRequests.findMany({
            where: and(
              eq(absenceRequests.organizationId, orgId),
              eq(absenceRequests.status, "pending"),
              inArray(absenceRequests.userId, userIds),
            ),
            columns: {
              userId: true,
              startDate: true,
              endDate: true,
              createdAt: true,
            },
            with: { absenceType: { columns: { name: true } } },
          }),
        ]);
      const nameOf = new Map(userRows.map((u) => [u.id, u.name ?? ""]));
      const localeOf = new Map(userRows.map((u) => [u.id, u.locale]));

      const source: DigestSource = {
        employees: active.map((p) => ({
          userId: p.userId,
          name: nameOf.get(p.userId) ?? "",
        })),
        lastWeekStart,
        handledLastWeek: new Set(
          lastWeekRows
            .filter((w) => w.status === "submitted" || w.status === "approved")
            .map((w) => w.userId),
        ),
        pendingTimesheets: pendingWeeks,
        pendingAbsence: pendingAbsence.map((a) => ({
          userId: a.userId,
          typeName: a.absenceType?.name ?? "",
          startDate: a.startDate,
          endDate: a.endDate,
          createdAt: a.createdAt,
        })),
        today: now,
      };

      // Effektiv org-rolle pr. bruger (samme flet som organizationProcedure)
      const memberRole = new Map(
        memberRows.map((m) => [m.userId, m.role as OrgRole]),
      );
      const managershipsByUser = new Map<string, Managership[]>();
      for (const m of managerships) {
        const list = managershipsByUser.get(m.userId) ?? [];
        list.push(m);
        managershipsByUser.set(m.userId, list);
      }

      let orgWideSent = false;
      for (const profile of active) {
        const role = maxOrgRole(
          (memberRole.get(profile.userId) ?? "member") as OrgRole,
          (profile.role as OrgRole) ?? "member",
        );
        if (role !== "manager" && role !== "admin" && role !== "owner") {
          continue;
        }
        const scope = resolveVisibleProfileIds({
          role,
          selfProfileId: profile.id,
          profiles,
          managerships: managershipsByUser.get(profile.userId) ?? [],
          today,
        });
        const scopeUserIds = scope.all
          ? null
          : new Set(
              profiles
                .filter((p) => scope.profileIds.has(p.id))
                .map((p) => p.userId),
            );
        const digest = buildDigest({
          source,
          scopeUserIds,
          period,
          escalationDays: org.escalationDays,
          // Digesten skrives på lederens eget sprog
          locale: localeOf.get(profile.userId) ?? undefined,
        });
        if (digestIsEmpty(digest)) continue;
        // Ledere får kun deres eget scope; admins/ejere hele org'en, og
        // det er den visning der (én gang) går til Teams.
        const sendOrgWide = scope.all && !orgWideSent;
        processed++;
        const result = await notify({
          orgId,
          event: "digest.manager",
          payload: digest,
          userIds: [profile.userId],
          skipOrgChannels: !sendOrgWide,
        });
        if (sendOrgWide) orgWideSent = true;
        if (result.failed > 0 && result.sent === 0) failed++;
        else succeeded++;
      }
    } catch (error) {
      failed++;
      captureRouteError(error, {
        route: "cron/manager-digest",
        extra: { orgId },
      });
    }
  }

  return {
    itemsProcessed: processed,
    itemsSucceeded: succeeded,
    itemsFailed: failed,
    metadata: { orgs: dueOrgs.length, lastWeekStart },
  };
});
