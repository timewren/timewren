import { toIntlLocale } from "@/i18n/format-locale";
import { getAppUrl } from "@/lib/config";
import { db } from "@/lib/db";
import { sendAdminNotificationEmail } from "@/lib/email/admin-notifications";
import { mailT } from "@/lib/email/locale";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { resolveOutgoingLocale } from "@/lib/email/request-locale";

// ── Types ──────────────────────────────────────────────────────────

export type AdminEventType =
  | "signup"
  | "subscription_started"
  | "payment_failed"
  | "subscription_cancelled"
  | "trial_ending"
  | "user_flagged"
  | "support_ticket"
  | "webhook_rejected"
  | "seat_drift"
  | "churn_risk"
  | "feedback_received"
  | "subscription_duplicate"
  | "beta_tester_signup";

export interface AdminEventData {
  /** Fravalg af sprog til teksterne; standard er første modtagers sprog, ellers dansk */
  locale?: string;
  userName?: string;
  userEmail?: string;
  userId?: string;
  planName?: string;
  daysLeft?: number;
  reason?: string;
  feedbackType?: string;
}

// ── Settings cache (5 min TTL) ─────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;
let settingsCache: Map<string, string> | null = null;
let settingsCacheTime = 0;

async function getSettings(): Promise<Map<string, string>> {
  const now = Date.now();
  if (settingsCache && now - settingsCacheTime < CACHE_TTL_MS) {
    return settingsCache;
  }

  try {
    const rows = await db.query.adminSettings.findMany();
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.id, row.value);
    }
    settingsCache = map;
    settingsCacheTime = now;
    return map;
  } catch (err) {
    console.error("[Admin Notify] Failed to load settings:", err);
    // Return empty map if DB fails — defaults will apply
    return new Map();
  }
}

function isEnabled(
  settings: Map<string, string>,
  event: AdminEventType,
): boolean {
  const key = `notify_${event}`;
  const val = settings.get(key);
  // Default to true if not set
  if (val === undefined) return true;
  return val === "true" || val === "1";
}

// ── Event config ───────────────────────────────────────────────────

interface EventConfig {
  emoji: string;
  color: number;
  supportsEmail: boolean;
}

const EVENT_CONFIG: Record<AdminEventType, EventConfig> = {
  signup: {
    emoji: "\u{1F44B}",
    color: 0x22c55e, // Green
    supportsEmail: true,
  },
  subscription_started: {
    emoji: "\u{1F389}",
    color: 0x22c55e, // Green
    supportsEmail: true,
  },
  payment_failed: {
    emoji: "\u{1F6A8}",
    color: 0xef4444, // Red
    supportsEmail: true,
  },
  subscription_cancelled: {
    emoji: "\u{274C}",
    color: 0xef4444, // Red
    supportsEmail: true,
  },
  trial_ending: {
    emoji: "\u{23F3}",
    color: 0xf59e0b, // Yellow
    supportsEmail: false, // Discord only
  },
  user_flagged: {
    emoji: "\u{1F6A9}",
    color: 0xf59e0b, // Yellow
    supportsEmail: false, // Discord only
  },
  support_ticket: {
    emoji: "\u{1F4E9}",
    color: 0x3b82f6, // Blue
    supportsEmail: false, // Discord only
  },
  webhook_rejected: {
    emoji: "\u{1F6D1}",
    color: 0xef4444, // Red
    supportsEmail: false, // Discord only
  },
  seat_drift: {
    emoji: "\u{1FA91}",
    color: 0xf59e0b, // Yellow
    supportsEmail: false, // Discord only
  },
  churn_risk: {
    emoji: "\u{1F6A8}",
    color: 0xef4444, // Red
    supportsEmail: false, // Discord only
  },
  subscription_duplicate: {
    emoji: "\u{1F4B8}",
    color: 0xef4444, // Red
    supportsEmail: false, // Discord only
  },
  feedback_received: {
    emoji: "\u{1F4AC}",
    color: 0x8b5cf6, // Purple
    supportsEmail: false, // email sendes separat som FeedbackEmail — undgå dobbelt mail
  },
  beta_tester_signup: {
    emoji: "\u{1F4F1}",
    color: 0x0ea5e9, // Sky
    supportsEmail: true,
  },
};

// ── Main function ──────────────────────────────────────────────────

/**
 * Send admin notifications for business events.
 * NEVER throws — logs errors with console.error.
 */
export async function notifyAdmin(
  event: AdminEventType,
  data: AdminEventData,
): Promise<void> {
  try {
    const settings = await getSettings();

    if (!isEnabled(settings, event)) {
      return;
    }

    const config = EVENT_CONFIG[event];
    const appUrl = getAppUrl();
    const userLink = data.userId
      ? `${appUrl}/admin/users/${data.userId}`
      : undefined;

    const timestamp = new Date().toISOString();

    // Teksterne følger første mailmodtagers sprog (admin), ellers dansk.
    const notificationEmail =
      settings.get("notification_email") ||
      process.env.ADMIN_NOTIFICATION_EMAIL;
    const emails = (notificationEmail ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const locale =
      data.locale ?? (await getRecipientLocale({ email: emails[0] }));
    const t = mailT("notifications", locale);
    const eventTitle = t(`admin.ev.${event}`);

    // Build description
    const descriptionParts: string[] = [];
    if (data.userName)
      descriptionParts.push(`**${t("admin.fieldName")}:** ${data.userName}`);
    if (data.userEmail)
      descriptionParts.push(`**${t("admin.fieldEmail")}:** ${data.userEmail}`);
    if (data.planName)
      descriptionParts.push(`**${t("admin.fieldPlan")}:** ${data.planName}`);
    if (data.feedbackType)
      descriptionParts.push(
        `**${t("admin.fieldType")}:** ${data.feedbackType}`,
      );
    if (data.daysLeft !== undefined)
      descriptionParts.push(
        `**${t("admin.fieldDaysLeft")}:** ${data.daysLeft}`,
      );
    if (data.reason)
      descriptionParts.push(`**${t("admin.fieldReason")}:** ${data.reason}`);
    descriptionParts.push(
      `**${t("admin.fieldTime")}:** ${new Date().toLocaleString(toIntlLocale(locale), { timeZone: "Europe/Copenhagen" })}`,
    );
    if (userLink) descriptionParts.push(`[${t("admin.seeUser")}](${userLink})`);

    const description = descriptionParts.join("\n");

    // Send Discord notification
    const discordWebhookUrl =
      settings.get("discord_webhook_url") ||
      process.env.ADMIN_DISCORD_WEBHOOK_URL;

    if (discordWebhookUrl) {
      try {
        await sendAdminDiscordEmbed({
          webhookUrl: discordWebhookUrl,
          title: `${config.emoji} ${eventTitle}`,
          description,
          color: config.color,
          url: userLink,
          timestamp,
        });
      } catch (err) {
        console.error("[Admin Notify] Discord failed:", err);
      }
    }

    // Send email notification (only for events that support it)
    if (config.supportsEmail) {
      if (notificationEmail) {
        try {
          const subject = t(`admin.sub.${event}`, {
            name: data.userName || data.userEmail || t("admin.unknownName"),
          });

          for (const email of emails) {
            await sendAdminNotificationEmail({
              to: email,
              subject,
              eventTitle,
              userName: data.userName,
              userEmail: data.userEmail,
              userId: data.userId,
              planName: data.planName,
              daysLeft: data.daysLeft,
              reason: data.reason,
              userLink,
            });
          }
        } catch (err) {
          console.error("[Admin Notify] Email failed:", err);
        }
      }
    }
  } catch (err) {
    // Never throw — admin notifications must not break user flows
    console.error("[Admin Notify] Unexpected error:", err);
  }
}

// ── Discord embed sender ───────────────────────────────────────────

interface AdminDiscordEmbedParams {
  webhookUrl: string;
  title: string;
  description: string;
  color: number;
  url?: string;
  timestamp: string;
  /** Sprog til sidefoden; standard dansk */
  locale?: string;
}

export async function sendAdminDiscordEmbed(
  params: AdminDiscordEmbedParams,
): Promise<void> {
  const t = mailT("notifications", params.locale);
  const payload = {
    embeds: [
      {
        title: params.title,
        description: params.description,
        color: params.color,
        url: params.url,
        timestamp: params.timestamp,
        footer: {
          text: t("admin.footer"),
        },
      },
    ],
  };

  const response = await fetch(params.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    // Kaldes bl.a. fra cron-ruter — en hængende webhook må ikke blokere dem.
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} - ${text}`);
  }
}

/**
 * Send a test message to a Discord webhook URL.
 * Returns true if successful, false otherwise.
 */
export async function testAdminDiscordWebhook(
  webhookUrl: string,
  locale?: string,
): Promise<boolean> {
  try {
    const resolved = await resolveOutgoingLocale(locale);
    const t = mailT("notifications", resolved);
    await sendAdminDiscordEmbed({
      webhookUrl,
      locale: resolved,
      title: `\u{2705} ${t("admin.testTitle")}`,
      description: t("admin.testBody"),
      color: 0x22c55e,
      timestamp: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    console.error("[Admin Notify] Discord test failed:", err);
    return false;
  }
}
