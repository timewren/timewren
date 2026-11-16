import { and, eq, inArray, or } from "drizzle-orm";
import {
  aiPrioritization,
  type TaskForPrioritization,
} from "@/lib/ai/prioritizer";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { notificationChannels, tasks, users } from "@/lib/db/schema";
import { mailT, normalizeMailLocale } from "@/lib/email/locale";
import {
  sendDiscordMessage,
  sendSlackMessage,
} from "@/lib/integrations/notifications";
import { isChannelActiveToday } from "@/lib/notifications";
import { decryptChannelWebhooks } from "@/lib/notifications/webhook-secrets";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 30 8 * * 1-5 (Weekdays at 08:30)

export const GET = withCronLogging("ai-suggestions", async (_request) => {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  // Only load users who have at least one notification channel with
  // AI suggestions enabled. Avoids scanning the full users table and
  // making an extra channel query per user.
  const userIdsWithChannels = await db
    .selectDistinct({ userId: notificationChannels.userId })
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.isEnabled, true),
        eq(notificationChannels.sendAiSuggestions, true),
      ),
    );

  const allUsers = userIdsWithChannels.length
    ? await db
        .select({
          id: users.id,
          name: users.name,
          timezone: users.timezone,
          locale: users.locale,
        })
        .from(users)
        .where(
          inArray(
            users.id,
            userIdsWithChannels.map((r) => r.userId),
          ),
        )
    : [];

  let sentCount = 0;
  const errors: string[] = [];

  for (const user of allUsers) {
    try {
      const locale = normalizeMailLocale(user.locale);
      const t = mailT("notifications", locale);
      const orgId = await getUserOrgId(user.id);

      // Check if user has any channels with AI suggestions enabled
      const channels = await db
        .select()
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.userId, user.id),
            eq(notificationChannels.isEnabled, true),
            eq(notificationChannels.sendAiSuggestions, true),
          ),
        );

      if (channels.length === 0) continue;

      // Get active tasks for prioritization
      const userTasks = await db.query.tasks.findMany({
        where: and(
          eq(tasks.userId, user.id),
          ...(orgId ? [eq(tasks.organizationId, orgId)] : []),
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
        limit: 30,
      });

      if (userTasks.length === 0) continue;

      // Run AI prioritization (falls back to score-based if no OpenAI key)
      const tasksForPrioritization: TaskForPrioritization[] = userTasks.map(
        (t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          priority:
            (t.priority as "low" | "medium" | "high" | "urgent") || "medium",
          deadline: t.deadline,
          estimatedMinutes: t.estimatedMinutes,
          projectName: t.project?.name || null,
          status: t.status,
        }),
      );

      const result = await aiPrioritization(
        tasksForPrioritization,
        8,
        "day",
        user.id,
      );

      // Build notification content
      const focusLines = result.focusTasks
        .slice(0, 5)
        .map((ft) => {
          const task = userTasks.find((t) => t.id === ft.taskId);
          if (!task) return null;
          const timeBlock = ft.suggestedTimeBlock
            ? ` (${ft.suggestedTimeBlock})`
            : "";
          return `**${ft.rank}.** ${task.title}${timeBlock}\n   _${ft.reason}_`;
        })
        .filter(Boolean)
        .join("\n");

      const warningLines = result.warnings
        .slice(0, 3)
        .map((w) => {
          const task = userTasks.find((t) => t.id === w.taskId);
          const taskName = task ? task.title : "";
          return `${taskName ? `**${taskName}**: ` : ""}${w.message}`;
        })
        .join("\n");

      const deferredCount = result.deferredTasks.length;

      // Build Discord embed
      const discordFields: Array<{
        name: string;
        value: string;
        inline: boolean;
      }> = [];

      if (focusLines) {
        discordFields.push({
          name: t("slack.aiFocusName", { count: result.focusTasks.length }),
          value: focusLines,
          inline: false,
        });
      }

      if (warningLines) {
        discordFields.push({
          name: t("slack.aiWarnings"),
          value: warningLines,
          inline: false,
        });
      }

      if (deferredCount > 0) {
        discordFields.push({
          name: t("slack.aiDeferred"),
          value: t("slack.aiDeferredValue", { count: deferredCount }),
          inline: true,
        });
      }

      const greeting = t("slack.aiGreeting", {
        name: user.name || t("fallbackUser"),
      });

      for (const channel of decryptChannelWebhooks(channels)) {
        if (!isChannelActiveToday(channel, now, user.timezone)) continue;
        try {
          if (channel.channelType === "discord" && channel.discordWebhookUrl) {
            await sendDiscordMessage(channel.discordWebhookUrl, {
              embeds: [
                {
                  title: `🤖 ${greeting}`,
                  description: result.summary,
                  color: result.warnings.length > 0 ? 0xf59e0b : 0x8b5cf6,
                  fields: discordFields,
                  footer: { text: t("slack.aiFooter") },
                  timestamp: new Date().toISOString(),
                },
              ],
            });
          } else if (
            channel.channelType === "slack" &&
            channel.slackWebhookUrl
          ) {
            const slackFocusLines = focusLines
              .replace(/\*\*/g, "*")
              .replace(/_([^_]+)_/g, "_$1_");

            await sendSlackMessage(channel.slackWebhookUrl, {
              blocks: [
                {
                  type: "header",
                  text: {
                    type: "plain_text",
                    text: `🤖 ${greeting}`,
                  },
                },
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: result.summary,
                  },
                },
                { type: "divider" },
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*${t("slack.aiFocusBlock")}:*\n${slackFocusLines}`,
                  },
                },
                ...(warningLines
                  ? [
                      {
                        type: "section" as const,
                        text: {
                          type: "mrkdwn" as const,
                          text: `*${t("slack.aiWarningsBlock")}:*\n${warningLines.replace(/\*\*/g, "*")}`,
                        },
                      },
                    ]
                  : []),
              ],
            });
          }
        } catch (channelError) {
          console.error(
            `Failed to send AI suggestion to ${channel.channelType}:`,
            channelError,
          );
        }
      }

      sentCount++;
    } catch (userError) {
      errors.push(
        `User ${user.id}: ${userError instanceof Error ? userError.message : "Unknown error"}`,
      );
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/ai-suggestions",
      type: "cron",
    });
  }

  return {
    itemsProcessed: allUsers.length,
    itemsSucceeded: sentCount,
    itemsFailed: errors.length,
    metadata: errors.length > 0 ? { errors } : undefined,
  };
});
