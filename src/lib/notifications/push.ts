import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { currentBrandId } from "@/i18n/brandize";
import { getBrand } from "@/lib/brand";
import { getEmailDomain } from "@/lib/config";
import { db } from "@/lib/db";
import { mobilePushTokens, pushSubscriptions } from "@/lib/db/schema";
import { mailT } from "@/lib/email/locale";
import { resolveOutgoingLocale } from "@/lib/email/request-locale";
import { sendExpoPush } from "./expo-push";

// Configure web-push with VAPID keys
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL =
  process.env.VAPID_EMAIL || `mailto:support@${getEmailDomain()}`;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export interface PushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushPayload {
  subscription: PushSubscription;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
  /** Modtagerens sprog (til handlingsknapperne); standard dansk */
  locale?: string;
}

/**
 * Check if push notifications are configured
 */
export function isPushConfigured(): boolean {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

/**
 * Get public VAPID key for client subscription
 */
export function getVapidPublicKey(): string | null {
  return VAPID_PUBLIC_KEY || null;
}

/**
 * Send a push notification
 */
export async function sendPushNotification(
  payload: PushPayload,
): Promise<void> {
  if (!isPushConfigured()) {
    throw new Error("Push notifications not configured - missing VAPID keys");
  }

  const { subscription, title, body, icon, badge, url, tag, data, locale } =
    payload;
  const t = mailT("notifications", locale);

  const notificationPayload = JSON.stringify({
    title,
    body,
    // Kaldets brand (TimeWren på timewren.com); cron og uden host: build-brandet.
    icon: icon || getBrand(currentBrandId()).logo.icon192,
    badge: badge || "/icons/badge-72x72.png",
    tag: tag || "timetrack-notification",
    data: {
      url: url || "/dashboard",
      ...data,
    },
    actions: url
      ? [
          {
            action: "open",
            title: t("push.open"),
          },
          {
            action: "dismiss",
            title: t("push.dismiss"),
          },
        ]
      : undefined,
  });

  await webpush.sendNotification(subscription, notificationPayload);
}

/**
 * Send a push notification to all of a user's active subscriptions — both
 * web-push (VAPID) and native Expo-tokens from the mobile app. Loads the
 * subscriptions from the DB, sends to each, and deactivates any that the push
 * service rejects as gone (HTTP 404/410 / DeviceNotRegistered). Never throws —
 * notification delivery must not break the action that triggered it.
 * `subscriptions` counts both kinds so callers can tell "no recipients" apart
 * from "all rejected". Web-push is skipped (not counted) when VAPID isn't
 * configured; Expo needs no config.
 */
export async function pushToUser(
  userId: string,
  payload: Omit<PushPayload, "subscription">,
): Promise<{ subscriptions: number; sent: number }> {
  const [webResult, expoResult] = await Promise.all([
    pushWebToUser(userId, payload),
    pushExpoToUser(userId, payload),
  ]);
  return {
    subscriptions: webResult.subscriptions + expoResult.subscriptions,
    sent: webResult.sent + expoResult.sent,
  };
}

async function pushExpoToUser(
  userId: string,
  payload: Omit<PushPayload, "subscription">,
): Promise<{ subscriptions: number; sent: number }> {
  try {
    const rows = await db.query.mobilePushTokens.findMany({
      where: and(
        eq(mobilePushTokens.userId, userId),
        eq(mobilePushTokens.isActive, true),
      ),
      columns: { token: true },
    });
    if (rows.length === 0) return { subscriptions: 0, sent: 0 };
    const result = await sendExpoPush(
      rows.map((r) => r.token),
      {
        title: payload.title,
        body: payload.body,
        data: { url: payload.url || "/dashboard", ...payload.data },
      },
    );
    return { subscriptions: rows.length, sent: result.sent };
  } catch (err) {
    console.error("[push] Expo-push fejlede:", err);
    return { subscriptions: 0, sent: 0 };
  }
}

async function pushWebToUser(
  userId: string,
  payload: Omit<PushPayload, "subscription">,
): Promise<{ subscriptions: number; sent: number }> {
  if (!isPushConfigured()) return { subscriptions: 0, sent: 0 };

  const subs = await db.query.pushSubscriptions.findMany({
    where: and(
      eq(pushSubscriptions.userId, userId),
      eq(pushSubscriptions.isActive, true),
    ),
  });

  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      if (!sub.p256dhKey || !sub.authKey) return;
      try {
        await sendPushNotification({
          ...payload,
          subscription: {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
          },
        });
        sent++;
      } catch (err) {
        // 404/410 = subscription gone; deactivate so we stop retrying it.
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db
            .update(pushSubscriptions)
            .set({ isActive: false })
            .where(eq(pushSubscriptions.id, sub.id));
        }
      }
    }),
  );
  return { subscriptions: subs.length, sent };
}

/**
 * Send deadline reminder push notification
 */
export async function sendDeadlineReminderPush(
  subscription: PushSubscription,
  task: {
    id: string;
    title: string;
    deadline: Date;
    projectName?: string;
  },
  locale?: string,
): Promise<void> {
  const t = mailT("notifications", locale);
  const timeUntil = getTimeUntilDeadline(task.deadline, locale);

  await sendPushNotification({
    subscription,
    locale,
    title: t("push.deadlineTitle"),
    body: t("push.deadlineBody", { title: task.title, when: timeUntil }),
    url: `/dashboard/tasks/${task.id}`,
    tag: `deadline-${task.id}`,
    data: {
      taskId: task.id,
      type: "deadline_reminder",
    },
  });
}

/**
 * Send overdue task push notification
 */
export async function sendOverdueTaskPush(
  subscription: PushSubscription,
  task: {
    id: string;
    title: string;
    deadline: Date;
  },
  locale?: string,
): Promise<void> {
  const t = mailT("notifications", locale);
  await sendPushNotification({
    subscription,
    locale,
    title: t("push.overdueTitle"),
    body: t("push.overdueBody", { title: task.title }),
    url: `/dashboard/tasks/${task.id}`,
    tag: `overdue-${task.id}`,
    data: {
      taskId: task.id,
      type: "overdue_alert",
    },
  });
}

/**
 * Send daily digest push notification
 */
export async function sendDailyDigestPush(
  subscription: PushSubscription,
  data: {
    taskCount: number;
    overdueCount: number;
  },
  locale?: string,
): Promise<void> {
  const t = mailT("notifications", locale);
  const { taskCount, overdueCount } = data;

  let body = "";
  if (overdueCount > 0) {
    body = t("push.digestOverdue", {
      overdue: overdueCount,
      tasks: taskCount,
    });
  } else if (taskCount > 0) {
    body = t("push.digestTasks", { count: taskCount });
  } else {
    body = t("push.digestNone");
  }

  await sendPushNotification({
    subscription,
    locale,
    title: t("push.digestTitle"),
    body,
    url: "/dashboard/tasks",
    tag: "daily-digest",
    data: {
      type: "daily_digest",
    },
  });
}

/**
 * Get human-readable time until deadline
 */
function getTimeUntilDeadline(deadline: Date, locale?: string): string {
  const t = mailT("notifications", locale);
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 1) return t("push.whenDays", { days });
  if (days === 1) return t("push.whenTomorrow");
  if (hours > 1) return t("push.whenHours", { hours });
  if (hours === 1) return t("push.whenOneHour");
  return t("push.whenSoon");
}

/**
 * Test push subscription by sending a test notification
 */
export async function testPushSubscription(
  subscription: PushSubscription,
  locale?: string,
): Promise<boolean> {
  const resolved = await resolveOutgoingLocale(locale);
  const t = mailT("notifications", resolved);
  try {
    await sendPushNotification({
      subscription,
      locale: resolved,
      title: t("push.testTitle"),
      body: t("push.testBody", { brand: getBrand(currentBrandId()).name }),
      tag: "test",
    });
    return true;
  } catch {
    return false;
  }
}
