import { and, between, eq, isNull, ne, or } from "drizzle-orm";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  clients,
  emailPreferences,
  notificationChannels,
  tasks,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { wasEmailSentRecently } from "@/lib/email/logger";
import { sendWeeklySummaryEmail } from "@/lib/email/reports";
import {
  buildWeeklySummaryMessages,
  sendDiscordMessage,
  sendSlackMessage,
} from "@/lib/integrations/notifications";
import { notCancelledTask } from "@/lib/kanban/lanes-server";
import { isChannelActiveToday } from "@/lib/notifications";
import { decryptChannelWebhooks } from "@/lib/notifications/webhook-secrets";
import {
  addDaysToDateStr,
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenToday,
  entryDateFromStr,
  toCopenhagenDateStr,
  weekStartDateStr,
} from "@/lib/time/copenhagen";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 0 8 * * 1 (Every Monday at 08:00)

function getWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Dansk uge (mandag–søndag) uanset processens TZ (#649). `start`/`end` er de
 * præcise øjeblikke for forespørgsler; `label*` er UTC-midnat på datoen, som
 * vises som samme dato både i UTC og i Europe/Copenhagen.
 */
function getWeekBounds(weeksAgo: number): {
  start: Date;
  end: Date;
  labelStart: Date;
  labelEnd: Date;
} {
  const monday = addDaysToDateStr(
    weekStartDateStr(copenhagenToday()),
    -7 * weeksAgo,
  );
  const sunday = addDaysToDateStr(monday, 6);
  return {
    start: copenhagenDayStart(monday),
    end: new Date(copenhagenDayEndExclusive(sunday).getTime() - 1),
    labelStart: entryDateFromStr(monday),
    labelEnd: entryDateFromStr(sunday),
  };
}

export const GET = withCronLogging("weekly-summary", async (_request) => {
  // Only load users who want weekly reports. Default is enabled, so
  // include users with NULL prefs row or prefs.weeklyReport != false.
  const usersWithPrefs = await db
    .select({
      // Kun de kolonner, løkken bruger — ikke hele user-rækken med
      // credentials (#1115).
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        locale: users.locale,
        timezone: users.timezone,
      },
    })
    .from(users)
    .leftJoin(emailPreferences, eq(users.id, emailPreferences.userId))
    .where(
      or(
        isNull(emailPreferences.userId),
        ne(emailPreferences.weeklyReport, false),
      ),
    );

  const lastWeek = getWeekBounds(1);
  const weekBeforeLast = getWeekBounds(2);
  const weekNumber = getWeekNumber(lastWeek.labelStart);
  const year = lastWeek.labelStart.getUTCFullYear();

  let sentCount = 0;
  const errors: string[] = [];

  for (const { user } of usersWithPrefs) {
    try {
      // Dedup: never send more than one weekly summary per ~week, even if the
      // cron is re-triggered (redeploy / manual run).
      if (
        await wasEmailSentRecently(
          user.id,
          "weekly_summary",
          6 * 24 * 60 * 60 * 1000,
        )
      ) {
        continue;
      }

      // Per-user cron: filters by userId (personal digest), orgId added for index efficiency
      const orgId = await getUserOrgId(user.id);

      // Get time entries for last week
      const lastWeekEntries = await db
        .select({
          hours: timeEntries.hours,
          billableRate: timeEntries.billableRate,
          date: timeEntries.date,
          clientId: timeEntries.clientId,
          isBilled: timeEntries.isBilled,
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, user.id),
            ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
            between(timeEntries.date, lastWeek.start, lastWeek.end),
          ),
        );

      // Skip if no activity
      if (lastWeekEntries.length === 0) continue;

      // Get time entries for week before last
      const previousWeekEntries = await db
        .select({
          hours: timeEntries.hours,
          billableRate: timeEntries.billableRate,
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, user.id),
            ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
            between(timeEntries.date, weekBeforeLast.start, weekBeforeLast.end),
          ),
        );

      // Calculate stats
      const hoursThisWeek = lastWeekEntries.reduce(
        (sum, e) => sum + parseFloat(e.hours || "0"),
        0,
      );
      const hoursLastWeek = previousWeekEntries.reduce(
        (sum, e) => sum + parseFloat(e.hours || "0"),
        0,
      );

      const revenueThisWeek = lastWeekEntries.reduce(
        (sum, e) =>
          sum + parseFloat(e.hours || "0") * parseFloat(e.billableRate || "0"),
        0,
      );
      const revenueLastWeek = previousWeekEntries.reduce(
        (sum, e) =>
          sum + parseFloat(e.hours || "0") * parseFloat(e.billableRate || "0"),
        0,
      );

      // Calculate unbilled amount
      const unbilledAmount = lastWeekEntries
        .filter((e) => !e.isBilled)
        .reduce(
          (sum, e) =>
            sum +
            parseFloat(e.hours || "0") * parseFloat(e.billableRate || "0"),
          0,
        );

      // Get unique days tracked
      const uniqueDays = new Set(
        lastWeekEntries.map((e) =>
          e.date ? toCopenhagenDateStr(e.date) : undefined,
        ),
      );
      const daysTracked = uniqueDays.size;

      // Get top clients
      const clientHours: Record<string, { hours: number; revenue: number }> =
        {};
      for (const entry of lastWeekEntries) {
        if (!entry.clientId) continue;
        if (!clientHours[entry.clientId]) {
          clientHours[entry.clientId] = { hours: 0, revenue: 0 };
        }
        clientHours[entry.clientId].hours += parseFloat(entry.hours || "0");
        clientHours[entry.clientId].revenue +=
          parseFloat(entry.hours || "0") *
          parseFloat(entry.billableRate || "0");
      }

      // Get client names
      const clientIds = Object.keys(clientHours);
      const clientData =
        clientIds.length > 0
          ? await db
              .select({ id: clients.id, name: clients.name })
              .from(clients)
              .where(
                and(
                  or(...clientIds.map((id) => eq(clients.id, id))),
                  ...(orgId ? [eq(clients.organizationId, orgId)] : []),
                ),
              )
          : [];

      const topClients = Object.entries(clientHours)
        .map(([clientId, data]) => ({
          name: clientData.find((c) => c.id === clientId)?.name || "",
          hours: data.hours,
          revenue: data.revenue,
        }))
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 3);

      // Send email
      await sendWeeklySummaryEmail({
        to: user.email,
        userName: user.name,
        weekNumber,
        year,
        hoursThisWeek,
        hoursLastWeek,
        revenueThisWeek,
        revenueLastWeek,
        unbilledAmount,
        topClients,
        daysTracked,
        userId: user.id,
      });

      // Send to Discord/Slack channels with weekly review enabled
      const channels = await db
        .select()
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.userId, user.id),
            eq(notificationChannels.isEnabled, true),
            eq(notificationChannels.sendWeeklyReview, true),
          ),
        );

      // Count completed tasks for the week
      const completedTasks = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, user.id),
            ...(orgId ? [eq(tasks.organizationId, orgId)] : []),
            eq(tasks.status, "done"),
            notCancelledTask(),
            between(tasks.updatedAt, lastWeek.start, lastWeek.end),
          ),
        );

      const hoursChangePercent =
        hoursLastWeek > 0
          ? ((hoursThisWeek - hoursLastWeek) / hoursLastWeek) * 100
          : 0;
      const revenueChangePercent =
        revenueLastWeek > 0
          ? ((revenueThisWeek - revenueLastWeek) / revenueLastWeek) * 100
          : 0;

      const unbilledHours = lastWeekEntries
        .filter((e) => !e.isBilled)
        .reduce((sum, e) => sum + parseFloat(e.hours || "0"), 0);

      const { slack, discord } = buildWeeklySummaryMessages(
        {
          weekNumber,
          startDate: lastWeek.labelStart,
          endDate: lastWeek.labelEnd,
          totalHours: hoursThisWeek,
          totalRevenue: revenueThisWeek,
          hoursChange: hoursChangePercent,
          revenueChange: revenueChangePercent,
          topClients: topClients.map((c) => ({
            clientName: c.name,
            hours: c.hours,
            revenue: c.revenue,
          })),
          tasksCompleted: completedTasks.length,
          unbilledHours,
          unbilledRevenue: unbilledAmount,
        },
        user.locale ?? undefined,
      );

      for (const channel of decryptChannelWebhooks(channels)) {
        if (!isChannelActiveToday(channel, undefined, user.timezone)) continue;
        try {
          if (channel.channelType === "discord" && channel.discordWebhookUrl) {
            await sendDiscordMessage(channel.discordWebhookUrl, discord);
          } else if (
            channel.channelType === "slack" &&
            channel.slackWebhookUrl
          ) {
            await sendSlackMessage(channel.slackWebhookUrl, slack);
          }
        } catch (channelError) {
          console.error(
            `Failed to send weekly summary to ${channel.channelType}:`,
            channelError,
          );
        }
      }

      sentCount++;
    } catch (error) {
      console.error(
        `Failed to send weekly summary for user ${user.id}:`,
        error,
      );
      errors.push(`User ${user.id}: ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/weekly-summary",
      type: "cron",
    });
  }

  return {
    itemsProcessed: usersWithPrefs.length,
    itemsSucceeded: sentCount,
    itemsFailed: errors.length,
    metadata: errors.length > 0 ? { errors } : undefined,
  };
});
