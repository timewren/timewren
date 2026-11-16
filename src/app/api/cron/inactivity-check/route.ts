import { and, desc, eq, ne } from "drizzle-orm";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  emailPreferences,
  sessions,
  tasks,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { sendInactivityEmail } from "@/lib/email/engagement";
import { wasEmailSentRecently } from "@/lib/email/logger";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 0 10 * * * (Daily at 10:00)

// Days of inactivity before sending reminder
const INACTIVITY_THRESHOLD_DAYS = 14;

export const GET = withCronLogging("inactivity-check", async (_request) => {
  const now = new Date();
  const thresholdDate = new Date(now);
  thresholdDate.setDate(now.getDate() - INACTIVITY_THRESHOLD_DAYS);

  // Get all users who want inactivity reminders
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
    // Skip if user has no email or has disabled inactivity reminders
    if (!user.email) continue;
    if (prefs && prefs.inactivityReminder === false) continue;

    try {
      const orgId = await getUserOrgId(user.id);

      // Skip if we sent an inactivity email within the last 7 days. Use the
      // tracked timestamp when available, and fall back to the sent_emails log
      // so users WITHOUT a prefs row are still protected from repeats.
      if (prefs?.lastInactivityEmailSentAt) {
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 7);
        if (prefs.lastInactivityEmailSentAt >= sevenDaysAgo) continue;
      } else if (
        await wasEmailSentRecently(
          user.id,
          "inactivity",
          7 * 24 * 60 * 60 * 1000,
        )
      ) {
        continue;
      }

      // Check last session activity (most recent first)
      const lastSession = await db
        .select({ createdAt: sessions.createdAt })
        .from(sessions)
        .where(eq(sessions.userId, user.id))
        .orderBy(desc(sessions.createdAt))
        .limit(1);

      // Also check last time entry as activity indicator
      const lastTimeEntry = await db
        .select({ createdAt: timeEntries.createdAt })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, user.id),
            ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
          ),
        )
        .orderBy(desc(timeEntries.createdAt))
        .limit(1);

      // Get the most recent activity
      const lastSessionDate = lastSession[0]?.createdAt;
      const lastTimeEntryDate = lastTimeEntry[0]?.createdAt;

      let lastActivityDate: Date | null = null;
      if (lastSessionDate && lastTimeEntryDate) {
        lastActivityDate =
          lastSessionDate > lastTimeEntryDate
            ? lastSessionDate
            : lastTimeEntryDate;
      } else {
        lastActivityDate = lastSessionDate || lastTimeEntryDate || null;
      }

      // Skip if user has been active recently
      if (lastActivityDate && lastActivityDate >= thresholdDate) continue;

      // Skip if we don't have any activity data (new user with no sessions)
      if (!lastActivityDate) continue;

      const daysSinceLastActivity = Math.floor(
        (now.getTime() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Skip if it's been more than 29 days (drip-emails cron handles 30+ days)
      if (daysSinceLastActivity > 29) continue;

      // Get unbilled info
      const unbilledEntries = await db
        .select({
          hours: timeEntries.hours,
          billableRate: timeEntries.billableRate,
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, user.id),
            ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
            eq(timeEntries.isBilled, false),
          ),
        );

      const unbilledHours = unbilledEntries.reduce(
        (sum, e) => sum + parseFloat(e.hours || "0"),
        0,
      );
      const unbilledValue = unbilledEntries.reduce(
        (sum, e) =>
          sum + parseFloat(e.hours || "0") * parseFloat(e.billableRate || "0"),
        0,
      );

      // Get pending tasks count
      const pendingTasksResult = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, user.id),
            ...(orgId ? [eq(tasks.organizationId, orgId)] : []),
            ne(tasks.status, "done"),
          ),
        );
      const pendingTasks = pendingTasksResult.length;

      // Send email
      await sendInactivityEmail({
        to: user.email,
        userName: user.name,
        daysSinceLastActivity,
        unbilledHours: unbilledHours > 0 ? unbilledHours : undefined,
        unbilledValue: unbilledValue > 0 ? unbilledValue : undefined,
        pendingTasks: pendingTasks > 0 ? pendingTasks : undefined,
        userId: user.id,
      });

      // Track when we sent it to enforce 7-day cooldown
      if (prefs) {
        await db
          .update(emailPreferences)
          .set({ lastInactivityEmailSentAt: now })
          .where(eq(emailPreferences.id, prefs.id));
      }

      sentCount++;
    } catch (error) {
      console.error(
        `Failed to send inactivity email for user ${user.id}:`,
        error,
      );
      errors.push(`User ${user.id}: ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/inactivity-check",
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
