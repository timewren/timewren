import { and, eq, sql } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  employeeProfiles,
  orgAuditLogs,
  organizationModules,
} from "@/lib/db/schema";
import {
  forecastCompliance,
  forecastWindow,
} from "@/lib/enterprise/compliance-forecast";
import { loadComplianceRuleSettings } from "@/lib/enterprise/compliance-guard";
import { loadComplianceInputs } from "@/lib/enterprise/compliance-inputs";
import {
  loadPlanLookups,
  loadPlanMembers,
} from "@/lib/enterprise/work-plan-load";
import { notify, resolveManagerRecipientIds } from "@/lib/notifications/bus";
import {
  addDaysToDateStr,
  copenhagenToday,
  isoWeekdayOfDateStr,
  weekStartDateStr,
} from "@/lib/time/copenhagen";
import { captureRouteError } from "@/lib/utils/sentry";

// Friday: warn before the next working week, independent of digest settings.
export const GET = withCronLogging("compliance-forecast", async () => {
  const today = copenhagenToday();
  if (isoWeekdayOfDateStr(today) !== 5) return { itemsProcessed: 0 };
  const weekStart = addDaysToDateStr(weekStartDateStr(today), 7);
  const orgs = await db.query.organizationModules.findMany({
    where: and(
      eq(organizationModules.moduleKey, "enterprise"),
      eq(organizationModules.isEnabled, true),
    ),
    columns: { organizationId: true },
  });
  let succeeded = 0;
  let failed = 0;
  for (const { organizationId: orgId } of orgs) {
    try {
      // Serialize repeated/concurrent runs without introducing a schema change.
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`compliance-forecast:${orgId}`}))`,
        );
        const profiles = await db.query.employeeProfiles.findMany({
          where: and(
            eq(employeeProfiles.organizationId, orgId),
            eq(employeeProfiles.isActive, true),
          ),
          columns: {
            userId: true,
            isSelfScheduler: true,
            startDate: true,
            endDate: true,
          },
          with: { user: { columns: { name: true } } },
        });
        const settings = await loadComplianceRuleSettings(db, orgId);
        const window = forecastWindow(
          weekStart,
          settings.referencePeriodMonths,
        );
        const active = profiles.filter(
          (p) =>
            !p.isSelfScheduler &&
            (!p.startDate || p.startDate <= window.to) &&
            (!p.endDate || p.endDate >= weekStart),
        );
        const userIds = active.map((p) => p.userId);
        const members = await loadPlanMembers(db, orgId, userIds);
        const plans = await loadPlanLookups(db, orgId, members);
        const inputs = await loadComplianceInputs(db, {
          orgId,
          userIds,
          ...window,
          from: forecastWindow(weekStart, settings.referencePeriodMonths, 0)
            .from,
          forecast: true,
        });
        for (const profile of active) {
          const plan = plans.get(profile.userId);
          if (
            !Array.from({ length: 7 }, (_, i) =>
              addDaysToDateStr(weekStart, i),
            ).some((d) => plan?.hasPlan(d))
          )
            continue;
          const result = forecastCompliance({
            weekStart,
            months: settings.referencePeriodMonths,
            entries: inputs.entriesByUser.get(profile.userId) ?? [],
            neutralAbsenceDates: inputs.neutralAbsenceByUser.get(
              profile.userId,
            ),
            rule48h: settings.rules.rule48h,
            dailyRest: settings.rules.dailyRest,
            employmentStart: profile.startDate,
            employmentEnd: profile.endDate,
          });
          if (!result.findings.length) continue;
          const previous = await tx.query.orgAuditLogs.findFirst({
            where: and(
              eq(orgAuditLogs.organizationId, orgId),
              eq(orgAuditLogs.action, "compliance_forecast_sent"),
              eq(orgAuditLogs.targetUserId, profile.userId),
              sql`${orgAuditLogs.metadata}->>'weekStart' = ${weekStart}`,
            ),
            columns: { id: true },
          });
          if (previous) continue;
          const managers = await resolveManagerRecipientIds(db, {
            orgId,
            employeeUserId: profile.userId,
          });
          const delivery = await notify({
            orgId,
            event: "compliance.forecast",
            userIds: [...new Set([profile.userId, ...managers])],
            payload: {
              weekStart,
              findings: result.findings,
              employeeName: profile.user?.name ?? undefined,
            },
          });
          if (delivery.failed) {
            failed++;
            continue;
          }
          await tx.insert(orgAuditLogs).values({
            organizationId: orgId,
            action: "compliance_forecast_sent",
            targetUserId: profile.userId,
            metadata: { weekStart },
          });
          succeeded++;
        }
      });
    } catch (error) {
      failed++;
      captureRouteError(error, {
        route: "/api/cron/compliance-forecast",
        type: "cron",
      });
    }
  }
  return {
    itemsProcessed: succeeded + failed,
    itemsSucceeded: succeeded,
    itemsFailed: failed,
  };
});
