import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { getAppUrl } from "@/lib/config";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { members, sentEmails, subscriptions, users } from "@/lib/db/schema";
import { sendPaymentReminderEmail } from "@/lib/email/billing";
import { notStoreManaged } from "@/lib/store-billing/persist";
import { captureRouteError } from "@/lib/utils/sentry";

/**
 * Dunning cron job — sends payment reminders for past_due subscriptions
 * Day 3: warning email (amber)
 * Day 7: urgent email (red, "last warning")
 *
 * Schedule: Daily at 10:00 AM (configured externally)
 */
export const GET = withCronLogging("dunning", async (_request) => {
  // Uden betalingsudbyder (selvhost) findes ingen planer eller prøveperioder
  if (!isBillingEnabled()) {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      metadata: { skipped: "billing-disabled" },
    };
  }

  console.warn("[Dunning] Starting dunning job...");

  // Find all past_due subscriptions with pastDueSince set
  const pastDueSubs = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.status, "past_due"),
      isNotNull(subscriptions.pastDueSince),
      // Butikken (App Store/Google Play) rykker selv for betaling.
      notStoreManaged(),
    ),
  });

  if (pastDueSubs.length === 0) {
    console.warn("[Dunning] No past_due subscriptions found");
    return { itemsProcessed: 0, itemsSucceeded: 0 };
  }

  const appUrl = getAppUrl();
  let sent = 0;
  let failed = 0;

  for (const sub of pastDueSubs) {
    if (!sub.pastDueSince) continue;

    const daysSincePastDue = Math.floor(
      (Date.now() - sub.pastDueSince.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Determine which reminder to send
    let urgency: "warning" | "urgent" | null = null;
    if (daysSincePastDue >= 7) {
      urgency = "urgent";
    } else if (daysSincePastDue >= 3) {
      urgency = "warning";
    } else {
      continue; // Too early for a reminder
    }

    const billingPortalUrl = `${appUrl}/dashboard/settings/subscription`;

    // Resolve recipients: for an org subscription, notify the current
    // owner + admins (so a transferred/departed owner doesn't mean nobody
    // hears about it); otherwise the personal subscription's user.
    let recipients: Array<{
      userId: string;
      email: string;
      name: string | null;
    }> = [];
    if (sub.organizationId) {
      const adminMembers = await db.query.members.findMany({
        where: and(
          eq(members.organizationId, sub.organizationId),
          or(eq(members.role, "owner"), eq(members.role, "admin")),
        ),
        with: { user: { columns: { id: true, email: true, name: true } } },
      });
      recipients = adminMembers
        .filter((m) => m.user?.email)
        .map((m) => ({
          userId: m.user.id,
          email: m.user.email,
          name: m.user.name,
        }));
    }
    if (recipients.length === 0) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, sub.userId),
        columns: { id: true, email: true, name: true },
      });
      if (user?.email) {
        recipients = [{ userId: user.id, email: user.email, name: user.name }];
      }
    }

    // Collapse any duplicate member rows for the same user so nobody is
    // emailed twice within a single run.
    recipients = Array.from(
      new Map(recipients.map((r) => [r.userId, r])).values(),
    );

    // Dedup in one query: which recipients already got THIS urgency level
    // since pastDueSince (avoids a per-recipient query in the loop). Keyed on
    // emailType, which is locale-independent; the subject is localized per
    // recipient, so matching on Danish subject text never matched en/de/es/cs
    // recipients and they were reminded every day (#1108).
    const typedEmailType =
      urgency === "urgent" ? "dunning_urgent" : "dunning_warning";
    // Overgang: rækker sendt før typeopdelingen har typen "dunning_reminder"
    // og kan kun skelnes på det danske emne. Klausulen kan fjernes, når alle
    // pastDueSince-vinduer er yngre end udrulningen.
    const legacySubjectPattern =
      urgency === "urgent" ? "Sidste advarsel%" : "Påmindelse%";
    const sentRows = recipients.length
      ? await db.query.sentEmails.findMany({
          where: and(
            inArray(
              sentEmails.userId,
              recipients.map((r) => r.userId),
            ),
            // gt() serialiserer via kolonnen; et rå Date i sql`` afvises af
            // postgres-js (drizzle slår dato-serializeren fra).
            gt(sentEmails.sentAt, sub.pastDueSince),
            or(
              eq(sentEmails.emailType, typedEmailType),
              and(
                eq(sentEmails.emailType, "dunning_reminder"),
                sql`${sentEmails.subject} LIKE ${legacySubjectPattern}`,
              ),
            ),
          ),
          columns: { userId: true },
        })
      : [];
    const alreadySentIds = new Set(sentRows.map((r) => r.userId));

    for (const recipient of recipients) {
      if (alreadySentIds.has(recipient.userId)) continue;

      try {
        await sendPaymentReminderEmail({
          to: recipient.email,
          userName: recipient.name || "bruger",
          urgency,
          daysOverdue: daysSincePastDue,
          billingPortalUrl,
          userId: recipient.userId,
        });
        sent++;
        console.warn(
          `[Dunning] Sent ${urgency} reminder to ${recipient.email} (${daysSincePastDue} days overdue)`,
        );
      } catch (err) {
        failed++;
        console.error(
          `[Dunning] Failed to send reminder to ${recipient.email}:`,
          err,
        );
      }
    }
  }

  console.warn(`[Dunning] Completed: sent ${sent} reminders`);

  if (failed > 0) {
    captureRouteError(new Error(`${failed} dunning emails failed`), {
      route: "/api/cron/dunning",
      type: "cron",
    });
  }

  return {
    itemsProcessed: pastDueSubs.length,
    itemsSucceeded: sent,
    itemsFailed: failed,
    metadata: { pastDueCount: pastDueSubs.length },
  };
});
