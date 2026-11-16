import { and, eq, gte, lte, or, sql } from "drizzle-orm";
import { createElement } from "react";
import { EndOfDayEmail } from "@/components/email/EndOfDayEmail";
import { toIntlLocale } from "@/i18n/format-locale";
import { getAppUrl } from "@/lib/config";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  emailPreferences,
  notificationChannels,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { mailT, normalizeMailLocale } from "@/lib/email/locale";
import { wasEmailSentRecently, withEmailLogging } from "@/lib/email/logger";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { renderEmail } from "@/lib/email/render-email";
import { buildUnsubscribeHeaders } from "@/lib/email/unsubscribe";
import {
  sendDiscordMessage,
  sendSlackMessage,
} from "@/lib/integrations/notifications";
import { isChannelActiveToday } from "@/lib/notifications";
import {
  type PushSubscription as PushSub,
  sendPushNotification,
} from "@/lib/notifications/push";
import { decryptChannelWebhooks } from "@/lib/notifications/webhook-secrets";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: */15 * * * * (Every 15 minutes, checks user's endOfDayTime)

export const GET = withCronLogging("end-of-day", async (_request) => {
  const now = new Date();

  // Kun brugere med dagsoversigt slået til (mail eller en aktiv kanal) og kun
  // de kolonner, løkken bruger — cronen kører hvert 15. minut og hentede før
  // hele user-rækken for alle brugere (#1115). Tidsvinduet afhænger af
  // brugerens tidszone og afgøres stadig nedenfor.
  const usersWithPrefs = await db
    .select({
      user: {
        id: users.id,
        email: users.email,
        timezone: users.timezone,
        locale: users.locale,
        brand: users.brand,
      },
      prefs: {
        endOfDayEnabled: emailPreferences.endOfDayEnabled,
        endOfDayTime: emailPreferences.endOfDayTime,
        quietHoursEnabled: emailPreferences.quietHoursEnabled,
        quietHoursStart: emailPreferences.quietHoursStart,
        quietHoursEnd: emailPreferences.quietHoursEnd,
      },
    })
    .from(users)
    .leftJoin(emailPreferences, eq(users.id, emailPreferences.userId))
    .where(
      or(
        eq(emailPreferences.endOfDayEnabled, true),
        sql`exists (select 1 from ${notificationChannels} where ${notificationChannels.userId} = ${users.id} and ${notificationChannels.isEnabled} = true and ${notificationChannels.sendEndOfDay} = true)`,
      ),
    );

  let sentCount = 0;
  const errors: string[] = [];

  for (const { user, prefs } of usersWithPrefs) {
    // Resolve current time AND date in the user's timezone so "17:00"
    // is always the user's local 17:00 and "today's entries" is the
    // user's local day, regardless of server timezone.
    const tz = user.timezone || "Europe/Copenhagen";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const partValue = (t: string) =>
      parts.find((p) => p.type === t)?.value ?? "0";
    const curH = Number(partValue("hour"));
    const curM = Number(partValue("minute"));
    const currentMinutes = curH * 60 + curM;
    const currentTime = `${curH.toString().padStart(2, "0")}:${curM.toString().padStart(2, "0")}`;
    const userTodayStr = `${partValue("year")}-${partValue("month")}-${partValue("day")}`;

    // Determine end-of-day time from email preferences (default 17:00)
    const endOfDayTime = prefs?.endOfDayTime || "17:00";
    const [hours, mins] = endOfDayTime.split(":").map(Number);
    const userMinutes = hours * 60 + mins;

    // Only send if within the 15-minute window
    if (currentMinutes < userMinutes || currentMinutes >= userMinutes + 15) {
      continue;
    }

    // Check quiet hours (in user's timezone)
    if (prefs?.quietHoursEnabled) {
      const quietStart = prefs.quietHoursStart || "22:00";
      const quietEnd = prefs.quietHoursEnd || "08:00";
      if (isInQuietHours(currentTime, quietStart, quietEnd)) continue;
    }

    // Check if user has any end-of-day channel OR email enabled
    const hasEmailEnabled = prefs?.endOfDayEnabled === true;

    // Get Discord/Slack/push channels with end-of-day enabled
    const channels = await db
      .select()
      .from(notificationChannels)
      .where(
        and(
          eq(notificationChannels.userId, user.id),
          eq(notificationChannels.isEnabled, true),
          eq(notificationChannels.sendEndOfDay, true),
        ),
      );

    // Skip user if neither email nor any channel is enabled
    if (!hasEmailEnabled && channels.length === 0) continue;

    try {
      // Per-user cron: filters by userId (personal digest), orgId added for index efficiency
      const orgId = await getUserOrgId(user.id);

      // Get today's time entries — "today" is the user's local date.
      const todayEntries = await db
        .select({
          hours: timeEntries.hours,
          billableRate: timeEntries.billableRate,
          isBilled: timeEntries.isBilled,
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, user.id),
            ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
            gte(timeEntries.date, new Date(`${userTodayStr}T00:00:00`)),
            lte(timeEntries.date, new Date(`${userTodayStr}T23:59:59`)),
          ),
        );

      const totalHours = todayEntries.reduce(
        (sum, e) => sum + parseFloat(e.hours || "0"),
        0,
      );
      const unbilledHours = todayEntries
        .filter((e) => !e.isBilled)
        .reduce((sum, e) => sum + parseFloat(e.hours || "0"), 0);
      const estimatedRevenue = todayEntries.reduce(
        (sum, e) =>
          sum + parseFloat(e.hours || "0") * parseFloat(e.billableRate || "0"),
        0,
      );

      const locale = normalizeMailLocale(user.locale);
      const mb = await resolveMailBrand({ brand: user.brand });
      const t = mailT("notifications", locale, mb?.key);
      const hoursLabel = formatHoursMinutes(totalHours, locale);

      const title =
        totalHours > 0
          ? t("endOfDay.titleTracked", { hours: hoursLabel })
          : t("endOfDay.titleNone");

      const body =
        totalHours > 0
          ? [
              t("endOfDay.bodyTracked", { hours: hoursLabel }),
              unbilledHours > 0
                ? t("endOfDay.bodyUnbilled", {
                    hours: formatHoursMinutes(unbilledHours, locale),
                  })
                : "",
              estimatedRevenue > 0
                ? t("endOfDay.bodyRevenue", {
                    amount: Math.round(estimatedRevenue).toLocaleString(
                      toIntlLocale(locale),
                    ),
                  })
                : "",
            ]
              .filter(Boolean)
              .join(" ")
          : t("endOfDay.bodyNone");

      // Send to all configured channels
      for (const channel of decryptChannelWebhooks(channels)) {
        if (!isChannelActiveToday(channel, now, tz)) continue;
        try {
          if (
            channel.channelType === "browser_push" &&
            channel.pushSubscription
          ) {
            await sendPushNotification({
              subscription: channel.pushSubscription as unknown as PushSub,
              title,
              body,
              url: "/dashboard/time",
              tag: "end-of-day",
              locale,
            });
          } else if (
            channel.channelType === "discord" &&
            channel.discordWebhookUrl
          ) {
            await sendDiscordMessage(channel.discordWebhookUrl, {
              embeds: [
                {
                  title: `📊 ${title}`,
                  description: body,
                  color: totalHours > 0 ? 0x22c55e : 0xf59e0b,
                  footer: { text: t("endOfDay.footer") },
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
                    text: `📊 ${title}`,
                  },
                },
                {
                  type: "section",
                  text: { type: "mrkdwn", text: body },
                },
              ],
            });
          }
        } catch (channelError) {
          console.error(
            `Failed to send end-of-day to ${channel.channelType}:`,
            channelError,
          );
        }
      }

      // Send email notification if user has email and email is enabled.
      // Wrapped in withEmailLogging for tracking + bounce suppression, and
      // deduped so a redeploy inside the 15-minute window can't double-send.
      if (hasEmailEnabled && user.email) {
        const alreadySent = await wasEmailSentRecently(
          user.id,
          "end_of_day",
          20 * 60 * 60 * 1000,
        );
        if (!alreadySent) {
          const { resend: resendClient, DEFAULT_FROM_EMAIL: fromEmail } =
            await import("@/lib/resend");
          const appUrl = mb?.appUrl ?? getAppUrl();
          await withEmailLogging(
            {
              emailType: "end_of_day",
              to: user.email,
              subject: title,
              userId: user.id,
            },
            async () =>
              resendClient.emails.send({
                from: mb?.from ?? fromEmail,
                to: user.email,
                subject: title,
                ...(await renderEmail(
                  createElement(EndOfDayEmail, {
                    title,
                    body,
                    timeUrl: `${appUrl}/dashboard/time`,
                    locale,
                    mailBrand: mb,
                  }),
                )),
                headers: buildUnsubscribeHeaders(user.id, mb?.appUrl),
              }),
            { userId: user.id, emailType: "end_of_day" },
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
      route: "/api/cron/end-of-day",
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

/** "2 t 15 min" (BRAND.md → Tal, priser og tid). */
function formatHoursMinutes(hours: number, locale: string): string {
  const t = mailT("notifications", locale);
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return t("duration.m", { m });
  return m === 0 ? t("duration.h", { h }) : t("duration.hm", { h, m });
}

function isInQuietHours(current: string, start: string, end: string): boolean {
  // Convert to minutes for comparison
  const toMins = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const c = toMins(current);
  const s = toMins(start);
  const e = toMins(end);

  // Handle overnight quiet hours (e.g., 22:00 - 08:00)
  if (s > e) {
    return c >= s || c < e;
  }
  return c >= s && c < e;
}
