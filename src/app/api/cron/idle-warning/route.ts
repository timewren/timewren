import { and, eq, isNotNull, lt } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { notificationChannels, timerStates } from "@/lib/db/schema";
import {
  buildIdleWarningMessages,
  sendDiscordMessage,
  sendSlackMessage,
} from "@/lib/integrations/notifications";
import {
  getQuietHoursPrefs,
  isChannelActiveToday,
  isWithinQuietHours,
} from "@/lib/notifications";
import { decryptChannelWebhooks } from "@/lib/notifications/webhook-secrets";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: */15 * * * * (Every 15 minutes)
// Sends idle warnings for timers running longer than 2 hours without activity

const IDLE_THRESHOLD_MINUTES = 120;

export const GET = withCronLogging("idle-warning", async (_request) => {
  const now = new Date();
  const thresholdTime = new Date(
    now.getTime() - IDLE_THRESHOLD_MINUTES * 60 * 1000,
  );

  // Find running timers that started more than 2 hours ago
  const idleTimers = await db.query.timerStates.findMany({
    where: and(
      eq(timerStates.isRunning, true),
      isNotNull(timerStates.startTime),
      lt(timerStates.startTime, thresholdTime),
    ),
    with: {
      project: { columns: { name: true } },
      user: { columns: { timezone: true, locale: true } },
    },
  });

  // Batch-load quiet-hours prefs once to avoid an N+1 in the loop.
  const quietHoursByUser = await getQuietHoursPrefs([
    ...new Set(idleTimers.map((t) => t.userId)),
  ]);

  let sentCount = 0;
  const errors: string[] = [];

  for (const timer of idleTimers) {
    try {
      // Calculate idle minutes
      const startTime = timer.startTime;
      if (!startTime) continue;
      const runningMinutes = Math.floor(
        (now.getTime() - startTime.getTime()) / (1000 * 60),
      );

      // Check last activity — if user was recently active, skip
      const lastActivity = timer.lastActivityAt || timer.updatedAt;
      if (lastActivity) {
        const activityMinutesAgo = Math.floor(
          (now.getTime() - lastActivity.getTime()) / (1000 * 60),
        );
        // Only warn if no activity in the threshold period
        if (activityMinutesAgo < IDLE_THRESHOLD_MINUTES) continue;
      }

      // Get channels with idle warning enabled
      const channels = await db.query.notificationChannels.findMany({
        where: and(
          eq(notificationChannels.userId, timer.userId),
          eq(notificationChannels.isEnabled, true),
          eq(notificationChannels.sendIdleWarning, true),
        ),
      });

      if (channels.length === 0) continue;

      // Respect quiet hours for intrusive realtime channels.
      if (
        isWithinQuietHours(
          quietHoursByUser.get(timer.userId),
          now,
          timer.user?.timezone,
        )
      ) {
        continue;
      }

      const idleData = {
        projectName: timer.project?.name || null,
        idleMinutes: runningMinutes,
      };

      for (const channel of decryptChannelWebhooks(channels)) {
        if (!isChannelActiveToday(channel, now, timer.user?.timezone)) continue;
        try {
          if (channel.channelType === "discord" && channel.discordWebhookUrl) {
            const { discord } = buildIdleWarningMessages(
              idleData,
              timer.user?.locale ?? undefined,
            );
            await sendDiscordMessage(channel.discordWebhookUrl, discord);
          } else if (
            channel.channelType === "slack" &&
            channel.slackWebhookUrl
          ) {
            const { slack } = buildIdleWarningMessages(
              idleData,
              timer.user?.locale ?? undefined,
            );
            await sendSlackMessage(channel.slackWebhookUrl, slack);
          }
        } catch (channelError) {
          console.error(
            `Failed to send idle warning to ${channel.channelType}:`,
            channelError,
          );
        }
      }

      // Update the timer's updatedAt to prevent re-sending for another 2 hours
      await db
        .update(timerStates)
        .set({ updatedAt: now })
        .where(eq(timerStates.id, timer.id));

      sentCount++;
    } catch (userError) {
      errors.push(
        `Timer ${timer.id}: ${userError instanceof Error ? userError.message : "Unknown error"}`,
      );
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/idle-warning",
      type: "cron",
    });
  }

  return {
    itemsProcessed: idleTimers.length,
    itemsSucceeded: sentCount,
    itemsFailed: errors.length,
    metadata: errors.length > 0 ? { errors } : undefined,
  };
});
