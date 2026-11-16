import { mailT } from "@/lib/email/locale";
import { resolveOutgoingLocale } from "@/lib/email/request-locale";
import type { NotificationType } from "./index";

interface DiscordNotificationParams {
  webhookUrl: string;
  title: string;
  message: string;
  type: NotificationType;
  url?: string;
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  timestamp?: string;
  url?: string;
  footer?: {
    text: string;
    icon_url?: string;
  };
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
}

/**
 * Get color for notification type
 */
function getColorForType(type: NotificationType): number {
  switch (type) {
    case "overdue_alert":
      return 0xef4444; // Red
    case "deadline_reminder":
      return 0xf59e0b; // Amber
    case "daily_digest":
      return 0x3b82f6; // Blue
    case "weekly_review":
      return 0x8b5cf6; // Purple
    case "ai_suggestion":
      return 0x10b981; // Green
    case "task_created":
      return 0x06b6d4; // Cyan
    case "task_completed":
      return 0x22c55e; // Green
    case "idle_detected":
      return 0xfbbf24; // Yellow
    default:
      return 0x6b7280; // Gray
  }
}

/**
 * Get emoji for notification type
 */
function getEmojiForType(type: NotificationType): string {
  switch (type) {
    case "overdue_alert":
      return "🚨";
    case "deadline_reminder":
      return "⏰";
    case "daily_digest":
      return "📋";
    case "weekly_review":
      return "📊";
    case "ai_suggestion":
      return "🤖";
    case "task_created":
      return "✨";
    case "task_completed":
      return "✅";
    case "idle_detected":
      return "💤";
    default:
      return "📌";
  }
}

/**
 * Send a notification to Discord via webhook
 */
export async function sendDiscordNotification(
  params: DiscordNotificationParams,
): Promise<void> {
  const { webhookUrl, title, message, type, url } = params;

  const emoji = getEmojiForType(type);
  const color = getColorForType(type);

  const embed: DiscordEmbed = {
    title: `${emoji} ${title}`,
    description: message,
    color,
    timestamp: new Date().toISOString(),
    footer: {
      text: "TimeTrack",
    },
  };

  if (url) {
    embed.url = url;
  }

  const payload = {
    embeds: [embed],
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} - ${text}`);
  }
}

/**
 * Send daily digest to Discord
 */
export async function sendDailyDigestToDiscord(
  webhookUrl: string,
  data: {
    userName: string;
    tasksToday: Array<{
      title: string;
      projectName?: string;
      deadline?: Date;
      priority: string;
    }>;
    overdueTasks: Array<{
      title: string;
      projectName?: string;
      deadline?: Date;
    }>;
    completedYesterday: number;
    yesterdayHours?: number;
  },
  locale?: string,
): Promise<void> {
  const t = mailT("notifications", locale);
  const {
    userName,
    tasksToday,
    overdueTasks,
    completedYesterday,
    yesterdayHours,
  } = data;

  const fields: DiscordEmbed["fields"] = [];

  // Add today's tasks
  if (tasksToday.length > 0) {
    const taskList = tasksToday
      .slice(0, 5)
      .map((task) => {
        const project = task.projectName ? ` (${task.projectName})` : "";
        const priority =
          task.priority === "urgent" || task.priority === "high" ? " 🔴" : "";
        return `• ${task.title}${project}${priority}`;
      })
      .join("\n");

    fields.push({
      name: t("discord.todayTasks", { count: tasksToday.length }),
      value:
        taskList +
        (tasksToday.length > 5
          ? `\n${t("discord.andMore", { count: tasksToday.length - 5 })}`
          : ""),
      inline: false,
    });
  }

  // Add overdue tasks
  if (overdueTasks.length > 0) {
    const overdueList = overdueTasks
      .slice(0, 3)
      .map((task) => `• ${task.title}`)
      .join("\n");

    fields.push({
      name: t("discord.overdueTasks", { count: overdueTasks.length }),
      value:
        overdueList +
        (overdueTasks.length > 3
          ? `\n${t("discord.andMore", { count: overdueTasks.length - 3 })}`
          : ""),
      inline: false,
    });
  }

  // Add stats
  const statsLines: string[] = [];
  if (yesterdayHours && yesterdayHours > 0) {
    const h = Math.floor(yesterdayHours);
    const m = Math.round((yesterdayHours % 1) * 60);
    statsLines.push(t("discord.yesterdayTime", { h, m }));
  }
  statsLines.push(t("discord.yesterdayDone", { count: completedYesterday }));

  fields.push({
    name: t("discord.status"),
    value: statsLines.join("\n"),
    inline: true,
  });

  const embed: DiscordEmbed = {
    title: t("discord.digestTitle", { name: userName }),
    description:
      tasksToday.length === 0 && overdueTasks.length === 0
        ? t("discord.digestNone")
        : t("discord.digestOverview"),
    color: overdueTasks.length > 0 ? 0xf59e0b : 0x3b82f6,
    timestamp: new Date().toISOString(),
    fields,
    footer: {
      text: t("discord.digestFooter"),
    },
  };

  const payload = {
    embeds: [embed],
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} - ${text}`);
  }
}

/**
 * Test Discord webhook
 */
export async function testDiscordWebhook(
  webhookUrl: string,
  locale?: string,
): Promise<boolean> {
  const t = mailT("notifications", await resolveOutgoingLocale(locale));
  try {
    await sendDiscordNotification({
      webhookUrl,
      title: t("discord.testTitle"),
      message: t("discord.testMessage"),
      type: "task_created",
    });
    return true;
  } catch {
    return false;
  }
}
