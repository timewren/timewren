import { and, count, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { getAppUrl, monthlyListPriceForSubscription } from "@/lib/config";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  adminSettings,
  emailDeliveryLogs,
  subscriptions,
  supportTickets,
  users,
  webhookEvents,
} from "@/lib/db/schema";
import {
  type AdminDigestStats,
  sendAdminDigest,
} from "@/lib/email/admin-digest";
import { countPrepaidIntegrityOrphans } from "@/lib/prepaid/integrity";
import { excludeTestOrganization, excludeTestUsers } from "@/lib/test-accounts";

// Cron schedule: 0 8 * * 1 (Every Monday at 08:00)
// Sends a weekly admin briefing email to all admin users + any extra
// addresses configured in admin_settings.notification_email.

export const GET = withCronLogging("admin-digest", async (_request) => {
  // Uden betalingsudbyder (selvhost) sendes driftstallene (tilmeldinger,
  // mailfejl, webhook-fejl, flaggede brugere, tickets), men abonnements-, MRR-,
  // forfaldne- og prøvetal udelades og slås ikke op (#1014).
  const billingEnabled = isBillingEnabled();

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const previousWeekStart = new Date(weekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);

  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(now.getDate() + 7);

  const realUsers = excludeTestUsers();
  const realOrgs = excludeTestOrganization(subscriptions.organizationId);

  // Fetch metrics in parallel
  const [
    newSignups,
    newSignupRows,
    activeSubs,
    _trialsEndingSoon,
    pastDueSubs,
    paymentFailures,
    webhookErrors,
    flaggedUsers,
    openTickets,
    previousMrrEvents,
    prepaidIntegrityOrphans,
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(users)
      .where(and(gte(users.createdAt, weekStart), realUsers)),
    db
      .select({
        name: users.name,
        email: users.email,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(gte(users.createdAt, weekStart), realUsers))
      .orderBy(desc(users.createdAt))
      .limit(15),
    billingEnabled
      ? db
          .select({ count: count() })
          .from(subscriptions)
          .innerJoin(users, eq(subscriptions.userId, users.id))
          .where(and(eq(subscriptions.status, "active"), realUsers, realOrgs))
      : Promise.resolve([{ count: 0 }]),
    billingEnabled
      ? db
          .select({ count: count() })
          .from(subscriptions)
          .innerJoin(users, eq(subscriptions.userId, users.id))
          .where(
            and(
              eq(subscriptions.status, "trialing"),
              isNotNull(subscriptions.trialEndsAt),
              realUsers,
              realOrgs,
            ),
          )
      : Promise.resolve([{ count: 0 }]),
    billingEnabled
      ? db
          .select({ count: count() })
          .from(subscriptions)
          .innerJoin(users, eq(subscriptions.userId, users.id))
          .where(and(eq(subscriptions.status, "past_due"), realUsers, realOrgs))
      : Promise.resolve([{ count: 0 }]),
    db
      .select({ count: count() })
      .from(emailDeliveryLogs)
      .where(
        and(
          inArray(emailDeliveryLogs.status, ["bounced", "failed"]),
          gte(emailDeliveryLogs.sentAt, weekStart),
        ),
      ),
    db
      .select({ count: count() })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.status, "error"),
          gte(webhookEvents.createdAt, weekStart),
        ),
      ),
    db.select({ count: count() }).from(users).where(eq(users.isFlagged, true)),
    db
      .select({ count: count() })
      .from(supportTickets)
      .where(eq(supportTickets.status, "open")),
    // Placeholder — we don't have a stable historic MRR snapshot, so MoM
    // is computed from new signups proxy.
    db
      .select({ count: count() })
      .from(users)
      .where(and(gte(users.createdAt, previousWeekStart), realUsers)),
    countPrepaidIntegrityOrphans(),
  ]);

  let mrrActual = 0;
  let trialsEndingSoonCount = 0;
  if (billingEnabled) {
    // Real MRR: walk all active subscriptions and apply correct price per
    // billing cycle + discount (yearly = price/12). Matches finance.ts.
    const activeSubsFull = await db
      .select({
        userId: subscriptions.userId,
        billingCycle: subscriptions.billingCycle,
        discountPercent: subscriptions.discountPercent,
        planTier: subscriptions.planTier,
        seatCount: subscriptions.seatCount,
        aluntaPlanId: subscriptions.aluntaPlanId,
      })
      .from(subscriptions)
      .innerJoin(users, eq(subscriptions.userId, users.id))
      .where(and(eq(subscriptions.status, "active"), realUsers, realOrgs));

    // Filter trialsEndingSoon properly in JS (cleaner than complex SQL with
    // multiple gte/lte on same column)
    const trialingRows = await db
      .select({
        id: subscriptions.id,
        trialEndsAt: subscriptions.trialEndsAt,
      })
      .from(subscriptions)
      .innerJoin(users, eq(subscriptions.userId, users.id))
      .where(and(eq(subscriptions.status, "trialing"), realUsers, realOrgs));
    trialsEndingSoonCount = trialingRows.filter(
      (r) =>
        r.trialEndsAt &&
        r.trialEndsAt.getTime() >= now.getTime() &&
        r.trialEndsAt.getTime() <= sevenDaysFromNow.getTime(),
    ).length;

    // Real MRR calculation — excludes demo users (kunde C seed etc.) and uses
    // the correct yearly/12 + discount formula matching finance.ts.
    const demoIds = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isDemo, true));
    const demoSet = new Set(demoIds.map((d) => d.id));
    const realActiveSubs = activeSubsFull.filter((s) => !demoSet.has(s.userId));
    for (const sub of realActiveSubs) {
      // Tier-, plads- og prisliste-bevidst (legacy-kunder tæller med gammel
      // pris) — samme formel som admin/finance.
      const base = monthlyListPriceForSubscription(sub);
      const discount = sub.discountPercent ?? 0;
      mrrActual += base * (1 - discount / 100);
    }
    mrrActual = Math.round(mrrActual);
  }
  const previousSignupCount = Number(previousMrrEvents[0]?.count ?? 0);
  const currentSignupCount = Number(newSignups[0]?.count ?? 0);
  const mrrChangePercent =
    previousSignupCount > 0
      ? ((currentSignupCount - previousSignupCount) / previousSignupCount) * 100
      : currentSignupCount > 0
        ? 100
        : null;

  const stats: AdminDigestStats = {
    newSignups: currentSignupCount,
    newSignupsLabels: newSignupRows,
    activeSubscriptions: Number(activeSubs[0]?.count ?? 0),
    trialsEndingSoon: trialsEndingSoonCount,
    pastDuePayments: Number(pastDueSubs[0]?.count ?? 0),
    paymentFailures: Number(paymentFailures[0]?.count ?? 0),
    webhookErrors: Number(webhookErrors[0]?.count ?? 0),
    flaggedUsers: Number(flaggedUsers[0]?.count ?? 0),
    openTickets: Number(openTickets[0]?.count ?? 0),
    prepaidIntegrityOrphans,
    mrrActual,
    mrrChangePercent,
    billingEnabled,
    weekRange: { start: weekStart, end: now },
  };

  // Resolve recipients: admin users + extra addresses from admin_settings
  const adminUsers = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.role, "admin"));

  const extraSetting = await db.query.adminSettings.findFirst({
    where: eq(adminSettings.id, "notification_email"),
  });
  const extraAddresses = (extraSetting?.value ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  const recipients = Array.from(
    new Set([...adminUsers.map((u) => u.email), ...extraAddresses]),
  );

  if (recipients.length === 0) {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      metadata: { skipped: "no recipients configured" },
    };
  }

  const appUrl = getAppUrl();
  await sendAdminDigest({ to: recipients, stats, appUrl });

  return {
    itemsProcessed: recipients.length,
    itemsSucceeded: recipients.length,
    metadata: {
      newSignups: stats.newSignups,
      activeSubscriptions: stats.activeSubscriptions,
      trialsEndingSoon: stats.trialsEndingSoon,
      webhookErrors: stats.webhookErrors,
    },
  };
});
