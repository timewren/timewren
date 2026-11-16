import { and, eq, sql } from "drizzle-orm";
import { toIntlLocale } from "@/i18n/format-locale";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { emailPreferences, notificationChannels, users } from "@/lib/db/schema";
import { mailT, normalizeMailLocale } from "@/lib/email/locale";
import { wasEmailSentRecently } from "@/lib/email/logger";
import { sendUnbilledReminderEmail } from "@/lib/email/reports";
import {
  sendDiscordMessage,
  sendSlackMessage,
} from "@/lib/integrations/notifications";
import { loadUnbilledByClient } from "@/lib/invoicing/unbilled";
import { isChannelActiveToday } from "@/lib/notifications";
import {
  normalizeUnbilledReminderFrequency,
  shouldSendUnbilledReminder,
} from "@/lib/notifications/unbilled-reminder";
import { decryptChannelWebhooks } from "@/lib/notifications/webhook-secrets";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 0 10 * * * (dagligt kl. 10 UTC). Hvem der faktisk får mail
// i dag afgøres pr. bruger af emailPreferences.unbilledReminderFrequency
// (daily = hver hverdag, weekly = fredag, monthly = sidste hverdag i måneden).

export const GET = withCronLogging("unbilled-reminder", async (_request) => {
  // Kun brugere, der ikke har fravalgt påmindelsen (ingen prefs-række eller
  // NULL tæller som til, som i løkken), og kun de kolonner, løkken bruger —
  // ikke hele user-rækken med credentials (#1115).
  const usersWithPrefs = await db
    .select({
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        locale: users.locale,
        timezone: users.timezone,
      },
      prefs: {
        unbilledReminder: emailPreferences.unbilledReminder,
        unbilledReminderFrequency: emailPreferences.unbilledReminderFrequency,
      },
    })
    .from(users)
    .leftJoin(emailPreferences, eq(users.id, emailPreferences.userId))
    .where(sql`${emailPreferences.unbilledReminder} is distinct from false`);

  let sentCount = 0;
  const errors: string[] = [];
  const now = new Date();

  for (const { user, prefs } of usersWithPrefs) {
    // Skip if user has disabled unbilled reminders
    if (prefs && prefs.unbilledReminder === false) continue;

    const frequency = normalizeUnbilledReminderFrequency(
      prefs?.unbilledReminderFrequency,
    );

    // Kadence: cronen kører dagligt, brugerens valgte frekvens afgør dagen.
    if (!shouldSendUnbilledReminder(frequency, now)) continue;

    try {
      // Dedup: avoid re-sending the same reminder if the cron runs twice in a
      // day (redeploy / manual run). Kadencen styres af shouldSendUnbilledReminder.
      if (
        await wasEmailSentRecently(
          user.id,
          "unbilled_reminder",
          20 * 60 * 60 * 1000,
        )
      ) {
        continue;
      }

      const orgId = await getUserOrgId(user.id);

      // Ufaktureret tid — ÉN definition, delt med dashboard, rapporter og
      // det offentlige API (#626). Se src/lib/invoicing/unbilled.ts.
      const unbilledByClientAll = await loadUnbilledByClient(db, {
        userId: user.id,
        orgId,
        onlyOwnEntries: true,
      });

      // Skip if no unbilled entries
      if (unbilledByClientAll.length === 0) continue;

      const totalUnbilledHours = unbilledByClientAll.reduce(
        (sum, c) => sum + c.hours,
        0,
      );
      const totalUnbilledValue = unbilledByClientAll.reduce(
        (sum, c) => sum + c.value,
        0,
      );

      // Skip if total value is very low (less than 100 DKK)
      if (totalUnbilledValue < 100) continue;

      const unbilledByClient = unbilledByClientAll
        .filter((c) => c.value > 0)
        .slice(0, 5)
        .map((c) => ({ name: c.clientName, hours: c.hours, value: c.value }));

      // Send email
      await sendUnbilledReminderEmail({
        to: user.email,
        userName: user.name,
        totalUnbilledHours,
        totalUnbilledValue,
        unbilledByClient,
        userId: user.id,
        frequency,
      });

      // Send to Discord/Slack channels with unbilled reminders enabled
      const channels = await db
        .select()
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.userId, user.id),
            eq(notificationChannels.isEnabled, true),
            eq(notificationChannels.sendUnbilledReminders, true),
          ),
        );

      const locale = normalizeMailLocale(user.locale);
      const t = mailT("notifications", locale);
      const intl = toIntlLocale(locale);
      const h = Math.floor(totalUnbilledHours);
      const m = Math.round((totalUnbilledHours % 1) * 60);
      const hoursLabel =
        h > 0
          ? t("slack.durationHM", { h, m })
          : t("slack.minutesShort", { m });
      const valueLabel = Math.round(totalUnbilledValue).toLocaleString(intl);

      const clientList = unbilledByClient
        .map((c) =>
          t("slack.unbilledReminderLine", {
            name: c.name,
            hours: t("slack.hoursShort", {
              hours: c.hours.toLocaleString(intl, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }),
            }),
            value: Math.round(c.value).toLocaleString(intl),
          }),
        )
        .join("\n");

      for (const channel of decryptChannelWebhooks(channels)) {
        if (!isChannelActiveToday(channel, undefined, user.timezone)) continue;
        try {
          if (channel.channelType === "discord" && channel.discordWebhookUrl) {
            await sendDiscordMessage(channel.discordWebhookUrl, {
              embeds: [
                {
                  title: t("slack.unbilledReminderTitle", {
                    hours: hoursLabel,
                    value: valueLabel,
                  }),
                  description: t("slack.unbilledReminderDiscord", {
                    value: valueLabel,
                    list: clientList,
                  }),
                  color: 0xf59e0b,
                  footer: { text: t("slack.unbilledReminderFooter") },
                  timestamp: new Date().toISOString(),
                },
              ],
            });
          } else if (
            channel.channelType === "slack" &&
            channel.slackWebhookUrl
          ) {
            await sendSlackMessage(channel.slackWebhookUrl, {
              blocks: [
                {
                  type: "header",
                  text: {
                    type: "plain_text",
                    text: t("slack.unbilledReminderTitle", {
                      hours: hoursLabel,
                      value: valueLabel,
                    }),
                  },
                },
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: t("slack.unbilledReminderSlack", {
                      value: valueLabel,
                      list: clientList,
                    }),
                  },
                },
              ],
            });
          }
        } catch (channelError) {
          console.error(
            `Failed to send unbilled reminder to ${channel.channelType}:`,
            channelError,
          );
        }
      }

      sentCount++;
    } catch (error) {
      console.error(
        `Failed to send unbilled reminder for user ${user.id}:`,
        error,
      );
      errors.push(`User ${user.id}: ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/unbilled-reminder",
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
