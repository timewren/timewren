import { and, eq, gte, lte } from "drizzle-orm";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { getAppUrl } from "@/lib/config";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { emailDeliveryLogs, subscriptions, users } from "@/lib/db/schema";
import { sendTrialEndingEmail } from "@/lib/email/billing";
import { notStoreManaged } from "@/lib/store-billing/persist";

// Cron schedule: 0 9 * * * (every day at 09:00 Europe/Copenhagen)
//
// Sends a gentle upgrade email to users whose trial ends in ~7 days or
// ~1 day AND who haven't set up an Alunta subscription yet. These are
// the "floating" trials that would silently expire without any nudge,
// because Alunta only sends trial_ending webhooks for its own subs.
//
// Dedupe: each reminder cadence (7d / 1d) is its own templateType in
// email_delivery_logs so a user gets at most one of each across a trial.

interface ReminderWindow {
  templateKey: "trial_reminder_7d" | "trial_reminder_1d";
  minDaysBefore: number;
  maxDaysBefore: number;
}

const WINDOWS: ReminderWindow[] = [
  // 7-day reminder: trial ends in 6.5–7.5 days from now
  { templateKey: "trial_reminder_7d", minDaysBefore: 6.5, maxDaysBefore: 7.5 },
  // 1-day reminder: trial ends in 0.5–1.5 days from now
  { templateKey: "trial_reminder_1d", minDaysBefore: 0.5, maxDaysBefore: 1.5 },
];

export const GET = withCronLogging("trial-reminder", async (_request) => {
  // Uden betalingsudbyder (selvhost) findes ingen planer eller prøveperioder
  if (!isBillingEnabled()) {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      metadata: { skipped: "billing-disabled" },
    };
  }

  const appUrl = getAppUrl();
  const upgradeUrl = `${appUrl}/dashboard/settings/subscription`;

  let sent7d = 0;
  let sent1d = 0;
  let skippedAlreadySent = 0;
  let skippedHasAlunta = 0;
  let skippedDemo = 0;
  let failed = 0;

  const now = new Date();

  for (const window of WINDOWS) {
    const windowStart = new Date(now);
    windowStart.setTime(
      windowStart.getTime() + window.minDaysBefore * 24 * 60 * 60 * 1000,
    );
    const windowEnd = new Date(now);
    windowEnd.setTime(
      windowEnd.getTime() + window.maxDaysBefore * 24 * 60 * 60 * 1000,
    );

    // Pull trialing subs whose trial ends inside this window, with the
    // user joined for email + name + demo flag.
    const candidates = await db
      .select({
        subId: subscriptions.id,
        userId: subscriptions.userId,
        trialEndsAt: subscriptions.trialEndsAt,
        aluntaSubscriptionId: subscriptions.aluntaSubscriptionId,
        userName: users.name,
        userEmail: users.email,
        isDemo: users.isDemo,
      })
      .from(subscriptions)
      .leftJoin(users, eq(subscriptions.userId, users.id))
      .where(
        and(
          eq(subscriptions.status, "trialing"),
          gte(subscriptions.trialEndsAt, windowStart),
          lte(subscriptions.trialEndsAt, windowEnd),
          // Betalt i appen: ingen opgraderingsmail med web-links.
          notStoreManaged(),
        ),
      );

    for (const c of candidates) {
      // Skip demo accounts
      if (c.isDemo) {
        skippedDemo++;
        continue;
      }
      // Skip users who already have an Alunta subscription — Alunta
      // will send its own trial_ending email via webhook.
      if (c.aluntaSubscriptionId) {
        skippedHasAlunta++;
        continue;
      }
      if (!c.userEmail) continue;

      // Dedupe: have we already sent this exact template to this user
      // in the past 30 days?
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const existing = await db
        .select({ id: emailDeliveryLogs.id })
        .from(emailDeliveryLogs)
        .where(
          and(
            eq(emailDeliveryLogs.userId, c.userId),
            eq(emailDeliveryLogs.templateType, window.templateKey),
            gte(emailDeliveryLogs.sentAt, thirtyDaysAgo),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        skippedAlreadySent++;
        continue;
      }

      // Compute actual days remaining (capped at 1 minimum to avoid
      // "0 days" weirdness)
      const daysRemaining = c.trialEndsAt
        ? Math.max(
            1,
            Math.ceil(
              (c.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
        : 1;

      try {
        await sendTrialEndingEmail({
          to: c.userEmail,
          userName: c.userName || "bruger",
          daysRemaining,
          upgradeUrl,
          userId: c.userId,
          templateKey: window.templateKey,
        });
        if (window.templateKey === "trial_reminder_7d") sent7d++;
        else sent1d++;
      } catch (err) {
        console.error(
          `[trial-reminder] Failed to send ${window.templateKey} to ${c.userEmail}:`,
          err,
        );
        failed++;
      }
    }
  }

  const totalSent = sent7d + sent1d;

  return {
    itemsProcessed:
      totalSent + skippedAlreadySent + skippedHasAlunta + skippedDemo + failed,
    itemsSucceeded: totalSent,
    itemsFailed: failed,
    metadata: {
      sent_7d: sent7d,
      sent_1d: sent1d,
      skipped_already_sent: skippedAlreadySent,
      skipped_has_alunta: skippedHasAlunta,
      skipped_demo: skippedDemo,
    },
  };
});
