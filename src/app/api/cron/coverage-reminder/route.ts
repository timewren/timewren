import { and, eq, gte, isNotNull } from "drizzle-orm";
import {
  isBelowCoverageThreshold,
  shiftDate,
  todayInTimeZone,
} from "@/lib/coverage/coverage";
import {
  isEnterpriseEnabled,
  loadCoverageEntries,
  loadWorkTimeContext,
} from "@/lib/coverage/load";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { notificationDeliveries, users } from "@/lib/db/schema";
import { notify } from "@/lib/notifications/bus";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 30 6 * * * (dagligt 06:30 UTC ≈ 08:30 dansk sommertid)
//
// Tærskel-variant af påmindelsen om manglende tid (#679): brugere der selv
// har sat en grænse for dækningsgraden (users.coverage_reminder_threshold)
// får besked, når gårsdagens loggede tid var under grænsen. Kun dage med
// arbejdstid tæller (fridage/weekend giver aldrig påmindelse). Uden tærskel
// sker der intet — fredags-påmindelsen om timesedler (timesheet-reminder) er
// uændret.

const DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000;

export const GET = withCronLogging("coverage-reminder", async () => {
  const optedIn = await db.query.users.findMany({
    where: isNotNull(users.coverageReminderThreshold),
    columns: { id: true },
  });

  let sent = 0;
  let failed = 0;
  let belowThreshold = 0;

  for (const { id: userId } of optedIn) {
    try {
      // Dedup mod dobbeltkørsel (redeploy/manuel kørsel) — på tværs af
      // kanaler, så også brugere uden e-mail-kanal er beskyttet
      const recent = await db.query.notificationDeliveries.findFirst({
        where: and(
          eq(notificationDeliveries.userId, userId),
          eq(notificationDeliveries.event, "reminder.coverage_low"),
          gte(
            notificationDeliveries.createdAt,
            new Date(Date.now() - DEDUP_WINDOW_MS),
          ),
        ),
        columns: { id: true },
      });
      if (recent) continue;

      const orgId = await getUserOrgId(userId);
      if (!orgId) continue; // bussen leverer pr. org

      const wt = await loadWorkTimeContext(db, userId, orgId, {
        enterpriseEnabled: await isEnterpriseEnabled(db, orgId),
      });
      const yesterday = shiftDate(todayInTimeZone(wt.timezone), -1);
      const expectedHours = wt.hoursFor(yesterday);
      if (!(expectedHours > 0)) continue;

      const entries = await loadCoverageEntries(db, {
        userId,
        orgId,
        start: yesterday,
        end: yesterday,
      });
      const loggedHours = entries.reduce((sum, e) => sum + e.hours, 0);
      if (
        !isBelowCoverageThreshold(
          loggedHours,
          expectedHours,
          wt.reminderThreshold,
        )
      ) {
        continue;
      }
      belowThreshold++;

      const result = await notify({
        orgId,
        event: "reminder.coverage_low",
        payload: {
          date: yesterday,
          loggedHours: Math.round(loggedHours * 100) / 100,
          expectedHours,
          coveragePct: Math.round((loggedHours / expectedHours) * 1000) / 10,
          threshold: wt.reminderThreshold ?? 0,
        },
        userIds: [userId],
      });
      if (result.failed > 0 && result.sent === 0) failed++;
      else sent++;
    } catch (error) {
      failed++;
      captureRouteError(error, { route: "cron/coverage-reminder", userId });
    }
  }

  return {
    itemsProcessed: belowThreshold,
    itemsSucceeded: sent,
    itemsFailed: failed,
    metadata: { optedIn: optedIn.length },
  };
});
