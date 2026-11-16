// Notification settings are per-user
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { db } from "@/lib/db";
import { emailPreferences, notificationChannels, users } from "@/lib/db/schema";
import {
  buildTestMessages,
  sendSlackMessage,
} from "@/lib/integrations/notifications";
import { isChannelActiveToday } from "@/lib/notifications";
import { testDiscordWebhook } from "@/lib/notifications/discord";
import {
  getVapidPublicKey,
  isPushConfigured,
  type PushSubscription,
  testPushSubscription,
} from "@/lib/notifications/push";
import {
  decryptChannelWebhooks,
  encryptWebhookSecret,
  getDiscordWebhookUrl,
  getSlackWebhookUrl,
} from "@/lib/notifications/webhook-secrets";
import { protectedProcedure, router } from "../trpc";

async function getUserTimezone(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { timezone: true },
  });
  return user?.timezone ?? null;
}

export const notificationsRouter = router({
  /**
   * Get all notification channels for the user
   */
  getChannels: protectedProcedure.query(async ({ ctx }) => {
    const channels = await db.query.notificationChannels.findMany({
      where: eq(notificationChannels.userId, ctx.session.user.id),
    });

    return channels.map((ch) => ({
      id: ch.id,
      channelType: ch.channelType,
      isEnabled: ch.isEnabled,
      // Don't expose full webhook URL, just show connected status
      discordConnected: !!ch.discordWebhookUrl,
      discordWebhookName: ch.discordWebhookName,
      slackConnected: !!ch.slackWebhookUrl,
      slackChannelName: ch.slackChannelName,
      pushConnected: !!ch.pushSubscription,
      // Notification preferences
      sendDailyDigest: ch.sendDailyDigest,
      sendDeadlineReminders: ch.sendDeadlineReminders,
      sendOverdueAlerts: ch.sendOverdueAlerts,
      sendWeeklyReview: ch.sendWeeklyReview,
      sendUnbilledReminders: ch.sendUnbilledReminders,
      sendAiSuggestions: ch.sendAiSuggestions,
      // Timer-specific notifications
      sendTimerStart: ch.sendTimerStart,
      sendTimerStop: ch.sendTimerStop,
      sendIdleWarning: ch.sendIdleWarning,
      sendEndOfDay: ch.sendEndOfDay,
      // Active weekdays (0=Sunday … 6=Saturday)
      activeDays: ch.activeDays,
      // Test status
      lastTestedAt: ch.lastTestedAt,
      lastTestStatus: ch.lastTestStatus,
    }));
  }),

  /**
   * Get email notification preferences
   */
  getEmailPreferences: protectedProcedure.query(async ({ ctx }) => {
    const prefs = await db.query.emailPreferences.findFirst({
      where: eq(emailPreferences.userId, ctx.session.user.id),
    });

    return (
      prefs || {
        weeklyReport: true,
        monthlyReport: true,
        unbilledReminder: true,
        passwordChanged: true,
        newLoginAlert: true,
        emailChanged: true,
        onboardingMilestones: true,
        inactivityReminder: true,
        tipsAndTricks: false,
        productUpdates: true,
        dripEmails: true,
        weeklyReportDay: "monday",
        weeklyReportTime: "08:00",
        monthlyReportDay: 1,
        unbilledReminderFrequency: "weekly",
        inactivityReminderDays: 7,
        quietHoursEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        digestMode: false,
        digestFrequency: "daily",
      }
    );
  }),

  /**
   * Update email notification preferences
   */
  updateEmailPreferences: protectedProcedure
    .input(
      z.object({
        weeklyReport: z.boolean().optional(),
        monthlyReport: z.boolean().optional(),
        unbilledReminder: z.boolean().optional(),
        passwordChanged: z.boolean().optional(),
        newLoginAlert: z.boolean().optional(),
        emailChanged: z.boolean().optional(),
        onboardingMilestones: z.boolean().optional(),
        inactivityReminder: z.boolean().optional(),
        tipsAndTricks: z.boolean().optional(),
        productUpdates: z.boolean().optional(),
        weeklyReportDay: z.string().optional(),
        weeklyReportTime: z.string().optional(),
        monthlyReportDay: z.number().min(1).max(28).optional(),
        unbilledReminderFrequency: z
          .enum(["daily", "weekly", "monthly"])
          .optional(),
        inactivityReminderDays: z.number().min(1).max(30).optional(),
        quietHoursEnabled: z.boolean().optional(),
        quietHoursStart: z.string().optional(),
        quietHoursEnd: z.string().optional(),
        digestMode: z.boolean().optional(),
        digestFrequency: z.enum(["daily", "weekly"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.emailPreferences.findFirst({
        where: eq(emailPreferences.userId, ctx.session.user.id),
      });

      if (existing) {
        await db
          .update(emailPreferences)
          .set({
            ...input,
            updatedAt: new Date(),
          })
          .where(eq(emailPreferences.id, existing.id));
      } else {
        await db.insert(emailPreferences).values({
          userId: ctx.session.user.id,
          ...input,
        });
      }

      // Sync unsubscribe status to Resend contact if connected
      try {
        const user = await db.query.users.findFirst({
          where: eq(users.id, ctx.session.user.id),
          columns: { resendContactId: true },
        });
        if (user?.resendContactId) {
          // Determine if ALL topics are unsubscribed
          const allPrefs = await db.query.emailPreferences.findFirst({
            where: eq(emailPreferences.userId, ctx.session.user.id),
          });
          if (allPrefs) {
            const allUnsubscribed =
              !allPrefs.weeklyReport &&
              !allPrefs.monthlyReport &&
              !allPrefs.unbilledReminder &&
              !allPrefs.tipsAndTricks &&
              !(allPrefs as Record<string, unknown>).productUpdates;
            if (allUnsubscribed) {
              const { updateContactSubscription } = await import(
                "@/lib/resend-contacts"
              );
              await updateContactSubscription(user.resendContactId, true);
            }
          }
        }
      } catch (_syncErr) {
        // Don't fail the mutation if Resend sync fails
        console.error("[Notifications] Failed to sync to Resend:", _syncErr);
      }

      return { success: true };
    }),

  /**
   * Add Discord webhook
   */
  addDiscordWebhook: protectedProcedure
    .input(
      z.object({
        webhookUrl: z.string().url(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate Discord webhook URL format
      if (!input.webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
        throw new Error(
          await tr("serverErrors", "notifications.invalidDiscordUrl"),
        );
      }

      // Check if Discord channel already exists
      const existing = await db.query.notificationChannels.findFirst({
        where: and(
          eq(notificationChannels.userId, ctx.session.user.id),
          eq(notificationChannels.channelType, "discord"),
        ),
      });

      if (existing) {
        await db
          .update(notificationChannels)
          .set({
            discordWebhookUrl: encryptWebhookSecret(input.webhookUrl),
            discordWebhookName: input.name,
            isEnabled: true,
            updatedAt: new Date(),
          })
          .where(eq(notificationChannels.id, existing.id));
        return { id: existing.id };
      }

      const [channel] = await db
        .insert(notificationChannels)
        .values({
          userId: ctx.session.user.id,
          channelType: "discord",
          discordWebhookUrl: encryptWebhookSecret(input.webhookUrl),
          discordWebhookName: input.name,
          isEnabled: true,
          sendDailyDigest: true,
          sendDeadlineReminders: true,
          sendOverdueAlerts: true,
          sendWeeklyReview: false,
          sendUnbilledReminders: true,
          sendAiSuggestions: false,
        })
        .returning({ id: notificationChannels.id });

      return { id: channel.id };
    }),

  /**
   * Remove Discord webhook
   */
  removeDiscordWebhook: protectedProcedure.mutation(async ({ ctx }) => {
    await db
      .delete(notificationChannels)
      .where(
        and(
          eq(notificationChannels.userId, ctx.session.user.id),
          eq(notificationChannels.channelType, "discord"),
        ),
      );

    return { success: true };
  }),

  /**
   * Add Slack webhook
   */
  addSlackWebhook: protectedProcedure
    .input(
      z.object({
        webhookUrl: z.string().url(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate Slack webhook URL format — use startsWith to prevent SSRF bypass
      if (!input.webhookUrl.startsWith("https://hooks.slack.com/")) {
        throw new Error(
          await tr("serverErrors", "notifications.invalidSlackUrl"),
        );
      }

      // Check if Slack channel already exists
      const existing = await db.query.notificationChannels.findFirst({
        where: and(
          eq(notificationChannels.userId, ctx.session.user.id),
          eq(notificationChannels.channelType, "slack"),
        ),
      });

      if (existing) {
        await db
          .update(notificationChannels)
          .set({
            slackWebhookUrl: encryptWebhookSecret(input.webhookUrl),
            slackChannelName: input.name,
            isEnabled: true,
            updatedAt: new Date(),
          })
          .where(eq(notificationChannels.id, existing.id));
        return { id: existing.id };
      }

      const [channel] = await db
        .insert(notificationChannels)
        .values({
          userId: ctx.session.user.id,
          channelType: "slack",
          slackWebhookUrl: encryptWebhookSecret(input.webhookUrl),
          slackChannelName: input.name,
          isEnabled: true,
          sendDailyDigest: true,
          sendDeadlineReminders: true,
          sendOverdueAlerts: true,
          sendWeeklyReview: false,
          sendUnbilledReminders: true,
          sendAiSuggestions: false,
          sendTimerStart: false,
          sendTimerStop: false,
          sendIdleWarning: false,
        })
        .returning({ id: notificationChannels.id });

      return { id: channel.id };
    }),

  /**
   * Remove Slack webhook
   */
  removeSlackWebhook: protectedProcedure.mutation(async ({ ctx }) => {
    await db
      .delete(notificationChannels)
      .where(
        and(
          eq(notificationChannels.userId, ctx.session.user.id),
          eq(notificationChannels.channelType, "slack"),
        ),
      );

    return { success: true };
  }),

  /**
   * Test Slack webhook
   */
  testSlackWebhook: protectedProcedure.mutation(async ({ ctx }) => {
    const channel = await db.query.notificationChannels.findFirst({
      where: and(
        eq(notificationChannels.userId, ctx.session.user.id),
        eq(notificationChannels.channelType, "slack"),
      ),
    });

    const slackWebhookUrl = channel ? getSlackWebhookUrl(channel) : null;
    if (!channel || !slackWebhookUrl) {
      throw new Error(await tr("serverErrors", "notifications.noSlackWebhook"));
    }

    const { slack } = buildTestMessages();
    const result = await sendSlackMessage(slackWebhookUrl, slack);

    await db
      .update(notificationChannels)
      .set({
        lastTestedAt: new Date(),
        lastTestStatus: result.success ? "success" : "failed",
        updatedAt: new Date(),
      })
      .where(eq(notificationChannels.id, channel.id));

    if (!result.success) {
      throw new Error(result.error || "Slack webhook test fejlede");
    }

    return { success: true };
  }),

  /**
   * Test Discord webhook
   */
  testDiscordWebhook: protectedProcedure.mutation(async ({ ctx }) => {
    const channel = await db.query.notificationChannels.findFirst({
      where: and(
        eq(notificationChannels.userId, ctx.session.user.id),
        eq(notificationChannels.channelType, "discord"),
      ),
    });

    const discordWebhookUrl = channel ? getDiscordWebhookUrl(channel) : null;
    if (!channel || !discordWebhookUrl) {
      throw new Error(
        await tr("serverErrors", "notifications.noDiscordWebhook"),
      );
    }

    const success = await testDiscordWebhook(discordWebhookUrl);

    await db
      .update(notificationChannels)
      .set({
        lastTestedAt: new Date(),
        lastTestStatus: success ? "success" : "failed",
        updatedAt: new Date(),
      })
      .where(eq(notificationChannels.id, channel.id));

    if (!success) {
      throw new Error(
        await tr("serverErrors", "notifications.discordTestFailed"),
      );
    }

    return { success: true };
  }),

  /**
   * Get push notification config
   */
  getPushConfig: protectedProcedure.query(() => ({
    configured: isPushConfigured(),
    publicKey: getVapidPublicKey(),
  })),

  /**
   * Subscribe to push notifications
   */
  subscribePush: protectedProcedure
    .input(
      z.object({
        subscription: z.object({
          endpoint: z.string().url(),
          expirationTime: z.number().nullable().optional(),
          keys: z.object({
            p256dh: z.string(),
            auth: z.string(),
          }),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subscription = input.subscription as PushSubscription;

      // Check if push channel already exists
      const existing = await db.query.notificationChannels.findFirst({
        where: and(
          eq(notificationChannels.userId, ctx.session.user.id),
          eq(notificationChannels.channelType, "browser_push"),
        ),
      });

      if (existing) {
        await db
          .update(notificationChannels)
          .set({
            pushSubscription: subscription,
            isEnabled: true,
            updatedAt: new Date(),
          })
          .where(eq(notificationChannels.id, existing.id));
        return { id: existing.id };
      }

      const [channel] = await db
        .insert(notificationChannels)
        .values({
          userId: ctx.session.user.id,
          channelType: "browser_push",
          pushSubscription: subscription,
          isEnabled: true,
          sendDailyDigest: false,
          sendDeadlineReminders: true,
          sendOverdueAlerts: true,
          sendWeeklyReview: false,
          sendUnbilledReminders: true,
          sendAiSuggestions: false,
        })
        .returning({ id: notificationChannels.id });

      return { id: channel.id };
    }),

  /**
   * Unsubscribe from push notifications
   */
  unsubscribePush: protectedProcedure.mutation(async ({ ctx }) => {
    await db
      .delete(notificationChannels)
      .where(
        and(
          eq(notificationChannels.userId, ctx.session.user.id),
          eq(notificationChannels.channelType, "browser_push"),
        ),
      );

    return { success: true };
  }),

  /**
   * Test push notification
   */
  testPush: protectedProcedure.mutation(async ({ ctx }) => {
    const channel = await db.query.notificationChannels.findFirst({
      where: and(
        eq(notificationChannels.userId, ctx.session.user.id),
        eq(notificationChannels.channelType, "browser_push"),
      ),
    });

    if (!channel?.pushSubscription) {
      throw new Error(
        await tr("serverErrors", "notifications.noPushSubscription"),
      );
    }

    const success = await testPushSubscription(
      channel.pushSubscription as PushSubscription,
    );

    await db
      .update(notificationChannels)
      .set({
        lastTestedAt: new Date(),
        lastTestStatus: success ? "success" : "failed",
        updatedAt: new Date(),
      })
      .where(eq(notificationChannels.id, channel.id));

    if (!success) {
      throw new Error(await tr("serverErrors", "notifications.pushTestFailed"));
    }

    return { success: true };
  }),

  /**
   * Update channel notification preferences
   */
  updateChannelPreferences: protectedProcedure
    .input(
      z.object({
        channelId: z.string().uuid(),
        isEnabled: z.boolean().optional(),
        sendDailyDigest: z.boolean().optional(),
        sendDeadlineReminders: z.boolean().optional(),
        sendOverdueAlerts: z.boolean().optional(),
        sendWeeklyReview: z.boolean().optional(),
        sendUnbilledReminders: z.boolean().optional(),
        sendAiSuggestions: z.boolean().optional(),
        // Timer-specific notifications
        sendTimerStart: z.boolean().optional(),
        sendTimerStop: z.boolean().optional(),
        sendIdleWarning: z.boolean().optional(),
        sendEndOfDay: z.boolean().optional(),
        // Active weekdays (0=Sunday … 6=Saturday). Sorted + de-duped server-side
        // to keep the stored array canonical.
        activeDays: z
          .array(z.number().int().min(0).max(6))
          .max(7)
          .transform((days) => [...new Set(days)].sort((a, b) => a - b))
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { channelId, ...updates } = input;

      // Verify ownership
      const channel = await db.query.notificationChannels.findFirst({
        where: and(
          eq(notificationChannels.id, channelId),
          eq(notificationChannels.userId, ctx.session.user.id),
        ),
      });

      if (!channel) {
        throw new Error(
          await tr("serverErrors", "notifications.channelNotFound"),
        );
      }

      await db
        .update(notificationChannels)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(notificationChannels.id, channelId));

      return { success: true };
    }),

  /**
   * Send timer start notification to enabled channels
   */
  sendTimerStartNotification: protectedProcedure
    .input(
      z.object({
        projectName: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sendDiscordMessage, buildTimerStartMessages } = await import(
        "@/lib/integrations/notifications"
      );

      // Get channels with timer start notification enabled
      const channels = await db.query.notificationChannels.findMany({
        where: and(
          eq(notificationChannels.userId, ctx.session.user.id),
          eq(notificationChannels.isEnabled, true),
          eq(notificationChannels.sendTimerStart, true),
        ),
      });

      const results = [];

      const timerStartData = {
        projectName: input.projectName || null,
        clientName: null, // Not available in this context
        description: input.description || "",
        startTime: new Date(),
      };

      const tz = await getUserTimezone(ctx.session.user.id);

      for (const channel of decryptChannelWebhooks(channels)) {
        if (!isChannelActiveToday(channel, undefined, tz)) continue;
        if (channel.channelType === "discord" && channel.discordWebhookUrl) {
          const { discord } = buildTimerStartMessages(timerStartData);
          const result = await sendDiscordMessage(
            channel.discordWebhookUrl,
            discord,
          );
          results.push({ channel: "discord", ...result });
        }
        // Slack support
        if (channel.channelType === "slack" && channel.slackWebhookUrl) {
          const { sendSlackMessage, buildTimerStartMessages: buildSlack } =
            await import("@/lib/integrations/notifications");
          const { slack } = buildSlack(timerStartData);
          const result = await sendSlackMessage(channel.slackWebhookUrl, slack);
          results.push({ channel: "slack", ...result });
        }
      }

      return { success: true, results };
    }),

  /**
   * Send timer stop notification to enabled channels
   */
  sendTimerStopNotification: protectedProcedure
    .input(
      z.object({
        projectName: z.string().optional(),
        description: z.string().optional(),
        duration: z.number(), // in seconds
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sendDiscordMessage, buildTimerStopMessages } = await import(
        "@/lib/integrations/notifications"
      );

      // Get channels with timer stop notification enabled
      const channels = await db.query.notificationChannels.findMany({
        where: and(
          eq(notificationChannels.userId, ctx.session.user.id),
          eq(notificationChannels.isEnabled, true),
          eq(notificationChannels.sendTimerStop, true),
        ),
      });

      const results = [];

      const now = new Date();
      const durationMinutes = Math.round(input.duration / 60);
      const startTime = new Date(now.getTime() - input.duration * 1000);

      const timerStopData = {
        projectName: input.projectName || null,
        clientName: null, // Not available in this context
        description: input.description || "",
        durationMinutes,
        startTime,
        endTime: now,
      };

      const tz = await getUserTimezone(ctx.session.user.id);

      for (const channel of decryptChannelWebhooks(channels)) {
        if (!isChannelActiveToday(channel, now, tz)) continue;
        if (channel.channelType === "discord" && channel.discordWebhookUrl) {
          const { discord } = buildTimerStopMessages(timerStopData);
          const result = await sendDiscordMessage(
            channel.discordWebhookUrl,
            discord,
          );
          results.push({ channel: "discord", ...result });
        }
        // Slack support
        if (channel.channelType === "slack" && channel.slackWebhookUrl) {
          const { sendSlackMessage, buildTimerStopMessages: buildSlack } =
            await import("@/lib/integrations/notifications");
          const { slack } = buildSlack(timerStopData);
          const result = await sendSlackMessage(channel.slackWebhookUrl, slack);
          results.push({ channel: "slack", ...result });
        }
      }

      return { success: true, results };
    }),

  /**
   * Send idle warning notification to enabled channels
   */
  sendIdleWarningNotification: protectedProcedure
    .input(
      z.object({
        projectName: z.string().optional(),
        idleMinutes: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sendDiscordMessage, buildIdleWarningMessages } = await import(
        "@/lib/integrations/notifications"
      );

      // Get channels with idle warning notification enabled
      const channels = await db.query.notificationChannels.findMany({
        where: and(
          eq(notificationChannels.userId, ctx.session.user.id),
          eq(notificationChannels.isEnabled, true),
          eq(notificationChannels.sendIdleWarning, true),
        ),
      });

      const results = [];

      const idleWarningData = {
        projectName: input.projectName || null,
        idleMinutes: input.idleMinutes,
      };

      const tz = await getUserTimezone(ctx.session.user.id);

      for (const channel of decryptChannelWebhooks(channels)) {
        if (!isChannelActiveToday(channel, undefined, tz)) continue;
        if (channel.channelType === "discord" && channel.discordWebhookUrl) {
          const { discord } = buildIdleWarningMessages(idleWarningData);
          const result = await sendDiscordMessage(
            channel.discordWebhookUrl,
            discord,
          );
          results.push({ channel: "discord", ...result });
        }
        // Slack support
        if (channel.channelType === "slack" && channel.slackWebhookUrl) {
          const { sendSlackMessage, buildIdleWarningMessages: buildSlack } =
            await import("@/lib/integrations/notifications");
          const { slack } = buildSlack(idleWarningData);
          const result = await sendSlackMessage(channel.slackWebhookUrl, slack);
          results.push({ channel: "slack", ...result });
        }
      }

      return { success: true, results };
    }),
});
