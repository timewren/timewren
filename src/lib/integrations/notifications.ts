/**
 * Notifications Integration - Slack and Discord
 *
 * Provides functionality for sending notifications to Slack and Discord
 * webhooks, including daily digests, timer notifications, and alerts.
 */

import { toIntlLocale } from "@/i18n/format-locale";
import type { notificationChannels } from "@/lib/db/schema";
import { mailT } from "@/lib/email/locale";
import {
  getDiscordWebhookUrl,
  getSlackWebhookUrl,
} from "@/lib/notifications/webhook-secrets";

type NotificationChannel = typeof notificationChannels.$inferSelect;

interface SlackMessage {
  text?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
}

interface SlackBlock {
  type: "section" | "header" | "divider" | "context";
  text?: {
    type: "mrkdwn" | "plain_text";
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: "mrkdwn" | "plain_text";
    text: string;
  }>;
  elements?: Array<{
    type: "mrkdwn" | "plain_text" | "image";
    text?: string;
    image_url?: string;
    alt_text?: string;
  }>;
}

interface SlackAttachment {
  color?: string;
  title?: string;
  text?: string;
  fields?: Array<{
    title: string;
    value: string;
    short?: boolean;
  }>;
}

interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
  timestamp?: string;
}

// Color constants
const COLORS = {
  blue: {
    slack: "#3b82f6",
    discord: 0x3b82f6,
  },
  green: {
    slack: "#10b981",
    discord: 0x10b981,
  },
  amber: {
    slack: "#f59e0b",
    discord: 0xf59e0b,
  },
  red: {
    slack: "#ef4444",
    discord: 0xef4444,
  },
};

/**
 * Send a message to a Slack webhook
 */
export async function sendSlackMessage(
  webhookUrl: string,
  message: SlackMessage,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Slack API error: ${text}` };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Network error: ${error instanceof Error ? error.message : "Unknown"}`,
    };
  }
}

/**
 * Send a message to a Discord webhook
 */
export async function sendDiscordMessage(
  webhookUrl: string,
  message: DiscordMessage,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Discord API error: ${text}` };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Network error: ${error instanceof Error ? error.message : "Unknown"}`,
    };
  }
}

/**
 * Send a notification to a channel based on its type
 */
export async function sendNotification(
  channel: Pick<
    NotificationChannel,
    "channelType" | "slackWebhookUrl" | "discordWebhookUrl"
  >,
  slackMessage: SlackMessage,
  discordMessage: DiscordMessage,
): Promise<{ success: boolean; error?: string }> {
  const slackWebhookUrl = getSlackWebhookUrl(channel);
  if (channel.channelType === "slack" && slackWebhookUrl) {
    return sendSlackMessage(slackWebhookUrl, slackMessage);
  }

  const discordWebhookUrl = getDiscordWebhookUrl(channel);
  if (channel.channelType === "discord" && discordWebhookUrl) {
    return sendDiscordMessage(discordWebhookUrl, discordMessage);
  }

  return { success: false, error: "No valid webhook configured" };
}

// ============================================
// Timer Notifications
// ============================================

interface TimerStartData {
  projectName: string | null;
  clientName: string | null;
  description: string;
  startTime: Date;
}

export function buildTimerStartMessages(
  data: TimerStartData,
  locale?: string,
): {
  slack: SlackMessage;
  discord: DiscordMessage;
} {
  const t = mailT("notifications", locale);
  const projectText = data.projectName || t("slack.noProject");
  const clientText = data.clientName || t("slack.noClient");
  const timeText = data.startTime.toLocaleTimeString(
    toIntlLocale(locale ?? "da"),
    {
      timeZone: "Europe/Copenhagen",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  const slack: SlackMessage = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: t("slack.timerStarted"),
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*${t("slack.project")}:*\n${projectText}`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.client")}:*\n${clientText}`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.startedAtSlack")}:*\n${timeText}`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.description")}:*\n${data.description || "-"}`,
          },
        ],
      },
    ],
    attachments: [
      {
        color: COLORS.green.slack,
        text: "",
      },
    ],
  };

  const discord: DiscordMessage = {
    embeds: [
      {
        title: t("slack.timerStarted"),
        color: COLORS.green.discord,
        fields: [
          { name: t("slack.project"), value: projectText, inline: true },
          { name: t("slack.client"), value: clientText, inline: true },
          { name: t("slack.startedAtDiscord"), value: timeText, inline: true },
          {
            name: t("slack.description"),
            value: data.description || "-",
            inline: false,
          },
        ],
        timestamp: data.startTime.toISOString(),
      },
    ],
  };

  return { slack, discord };
}

interface TimerStopData {
  projectName: string | null;
  clientName: string | null;
  description: string;
  durationMinutes: number;
  startTime: Date;
  endTime: Date;
}

export function buildTimerStopMessages(
  data: TimerStopData,
  locale?: string,
): {
  slack: SlackMessage;
  discord: DiscordMessage;
} {
  const t = mailT("notifications", locale);
  const projectText = data.projectName || t("slack.noProject");
  const clientText = data.clientName || t("slack.noClient");
  const hours = Math.floor(data.durationMinutes / 60);
  const minutes = data.durationMinutes % 60;
  const durationText =
    hours > 0
      ? t("slack.durationHM", { h: hours, m: minutes })
      : t("slack.durationM", { m: minutes });

  const slack: SlackMessage = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: t("slack.timerStopped"),
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*${t("slack.project")}:*\n${projectText}`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.client")}:*\n${clientText}`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.duration")}:*\n${durationText}`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.description")}:*\n${data.description || "-"}`,
          },
        ],
      },
    ],
    attachments: [
      {
        color: COLORS.blue.slack,
        text: "",
      },
    ],
  };

  const discord: DiscordMessage = {
    embeds: [
      {
        title: t("slack.timerStopped"),
        color: COLORS.blue.discord,
        fields: [
          { name: t("slack.project"), value: projectText, inline: true },
          { name: t("slack.client"), value: clientText, inline: true },
          { name: t("slack.duration"), value: durationText, inline: true },
          {
            name: t("slack.description"),
            value: data.description || "-",
            inline: false,
          },
        ],
        timestamp: data.endTime.toISOString(),
      },
    ],
  };

  return { slack, discord };
}

// ============================================
// Idle Warning Notifications
// ============================================

interface IdleWarningData {
  idleMinutes: number;
  projectName: string | null;
}

export function buildIdleWarningMessages(
  data: IdleWarningData,
  locale?: string,
): {
  slack: SlackMessage;
  discord: DiscordMessage;
} {
  const t = mailT("notifications", locale);
  const projectText = data.projectName || t("slack.noProject");

  const slack: SlackMessage = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: t("slack.idleTitle"),
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("slack.idleBodySlack", {
            minutes: data.idleMinutes,
            project: projectText,
          }),
        },
      },
    ],
    attachments: [
      {
        color: COLORS.amber.slack,
        text: "",
      },
    ],
  };

  const discord: DiscordMessage = {
    embeds: [
      {
        title: t("slack.idleTitle"),
        description: t("slack.idleBodyDiscord", {
          minutes: data.idleMinutes,
          project: projectText,
        }),
        color: COLORS.amber.discord,
      },
    ],
  };

  return { slack, discord };
}

// ============================================
// Daily Summary Notifications
// ============================================

interface DailySummaryData {
  date: Date;
  totalHours: number;
  totalRevenue: number;
  projectBreakdown: Array<{
    projectName: string;
    clientName: string;
    hours: number;
    revenue: number;
  }>;
  tasksCompleted: number;
}

export function buildDailySummaryMessages(
  data: DailySummaryData,
  locale?: string,
): {
  slack: SlackMessage;
  discord: DiscordMessage;
} {
  const t = mailT("notifications", locale);
  const intl = toIntlLocale(locale ?? "da");
  const dateText = data.date.toLocaleDateString(intl, {
    timeZone: "Europe/Copenhagen",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formatHours = (h: number) =>
    h >= 1
      ? t("slack.hoursShort", {
          hours: h.toLocaleString(intl, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
        })
      : t("slack.minutesShort", { m: Math.round(h * 60) });
  const formatRevenue = (r: number) =>
    r.toLocaleString(intl, { style: "currency", currency: "DKK" });

  // Build project breakdown text
  const projectLines = data.projectBreakdown
    .slice(0, 5)
    .map(
      (p) =>
        `• ${p.projectName} (${p.clientName}): ${formatHours(p.hours)} - ${formatRevenue(p.revenue)}`,
    );

  const slack: SlackMessage = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: t("slack.dailyTitle", { date: dateText }),
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*${t("slack.totalTime")}:*\n${formatHours(data.totalHours)}`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.totalRevenue")}:*\n${formatRevenue(data.totalRevenue)}`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.tasksDone")}:*\n${data.tasksCompleted}`,
          },
        ],
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${t("slack.projects")}:*\n${projectLines.join("\n") || t("slack.noEntriesToday")}`,
        },
      },
    ],
    attachments: [
      {
        color: COLORS.blue.slack,
        text: "",
      },
    ],
  };

  const projectFieldsDiscord = data.projectBreakdown.slice(0, 5).map((p) => ({
    name: p.projectName,
    value: `${p.clientName}\n${formatHours(p.hours)} - ${formatRevenue(p.revenue)}`,
    inline: true,
  }));

  const discord: DiscordMessage = {
    embeds: [
      {
        title: t("slack.dailyTitle", { date: dateText }),
        color: COLORS.blue.discord,
        fields: [
          {
            name: t("slack.totalTime"),
            value: formatHours(data.totalHours),
            inline: true,
          },
          {
            name: t("slack.totalRevenue"),
            value: formatRevenue(data.totalRevenue),
            inline: true,
          },
          {
            name: t("slack.tasksDone"),
            value: data.tasksCompleted.toString(),
            inline: true,
          },
          ...projectFieldsDiscord,
        ],
        footer: {
          text: "TimeTrack",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  return { slack, discord };
}

// ============================================
// Weekly Summary Notifications
// ============================================

interface WeeklySummaryData {
  weekNumber: number;
  startDate: Date;
  endDate: Date;
  totalHours: number;
  totalRevenue: number;
  hoursChange: number; // Percentage change from previous week
  revenueChange: number;
  topClients: Array<{
    clientName: string;
    hours: number;
    revenue: number;
  }>;
  tasksCompleted: number;
  unbilledHours: number;
  unbilledRevenue: number;
}

export function buildWeeklySummaryMessages(
  data: WeeklySummaryData,
  locale?: string,
): {
  slack: SlackMessage;
  discord: DiscordMessage;
} {
  const t = mailT("notifications", locale);
  const intl = toIntlLocale(locale ?? "da");
  const formatHours = (h: number) =>
    t("slack.hoursShort", {
      hours: h.toLocaleString(intl, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    });
  const formatRevenue = (r: number) =>
    r.toLocaleString(intl, { style: "currency", currency: "DKK" });
  const formatChange = (c: number) =>
    c > 0 ? `+${c.toFixed(0)}%` : `${c.toFixed(0)}%`;

  const _hoursChangeColor = data.hoursChange >= 0 ? "" : "";
  const _revenueChangeColor = data.revenueChange >= 0 ? "" : "";

  const clientLines = data.topClients
    .slice(0, 3)
    .map(
      (c) =>
        `• ${c.clientName}: ${formatHours(c.hours)} - ${formatRevenue(c.revenue)}`,
    );

  const slack: SlackMessage = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: t("slack.weeklyTitle", { week: data.weekNumber }),
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*${t("slack.totalTime")}:*\n${formatHours(data.totalHours)} (${formatChange(data.hoursChange)})`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.totalRevenue")}:*\n${formatRevenue(data.totalRevenue)} (${formatChange(data.revenueChange)})`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.tasksDone")}:*\n${data.tasksCompleted}`,
          },
          {
            type: "mrkdwn",
            text: `*${t("slack.unbilled")}:*\n${formatHours(data.unbilledHours)} - ${formatRevenue(data.unbilledRevenue)}`,
          },
        ],
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${t("slack.topClients")}:*\n${clientLines.join("\n") || t("slack.noEntriesWeek")}`,
        },
      },
    ],
    attachments: [
      {
        color: COLORS.blue.slack,
        text: "",
      },
    ],
  };

  const discord: DiscordMessage = {
    embeds: [
      {
        title: t("slack.weeklyTitle", { week: data.weekNumber }),
        color: COLORS.blue.discord,
        fields: [
          {
            name: t("slack.totalTime"),
            value: `${formatHours(data.totalHours)} (${formatChange(data.hoursChange)})`,
            inline: true,
          },
          {
            name: t("slack.totalRevenue"),
            value: `${formatRevenue(data.totalRevenue)} (${formatChange(data.revenueChange)})`,
            inline: true,
          },
          {
            name: t("slack.tasksDone"),
            value: data.tasksCompleted.toString(),
            inline: true,
          },
          {
            name: t("slack.unbilled"),
            value: `${formatHours(data.unbilledHours)} - ${formatRevenue(data.unbilledRevenue)}`,
            inline: false,
          },
          {
            name: t("slack.topClients"),
            value: clientLines.join("\n") || t("slack.noEntriesWeek"),
            inline: false,
          },
        ],
        footer: {
          text: "TimeTrack",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  return { slack, discord };
}

// ============================================
// Test Message
// ============================================

export function buildTestMessages(locale?: string): {
  slack: SlackMessage;
  discord: DiscordMessage;
} {
  const t = mailT("notifications", locale);
  const slack: SlackMessage = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: t("slack.testTitle"),
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("slack.testBodySlack"),
        },
      },
    ],
    attachments: [
      {
        color: COLORS.green.slack,
        text: "",
      },
    ],
  };

  const discord: DiscordMessage = {
    embeds: [
      {
        title: t("slack.testTitle"),
        description: t("slack.testBodyDiscord"),
        color: COLORS.green.discord,
        footer: {
          text: "TimeTrack",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  return { slack, discord };
}
