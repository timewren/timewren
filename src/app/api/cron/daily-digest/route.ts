import { and, between, eq, gte, inArray, lt, lte, or, sum } from "drizzle-orm";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  notificationChannels,
  tasks,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { mailT } from "@/lib/email/locale";
import { notCancelledTask } from "@/lib/kanban/lanes-server";
import {
  getQuietHoursPrefs,
  isChannelActiveToday,
  isWithinQuietHours,
} from "@/lib/notifications";
import { sendDailyDigestToDiscord } from "@/lib/notifications/discord";
import {
  type PushSubscription as PushSub,
  sendDailyDigestPush,
} from "@/lib/notifications/push";
import { decryptChannelWebhooks } from "@/lib/notifications/webhook-secrets";
import {
  addDaysToDateStr,
  copenhagenDayStart,
  copenhagenToday,
} from "@/lib/time/copenhagen";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 0 8 * * * (Every day at 08:00)

export const GET = withCronLogging("daily-digest", async (_request) => {
  const now = new Date();
  // Dansk dag uanset processens TZ (prod kører UTC, #649)
  const todayStr = copenhagenToday(now);
  const yesterdayStr = addDaysToDateStr(todayStr, -1);
  const today = copenhagenDayStart(todayStr);
  const tomorrow = copenhagenDayStart(addDaysToDateStr(todayStr, 1));
  const yesterday = copenhagenDayStart(yesterdayStr);

  // Only load users who have at least one notification channel with
  // daily digest enabled. Avoids a full users-table scan + per-user
  // channel query.
  const userIdsWithChannels = await db
    .selectDistinct({ userId: notificationChannels.userId })
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.isEnabled, true),
        eq(notificationChannels.sendDailyDigest, true),
      ),
    );

  const allUsers = userIdsWithChannels.length
    ? await db
        .select({
          id: users.id,
          name: users.name,
          timezone: users.timezone,
          locale: users.locale,
        })
        .from(users)
        .where(
          inArray(
            users.id,
            userIdsWithChannels.map((r) => r.userId),
          ),
        )
    : [];

  // Batch-load quiet-hours prefs once to avoid an N+1 in the loop.
  const quietHoursByUser = await getQuietHoursPrefs(allUsers.map((u) => u.id));

  let sentCount = 0;
  const errors: string[] = [];

  for (const user of allUsers) {
    try {
      // Per-user cron: filters by userId (personal digest), orgId added for index efficiency
      const orgId = await getUserOrgId(user.id);

      // Get channels with daily digest enabled
      const channels = await db
        .select()
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.userId, user.id),
            eq(notificationChannels.isEnabled, true),
            eq(notificationChannels.sendDailyDigest, true),
          ),
        );

      if (channels.length === 0) continue;

      // Get today's tasks (due today or no deadline but in progress)
      const todayTasks = await db.query.tasks.findMany({
        where: and(
          eq(tasks.userId, user.id),
          ...(orgId ? [eq(tasks.organizationId, orgId)] : []),
          between(tasks.deadline, today, tomorrow),
          or(
            eq(tasks.status, "backlog"),
            eq(tasks.status, "todo"),
            eq(tasks.status, "in_progress"),
          ),
        ),
        with: { project: true },
        orderBy: (tasks, { desc, asc }) => [
          desc(tasks.priority),
          asc(tasks.deadline),
        ],
      });

      // Get overdue tasks
      const overdueTasks = await db.query.tasks.findMany({
        where: and(
          eq(tasks.userId, user.id),
          ...(orgId ? [eq(tasks.organizationId, orgId)] : []),
          lte(tasks.deadline, today),
          or(
            eq(tasks.status, "backlog"),
            eq(tasks.status, "todo"),
            eq(tasks.status, "in_progress"),
          ),
        ),
        with: { project: true },
        orderBy: (tasks, { asc }) => [asc(tasks.deadline)],
      });

      // Count tasks completed yesterday
      const completedYesterday = await db.query.tasks.findMany({
        where: and(
          eq(tasks.userId, user.id),
          ...(orgId ? [eq(tasks.organizationId, orgId)] : []),
          eq(tasks.status, "done"),
          notCancelledTask(),
          between(tasks.updatedAt, yesterday, today),
        ),
      });

      // Get yesterday's time tracking stats
      const yesterdayEntries = await db
        .select({
          totalHours: sum(timeEntries.hours),
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, user.id),
            ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
            gte(timeEntries.date, yesterday),
            lt(timeEntries.date, today),
          ),
        );
      const yesterdayHours = parseFloat(yesterdayEntries[0]?.totalHours || "0");

      // Skip if there's nothing to report
      if (
        todayTasks.length === 0 &&
        overdueTasks.length === 0 &&
        completedYesterday.length === 0 &&
        yesterdayHours === 0
      ) {
        continue;
      }

      const digestData = {
        userName:
          user.name || mailT("notifications", user.locale)("fallbackUser"),
        tasksToday: todayTasks.map((t) => ({
          title: t.title,
          projectName: t.project?.name,
          deadline: t.deadline ?? undefined,
          priority: t.priority || "medium",
        })),
        overdueTasks: overdueTasks.map((t) => ({
          title: t.title,
          projectName: t.project?.name,
          deadline: t.deadline ?? undefined,
        })),
        completedYesterday: completedYesterday.length,
        yesterdayHours,
      };

      // Respect quiet hours for intrusive realtime channels.
      if (
        isWithinQuietHours(quietHoursByUser.get(user.id), now, user.timezone)
      ) {
        continue;
      }

      for (const channel of decryptChannelWebhooks(channels)) {
        if (!isChannelActiveToday(channel, now, user.timezone)) continue;
        try {
          if (channel.channelType === "discord" && channel.discordWebhookUrl) {
            await sendDailyDigestToDiscord(
              channel.discordWebhookUrl,
              digestData,
              user.locale ?? undefined,
            );
          } else if (
            channel.channelType === "browser_push" &&
            channel.pushSubscription
          ) {
            await sendDailyDigestPush(
              channel.pushSubscription as unknown as PushSub,
              {
                taskCount: digestData.tasksToday.length,
                overdueCount: digestData.overdueTasks.length,
              },
              user.locale ?? undefined,
            );
          }
        } catch (channelError) {
          console.error(
            `Failed to send daily digest to ${channel.channelType}:`,
            channelError,
          );
        }
      }

      sentCount++;
    } catch (userError) {
      errors.push(
        `User ${user.id}: ${userError instanceof Error ? userError.message : "Unknown error"}`,
      );
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/daily-digest",
      type: "cron",
    });
  }

  return {
    itemsProcessed: allUsers.length,
    itemsSucceeded: sentCount,
    itemsFailed: errors.length,
    metadata: errors.length > 0 ? { errors } : undefined,
  };
});
