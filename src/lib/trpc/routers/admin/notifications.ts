import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { adminSettings } from "@/lib/db/schema";
import { testAdminDiscordWebhook } from "@/lib/notifications/admin";
import { adminProcedure, router } from "../../trpc";
import { logAdminAction } from "./shared";

export const adminNotificationsRouter = router({
  getNotificationSettings: adminProcedure.query(async ({ ctx }) => {
    const notificationKeys = [
      "notification_email",
      "discord_webhook_url",
      "notify_signup",
      "notify_subscription_started",
      "notify_payment_failed",
      "notify_subscription_cancelled",
      "notify_trial_ending",
      "notify_user_flagged",
    ];

    const rows = await ctx.db.query.adminSettings.findMany({
      where: inArray(adminSettings.id, notificationKeys),
    });

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.id] = row.value;
    }

    return settings;
  }),

  updateNotificationSettings: adminProcedure
    .input(
      z.object({
        settings: z.record(
          z.enum([
            "notification_email",
            "discord_webhook_url",
            "notify_signup",
            "notify_subscription_started",
            "notify_payment_failed",
            "notify_subscription_cancelled",
            "notify_trial_ending",
            "notify_user_flagged",
          ]),
          z.string(),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "update_notification_settings",
        null,
        { keys: Object.keys(input.settings) },
        ctx.headers,
      );

      for (const [key, value] of Object.entries(input.settings)) {
        await ctx.db
          .insert(adminSettings)
          .values({
            id: key,
            value,
            updatedAt: new Date(),
            updatedBy: ctx.session.user.id,
          })
          .onConflictDoUpdate({
            target: adminSettings.id,
            set: {
              value,
              updatedAt: new Date(),
              updatedBy: ctx.session.user.id,
            },
          });
      }

      return { success: true };
    }),

  testDiscordWebhook: adminProcedure
    .input(
      z.object({
        webhookUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let webhookUrl = input.webhookUrl;

      if (!webhookUrl) {
        const setting = await ctx.db.query.adminSettings.findFirst({
          where: eq(adminSettings.id, "discord_webhook_url"),
        });
        webhookUrl = setting?.value || process.env.ADMIN_DISCORD_WEBHOOK_URL;
      }

      if (!webhookUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ingen Discord webhook URL konfigureret",
        });
      }

      const success = await testAdminDiscordWebhook(webhookUrl);

      if (!success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Discord webhook test fejlede. Tjek URL'en.",
        });
      }

      return { success: true };
    }),
});
