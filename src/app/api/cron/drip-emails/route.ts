import { and, eq, like, sql } from "drizzle-orm";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  clients,
  emailPreferences,
  invoices,
  members,
  prepaidPackages,
  projects,
  sentEmails,
  sessions,
  subscriptions,
  tasks,
  timeEntries,
  users,
} from "@/lib/db/schema";
import {
  sendDripAiFeaturesEmail,
  sendDripClientNoKlippekortEmail,
  sendDripExtensionTipsEmail,
  sendDripFirstWeekStatsEmail,
  sendDripGettingStartedEmail,
  sendDripKlippekortTipsEmail,
  sendDripNeedHelpEmail,
  sendDripNoTimeEntryEmail,
  sendDripTimeNoInvoiceEmail,
  sendDripUpgradeReminderEmail,
  sendDripWinBack30Email,
  sendDripWinBack60Email,
} from "@/lib/email/drip";
import type { EmailType } from "@/lib/email/logger";
import { isTestEmailRecipient } from "@/lib/email/test-recipient";
import {
  ACTIVATION_DRIP_MAX_AGE_DAYS,
  DRIP_COOLDOWN_HOURS,
  isWithinDripSendWindow,
  pickActivationDrip,
  shouldSendKlippekortTips,
} from "@/lib/onboarding/activation";
import { isStoreManaged } from "@/lib/store-billing/state";
import { isTestAccountEmail } from "@/lib/test-accounts";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 0 9 * * * (Daily at 09:00)

export const GET = withCronLogging("drip-emails", async (_request) => {
  // Uden betalingsudbyder (selvhost) findes ingen planer eller prøveperioder:
  // opgraderings- og win-back-mails springes over, aktiveringsmails sendes
  const billingEnabled = isBillingEnabled();

  const now = new Date();

  // Aldrig mails om natten — heller ikke ved manuel/forsinket kørsel (#91)
  if (!isWithinDripSendWindow(now)) {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      itemsFailed: 0,
      metadata: { skipped: "outside_send_window" },
    };
  }

  // Get all users with their preferences
  const usersWithPrefs = await db
    .select({
      user: users,
      prefs: emailPreferences,
    })
    .from(users)
    .leftJoin(emailPreferences, eq(users.id, emailPreferences.userId));

  let sentCount = 0;
  const errors: string[] = [];

  for (const { user, prefs } of usersWithPrefs) {
    // Skip if user has disabled drip emails
    if (prefs && prefs.dripEmails === false) continue;

    // Skip unverified emails
    if (!user.emailVerified || isTestAccountEmail(user.email)) continue;

    // Drip-mailene følger kontoens brand (afsenderne slår users.brand op),
    // så TimeWren-konti får TimeWren-udgaven.

    try {
      const orgId = await getUserOrgId(user.id);
      const isTestWorkspace = await isTestEmailRecipient(
        user.email,
        user.id,
        orgId,
      );
      if (isTestWorkspace && !billingEnabled) continue;

      const daysSinceSignup = Math.floor(
        (now.getTime() - new Date(user.createdAt).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      // Get all drip emails already sent to this user
      const sentDripEmails = await db
        .select({ emailType: sentEmails.emailType, sentAt: sentEmails.sentAt })
        .from(sentEmails)
        .where(
          and(
            eq(sentEmails.userId, user.id),
            like(sentEmails.emailType, "drip_%"),
          ),
        );

      const sentTypes = new Set(sentDripEmails.map((e) => e.emailType));

      // Helper to check if an email type was already sent
      const alreadySent = (type: EmailType) => sentTypes.has(type);

      // Get last activity date
      const lastActivity = isTestWorkspace
        ? null
        : await getLastActivityDate(user.id, orgId);
      const daysSinceLastActivity = lastActivity
        ? Math.floor(
            (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24),
          )
        : null;

      const isActive =
        daysSinceLastActivity !== null && daysSinceLastActivity < 14;

      // Priority-ordered evaluation — max ONE email per user per day
      // 1. Win-back 60d
      if (
        billingEnabled &&
        daysSinceLastActivity !== null &&
        daysSinceLastActivity >= 60 &&
        !alreadySent("drip_win_back_60")
      ) {
        await sendDripWinBack60Email({
          to: user.email,
          userName: user.name,
          userId: user.id,
        });
        sentCount++;
        continue;
      }

      // 2. Win-back 30d
      if (
        billingEnabled &&
        daysSinceLastActivity !== null &&
        daysSinceLastActivity >= 30 &&
        !alreadySent("drip_win_back_30")
      ) {
        const { unbilledHours, unbilledValue, pendingTasks } =
          await getUserActivityData(user.id, orgId);
        await sendDripWinBack30Email({
          to: user.email,
          userName: user.name,
          userId: user.id,
          unbilledHours: unbilledHours > 0 ? unbilledHours : undefined,
          unbilledValue: unbilledValue > 0 ? unbilledValue : undefined,
          pendingTasks: pendingTasks > 0 ? pendingTasks : undefined,
        });
        sentCount++;
        continue;
      }

      // 3. Upgrade reminder (trial expires within 5 days)
      if (billingEnabled && !alreadySent("drip_upgrade_reminder")) {
        const sub = await db.query.subscriptions.findFirst({
          where: eq(subscriptions.userId, user.id),
        });
        // Betalt i appen: ingen opgraderingsmail med web-links.
        if (sub?.isTrial && sub.trialEndsAt && !isStoreManaged(sub)) {
          const daysLeft = Math.floor(
            (new Date(sub.trialEndsAt).getTime() - now.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          if (
            daysLeft >= 0 &&
            daysLeft <= 5 &&
            !(await isTestEmailRecipient(
              user.email,
              user.id,
              sub.organizationId ?? orgId,
            ))
          ) {
            await sendDripUpgradeReminderEmail({
              to: user.email,
              userName: user.name,
              userId: user.id,
              daysLeft,
            });
            sentCount++;
            continue;
          }
        }
      }

      if (isTestWorkspace) continue;

      // Højst én drip-mail pr. 48 timer, så aktiveringsmails og den faste
      // sekvens ikke lander dag efter dag (#91). Win-back og den tidskritiske
      // betalingspåmindelse ovenfor er undtaget.
      const cooldownStart = now.getTime() - DRIP_COOLDOWN_HOURS * 3_600_000;
      if (
        sentDripEmails.some((e) => new Date(e.sentAt).getTime() > cooldownStart)
      ) {
        continue;
      }

      // 3b. Aktivering (#91/#175): adfærdstriggede mails til nye brugere
      if (daysSinceSignup <= ACTIVATION_DRIP_MAX_AGE_DAYS) {
        const dripType = pickActivationDrip(
          await getActivationDripInput(
            user.id,
            orgId,
            user.createdAt,
            now,
            sentTypes,
          ),
        );
        if (dripType) {
          const params = {
            to: user.email,
            userName: user.name,
            userId: user.id,
          };
          if (dripType === "drip_no_time_48h") {
            await sendDripNoTimeEntryEmail(params);
          } else if (dripType === "drip_time_no_invoice") {
            const { unbilledHours } = await getUserActivityData(user.id, orgId);
            await sendDripTimeNoInvoiceEmail({ ...params, unbilledHours });
          } else {
            await sendDripClientNoKlippekortEmail(params);
          }
          sentCount++;
          continue;
        }
      }

      // 4. Klippekort tips (30+ dage, aktiv). Klippekort er med på alle planer.
      const tipsInput = {
        canManageBilling: true,
        daysSinceSignup,
        isActive,
        sent: sentTypes,
      };
      if (shouldSendKlippekortTips(tipsInput)) {
        await sendDripKlippekortTipsEmail({
          to: user.email,
          userName: user.name,
          userId: user.id,
        });
        sentCount++;
        continue;
      }

      // 5. First week stats (day 21+, active)
      if (
        daysSinceSignup >= 21 &&
        isActive &&
        !alreadySent("drip_first_week_stats")
      ) {
        const { totalHours, clientCount, projectCount } = await getUserStats(
          user.id,
          orgId,
        );
        await sendDripFirstWeekStatsEmail({
          to: user.email,
          userName: user.name,
          userId: user.id,
          totalHoursTracked: totalHours,
          clientCount,
          projectCount,
        });
        sentCount++;
        continue;
      }

      // 6. AI features (day 14+, active)
      if (
        daysSinceSignup >= 14 &&
        isActive &&
        !alreadySent("drip_ai_features")
      ) {
        await sendDripAiFeaturesEmail({
          to: user.email,
          userName: user.name,
          userId: user.id,
        });
        sentCount++;
        continue;
      }

      // 7. Extension tips (day 10+, active)
      if (
        daysSinceSignup >= 10 &&
        isActive &&
        !alreadySent("drip_extension_tips")
      ) {
        await sendDripExtensionTipsEmail({
          to: user.email,
          userName: user.name,
          userId: user.id,
        });
        sentCount++;
        continue;
      }

      // 8. Need help (day 7+)
      if (daysSinceSignup >= 7 && !alreadySent("drip_need_help")) {
        const hasEntries = await db
          .select({ id: timeEntries.id })
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.userId, user.id),
              ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
            ),
          )
          .limit(1);
        await sendDripNeedHelpEmail({
          to: user.email,
          userName: user.name,
          userId: user.id,
          hasTimeEntries: hasEntries.length > 0,
        });
        sentCount++;
        continue;
      }

      // 9. Getting started (day 3+)
      if (daysSinceSignup >= 3 && !alreadySent("drip_getting_started")) {
        const hasClient = await db
          .select({ id: clients.id })
          .from(clients)
          .where(
            and(
              eq(clients.userId, user.id),
              ...(orgId ? [eq(clients.organizationId, orgId)] : []),
            ),
          )
          .limit(1);
        await sendDripGettingStartedEmail({
          to: user.email,
          userName: user.name,
          userId: user.id,
          hasClient: hasClient.length > 0,
        });
        sentCount++;
      }
    } catch {
      console.error("[drip-emails] Failed to process a recipient");
      errors.push("Failed to process a recipient");
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/drip-emails",
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

// ============================================
// Helper functions
// ============================================

/**
 * Fakta til aktiveringsmails (#91). Kunde/klippekort/faktura er org-data og
 * kun relevante for ejere/admins — almindelige medlemmer kan kun få
 * "ingen tidspost"-mailen.
 */
async function getActivationDripInput(
  userId: string,
  orgId: string | null,
  createdAt: Date,
  now: Date,
  sent: ReadonlySet<string>,
) {
  const [firstEntry] = await db
    .select({ at: sql<Date | null>`min(${timeEntries.createdAt})` })
    .from(timeEntries)
    .where(eq(timeEntries.userId, userId));
  const firstEntryAt = firstEntry?.at ? new Date(firstEntry.at) : null;

  const base = {
    signupAt: new Date(createdAt),
    hoursSinceSignup:
      (now.getTime() - new Date(createdAt).getTime()) / 3_600_000,
    daysSinceFirstEntry: firstEntryAt
      ? (now.getTime() - firstEntryAt.getTime()) / 86_400_000
      : null,
    sent,
  };

  let canManage = true;
  if (orgId) {
    const membership = await db.query.members.findFirst({
      where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
      columns: { role: true },
    });
    canManage = membership?.role === "owner" || membership?.role === "admin";
  }
  if (!canManage) {
    return {
      ...base,
      hasClient: false,
      hasKlippekort: false,
      hasInvoice: false,
      unbilledHours: 0,
      canManageBilling: false,
    };
  }

  const [client, pkg, invoice] = await Promise.all([
    db
      .select({ id: clients.id })
      .from(clients)
      .where(
        orgId ? eq(clients.organizationId, orgId) : eq(clients.userId, userId),
      )
      .limit(1),
    db
      .select({ id: prepaidPackages.id })
      .from(prepaidPackages)
      .where(
        orgId
          ? eq(prepaidPackages.organizationId, orgId)
          : eq(prepaidPackages.userId, userId),
      )
      .limit(1),
    db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        orgId
          ? eq(invoices.organizationId, orgId)
          : eq(invoices.userId, userId),
      )
      .limit(1),
  ]);

  const { unbilledHours } = firstEntryAt
    ? await getUserActivityData(userId, orgId)
    : { unbilledHours: 0 };

  return {
    ...base,
    hasClient: client.length > 0,
    hasKlippekort: pkg.length > 0,
    hasInvoice: invoice.length > 0,
    unbilledHours,
    canManageBilling: true,
  };
}

async function getLastActivityDate(
  userId: string,
  orgId: string | null,
): Promise<Date | null> {
  const lastSession = await db
    .select({ createdAt: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sql`${sessions.createdAt} DESC`)
    .limit(1);

  const lastTimeEntry = await db
    .select({ createdAt: timeEntries.createdAt })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
      ),
    )
    .orderBy(sql`${timeEntries.createdAt} DESC`)
    .limit(1);

  const sessionDate = lastSession[0]?.createdAt;
  const entryDate = lastTimeEntry[0]?.createdAt;

  if (sessionDate && entryDate) {
    return sessionDate > entryDate ? sessionDate : entryDate;
  }
  return sessionDate || entryDate || null;
}

async function getUserActivityData(userId: string, orgId: string | null) {
  const unbilledEntries = await db
    .select({
      hours: timeEntries.hours,
      billableRate: timeEntries.billableRate,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
        eq(timeEntries.isBilled, false),
      ),
    );

  const unbilledHours = unbilledEntries.reduce(
    (sum, e) => sum + Number.parseFloat(e.hours || "0"),
    0,
  );
  const unbilledValue = unbilledEntries.reduce(
    (sum, e) =>
      sum +
      Number.parseFloat(e.hours || "0") *
        Number.parseFloat(e.billableRate || "0"),
    0,
  );

  const pendingTasksResult = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        ...(orgId ? [eq(tasks.organizationId, orgId)] : []),
        eq(tasks.status, "open"),
      ),
    );

  return {
    unbilledHours,
    unbilledValue,
    pendingTasks: pendingTasksResult.length,
  };
}

async function getUserStats(userId: string, orgId: string | null) {
  const hoursResult = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS NUMERIC)), 0)`,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
      ),
    );

  const clientCountResult = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(clients)
    .where(
      and(
        eq(clients.userId, userId),
        ...(orgId ? [eq(clients.organizationId, orgId)] : []),
      ),
    );

  const projectCountResult = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(projects)
    .where(
      and(
        eq(projects.userId, userId),
        ...(orgId ? [eq(projects.organizationId, orgId)] : []),
      ),
    );

  return {
    totalHours: Number.parseFloat(hoursResult[0]?.total || "0"),
    clientCount: Number.parseInt(clientCountResult[0]?.count || "0", 10),
    projectCount: Number.parseInt(projectCountResult[0]?.count || "0", 10),
  };
}
