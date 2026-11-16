import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  emailPreferences,
  notificationChannels,
  tasks,
  users,
} from "@/lib/db/schema";
import { mailT, normalizeMailLocale } from "@/lib/email/locale";
import {
  addDaysToDateStr,
  COPENHAGEN_TZ,
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenToday,
} from "@/lib/time/copenhagen";
import { sendDiscordNotification } from "./discord";
import { type EmailTemplate, sendEmailNotification } from "./email";
import { type PushPayload, sendPushNotification } from "./push";
import { decryptChannelWebhooks } from "./webhook-secrets";

export type NotificationType =
  | "daily_digest"
  | "deadline_reminder"
  | "overdue_alert"
  | "weekly_review"
  | "ai_suggestion"
  | "task_created"
  | "task_completed"
  | "idle_detected"
  // Gentagen faktura (#198): kladde oprettet og klar til gennemsyn
  | "recurring_invoice_draft";

export interface NotificationPayload {
  type: NotificationType;
  userId: string;
  /**
   * Tekst i modtagerens sprog: angiv enten `i18n` (nøgle i `notifications`-
   * kataloget under `msg.<nøgle>.title/.message`) eller en færdig titel og
   * besked.
   */
  title?: string;
  message?: string;
  i18n?: { key: string; values?: Record<string, string | number> };
  data?: Record<string, unknown>;
  url?: string;
}

/**
 * Send a notification to a user through all enabled channels
 */
export async function sendNotification(payload: NotificationPayload) {
  const { userId, type, data, url } = payload;

  // Get user's notification channels
  const channels = await db.query.notificationChannels.findMany({
    where: and(
      eq(notificationChannels.userId, userId),
      eq(notificationChannels.isEnabled, true),
    ),
  });

  // Get user's email preferences
  const emailPrefs = await db.query.emailPreferences.findFirst({
    where: eq(emailPreferences.userId, userId),
  });

  // Get user email + timezone (needed to resolve weekday in user's locale)
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true, name: true, timezone: true, locale: true },
  });

  if (!user) return;

  const locale = normalizeMailLocale(user.locale);
  const t = mailT("notifications", locale);
  const title = payload.i18n
    ? t(`msg.${payload.i18n.key}.title`, payload.i18n.values)
    : (payload.title ?? "");
  const message = payload.i18n
    ? t(`msg.${payload.i18n.key}.message`, payload.i18n.values)
    : (payload.message ?? "");

  const results: Array<{ channel: string; success: boolean; error?: string }> =
    [];

  // Hold back intrusive realtime channel notifications during quiet hours.
  const inQuietHours = isWithinQuietHours(
    emailPrefs,
    new Date(),
    user.timezone,
  );

  // Check notification type permissions for each channel
  for (const channel of decryptChannelWebhooks(channels)) {
    if (inQuietHours) continue;
    if (!isChannelActiveToday(channel, undefined, user.timezone)) continue;
    const shouldSend = shouldSendToChannel(channel, type);
    if (!shouldSend) continue;

    try {
      if (channel.channelType === "discord" && channel.discordWebhookUrl) {
        await sendDiscordNotification({
          webhookUrl: channel.discordWebhookUrl,
          title,
          message,
          type,
          url,
        });
        results.push({ channel: "discord", success: true });
      }

      if (channel.channelType === "browser_push" && channel.pushSubscription) {
        await sendPushNotification({
          subscription: channel.pushSubscription as PushPayload["subscription"],
          title,
          body: message,
          url,
          data,
          locale,
        });
        results.push({ channel: "browser_push", success: true });
      }
    } catch (error) {
      results.push({
        channel: channel.channelType,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Send email notification based on type and preferences
  if (shouldSendEmail(emailPrefs, type)) {
    try {
      await sendEmailNotification({
        to: user.email,
        name: user.name,
        template: mapTypeToTemplate(type),
        subject: title,
        locale,
        data: { message, ...data, url },
      });
      results.push({ channel: "email", success: true });
    } catch (error) {
      results.push({
        channel: "email",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}

/**
 * Returns the weekday number (0=Sunday … 6=Saturday) for a date in the given timezone.
 * Falls back to server-local weekday if the timezone is invalid or missing.
 */
const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getWeekdayInTimezone(
  date: Date,
  timezone?: string | null,
): number {
  // Fald tilbage til dansk tid, ikke processens TZ (prod kører UTC, #649)
  const weekdayIn = (timeZone: string) =>
    WEEKDAY_MAP[
      new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
        date,
      )
    ];
  try {
    return weekdayIn(timezone || COPENHAGEN_TZ) ?? weekdayIn(COPENHAGEN_TZ);
  } catch {
    return weekdayIn(COPENHAGEN_TZ);
  }
}

/**
 * Returns true if the channel is active for the given weekday (defaults to today).
 * `activeDays` uses 0=Sunday … 6=Saturday. Empty array means the channel is muted
 * on every day. Null is treated as all-days for safety with legacy rows.
 */
export function isChannelActiveToday(
  channel: Pick<typeof notificationChannels.$inferSelect, "activeDays">,
  now: Date = new Date(),
  timezone?: string | null,
): boolean {
  const days = channel.activeDays;
  if (days == null) return true;
  return days.includes(getWeekdayInTimezone(now, timezone));
}

/**
 * Format a date as "HH:MM" in the given timezone (24h). Falls back to
 * server-local time if the timezone is invalid/missing.
 */
function formatTimeInTimezone(date: Date, timezone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || undefined,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return `${date.getHours().toString().padStart(2, "0")}:${date
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  }
}

type QuietHoursPrefs = Pick<
  typeof emailPreferences.$inferSelect,
  "quietHoursEnabled" | "quietHoursStart" | "quietHoursEnd"
>;

/**
 * Returns true if `now` falls within the user's configured quiet hours,
 * evaluated in the user's timezone. Used to hold back intrusive realtime
 * channel notifications (push/Discord/Slack) during sleep hours. Handles
 * overnight ranges (e.g. 22:00–08:00).
 */
export function isWithinQuietHours(
  prefs: QuietHoursPrefs | null | undefined,
  now: Date = new Date(),
  timezone?: string | null,
): boolean {
  if (!prefs?.quietHoursEnabled) return false;
  const toMins = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const c = toMins(formatTimeInTimezone(now, timezone));
  const s = toMins(prefs.quietHoursStart || "22:00");
  const e = toMins(prefs.quietHoursEnd || "08:00");
  if (s > e) return c >= s || c < e; // overnight window
  return c >= s && c < e;
}

/**
 * Batch-load quiet-hours preferences for many users in a single query, returned
 * as a Map keyed by userId. Use this in cron loops to avoid a per-user query.
 * Users without a prefs row are simply absent from the map (isWithinQuietHours
 * treats undefined as "not in quiet hours").
 */
export async function getQuietHoursPrefs(
  userIds: string[],
): Promise<Map<string, QuietHoursPrefs>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.query.emailPreferences.findMany({
    where: (p, { inArray }) => inArray(p.userId, userIds),
    columns: {
      userId: true,
      quietHoursEnabled: true,
      quietHoursStart: true,
      quietHoursEnd: true,
    },
  });
  return new Map(rows.map((r) => [r.userId, r]));
}

/**
 * Check if notification should be sent to a specific channel based on type
 */
function shouldSendToChannel(
  channel: typeof notificationChannels.$inferSelect,
  type: NotificationType,
): boolean {
  switch (type) {
    case "daily_digest":
      return channel.sendDailyDigest ?? false;
    case "deadline_reminder":
      return channel.sendDeadlineReminders ?? false;
    case "overdue_alert":
      return channel.sendOverdueAlerts ?? false;
    case "weekly_review":
      return channel.sendWeeklyReview ?? false;
    case "ai_suggestion":
      return channel.sendAiSuggestions ?? false;
    default:
      return true;
  }
}

/**
 * Check if email should be sent based on preferences
 */
function shouldSendEmail(
  prefs: typeof emailPreferences.$inferSelect | undefined | null,
  type: NotificationType,
): boolean {
  if (!prefs) return true; // Default to sending if no preferences set

  switch (type) {
    case "daily_digest":
    case "weekly_review":
      return prefs.weeklyReport ?? true;
    case "deadline_reminder":
    case "overdue_alert":
      return prefs.unbilledReminder ?? true;
    default:
      return true;
  }
}

/**
 * Map notification type to email template
 */
function mapTypeToTemplate(type: NotificationType): EmailTemplate {
  switch (type) {
    case "daily_digest":
      return "daily_digest";
    case "deadline_reminder":
      return "deadline_reminder";
    case "overdue_alert":
      return "overdue_alert";
    case "weekly_review":
      return "weekly_review";
    case "ai_suggestion":
      return "ai_suggestion";
    default:
      return "general";
  }
}

/**
 * Get tasks due today for a user
 */
export async function getTasksDueToday(userId: string) {
  // Dansk dag uanset processens TZ (#649)
  const todayStr = copenhagenToday();
  const today = copenhagenDayStart(todayStr);
  const tomorrow = copenhagenDayEndExclusive(todayStr);

  return db.query.tasks.findMany({
    where: and(
      eq(tasks.userId, userId),
      gte(tasks.deadline, today),
      lte(tasks.deadline, tomorrow),
      or(
        eq(tasks.status, "backlog"),
        eq(tasks.status, "todo"),
        eq(tasks.status, "in_progress"),
      ),
    ),
    with: { project: true },
    orderBy: (tasks, { asc }) => [asc(tasks.deadline)],
  });
}

/**
 * Get overdue tasks for a user
 */
export async function getOverdueTasks(userId: string) {
  const now = new Date();

  return db.query.tasks.findMany({
    where: and(
      eq(tasks.userId, userId),
      lte(tasks.deadline, now),
      or(
        eq(tasks.status, "backlog"),
        eq(tasks.status, "todo"),
        eq(tasks.status, "in_progress"),
      ),
    ),
    with: { project: true },
    orderBy: (tasks, { asc }) => [asc(tasks.deadline)],
  });
}

/**
 * Get tasks for the week for a user
 */
export async function getTasksForWeek(userId: string) {
  // Dansk dag uanset processens TZ (#649)
  const todayStr = copenhagenToday();
  const today = copenhagenDayStart(todayStr);
  const endOfWeek = copenhagenDayStart(addDaysToDateStr(todayStr, 7));

  return db.query.tasks.findMany({
    where: and(
      eq(tasks.userId, userId),
      or(
        and(gte(tasks.deadline, today), lte(tasks.deadline, endOfWeek)),
        isNull(tasks.deadline),
      ),
      or(
        eq(tasks.status, "backlog"),
        eq(tasks.status, "todo"),
        eq(tasks.status, "in_progress"),
      ),
    ),
    with: { project: true },
    orderBy: (tasks, { desc, asc }) => [
      desc(tasks.priority),
      asc(tasks.deadline),
    ],
  });
}

/**
 * Get all users who should receive daily digest
 */
export async function getUsersForDailyDigest() {
  const prefs = await db.query.emailPreferences.findMany({
    where: eq(emailPreferences.weeklyReport, true),
  });

  const userIds = prefs.map((p) => p.userId);

  if (userIds.length === 0) return [];

  return db.query.users.findMany({
    where: (users, { inArray }) => inArray(users.id, userIds),
  });
}

export { sendDiscordNotification } from "./discord";
export { sendEmailNotification } from "./email";
export { sendPushNotification } from "./push";
