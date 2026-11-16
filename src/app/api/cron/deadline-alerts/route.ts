import { and, between, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { notificationChannels, projects, tasks, users } from "@/lib/db/schema";
import { mailT, normalizeMailLocale } from "@/lib/email/locale";
import {
  sendDiscordMessage,
  sendSlackMessage,
} from "@/lib/integrations/notifications";
import {
  getQuietHoursPrefs,
  isChannelActiveToday,
  isWithinQuietHours,
} from "@/lib/notifications";
import {
  type PushSubscription as PushSub,
  sendPushNotification,
} from "@/lib/notifications/push";
import { decryptChannelWebhooks } from "@/lib/notifications/webhook-secrets";
import {
  type ProjectEndDateState,
  projectEndDateState,
  shouldNotifyProjectEndDate,
} from "@/lib/projects/timeline";
import { deadlineRecipientIs } from "@/lib/tasks/deadline-recipient";
import {
  addDaysToDateStr,
  copenhagenDayStart,
  copenhagenToday,
} from "@/lib/time/copenhagen";
import { resolveModules } from "@/lib/trpc/routers/enterprise/middleware";
import { captureRouteError } from "@/lib/utils/sentry";

type ActiveChannel = typeof notificationChannels.$inferSelect;

/** Projektets slutdato: én besked pr. kanal med op til 10 projekter (#213). */
async function sendProjectEndDateAlert(
  channels: ActiveChannel[],
  alert: {
    title: string;
    emoji: string;
    color: number;
    lines: string[];
    pushBody: string;
    tag: string;
    /** Modtagerens sprog (til sidefod og push) */
    locale: string;
  },
) {
  const t = mailT("notifications", alert.locale);
  const description = alert.lines.slice(0, 10).join("\n");
  for (const channel of channels) {
    try {
      if (channel.channelType === "discord" && channel.discordWebhookUrl) {
        await sendDiscordMessage(channel.discordWebhookUrl, {
          embeds: [
            {
              title: `${alert.emoji} ${alert.title}`,
              description,
              color: alert.color,
              footer: { text: t("deadlines.projFooter") },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      } else if (channel.channelType === "slack" && channel.slackWebhookUrl) {
        await sendSlackMessage(channel.slackWebhookUrl, {
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: `${alert.emoji} ${alert.title}`,
              },
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: description.replace(/\*\*/g, "*") },
            },
          ],
        });
      } else if (
        channel.channelType === "browser_push" &&
        channel.pushSubscription
      ) {
        await sendPushNotification({
          subscription: channel.pushSubscription as unknown as PushSub,
          title: `${alert.emoji} ${alert.title}`,
          body: alert.pushBody,
          url: "/dashboard/projects",
          tag: alert.tag,
          locale: alert.locale,
        });
      }
    } catch (channelError) {
      console.error(
        `Failed to send project end-date alert to ${channel.channelType}:`,
        channelError,
      );
    }
  }
}

// Cron schedule: 0 9 * * * (Every day at 09:00)

export const GET = withCronLogging("deadline-alerts", async (_request) => {
  const now = new Date();
  // Dansk dag uanset processens TZ (#649)
  const todayStr = copenhagenToday(now);
  const today = copenhagenDayStart(todayStr);
  const tomorrow = copenhagenDayStart(addDaysToDateStr(todayStr, 1));
  const threeDaysFromNow = copenhagenDayStart(addDaysToDateStr(todayStr, 3));

  // Kun brugere med mindst én aktiv kanal: løkken springer de andre over
  // alligevel, men først efter 2-3 opgave-/projektforespørgsler pr. bruger
  // (#1115).
  const allUsers = await db
    .select({ id: users.id, timezone: users.timezone, locale: users.locale })
    .from(users)
    .where(
      sql`exists (select 1 from ${notificationChannels} where ${notificationChannels.userId} = ${users.id} and ${notificationChannels.isEnabled} = true)`,
    );

  // Batch-load quiet-hours prefs once to avoid an N+1 in the loop.
  const quietHoursByUser = await getQuietHoursPrefs(allUsers.map((u) => u.id));

  let sentCount = 0;
  const errors: string[] = [];

  // Projektmodulets tilstand pr. org — ét opslag pr. org, ikke pr. bruger
  const projectsEnabledByOrg = new Map<string, boolean>();

  for (const user of allUsers) {
    try {
      const locale = normalizeMailLocale(user.locale);
      const t = mailT("notifications", locale);
      const orgId = await getUserOrgId(user.id);

      // Get tasks due today or tomorrow (deadline reminders).
      // Recipient = assignee, falling back to creator for unassigned (#211).
      const upcomingTasks = await db.query.tasks.findMany({
        where: and(
          deadlineRecipientIs(user.id),
          ...(orgId ? [eq(tasks.organizationId, orgId)] : []),
          between(tasks.deadline, today, threeDaysFromNow),
          or(
            eq(tasks.status, "backlog"),
            eq(tasks.status, "todo"),
            eq(tasks.status, "in_progress"),
          ),
        ),
        with: { project: true },
        orderBy: (tasks, { asc }) => [asc(tasks.deadline)],
      });

      // Get overdue tasks
      const overdueTasks = await db.query.tasks.findMany({
        where: and(
          deadlineRecipientIs(user.id),
          ...(orgId ? [eq(tasks.organizationId, orgId)] : []),
          lte(tasks.deadline, today),
          or(
            eq(tasks.status, "backlog"),
            eq(tasks.status, "todo"),
            eq(tasks.status, "in_progress"),
          ),
        ),
        with: { project: true },
        orderBy: (tasks, { asc }) => [asc(tasks.deadline)],
      });

      // Projekter tæt på/over slutdato (#213). Modtager = projektets ejer;
      // kun når projektmodulet er slået til. Datovinduet afgrænser
      // forespørgslen; shouldNotifyProjectEndDate vælger påmindelsesdagene.
      let projectsEnabled = true;
      if (orgId) {
        if (!projectsEnabledByOrg.has(orgId)) {
          projectsEnabledByOrg.set(
            orgId,
            (await resolveModules(db, orgId)).isEnabled("projects"),
          );
        }
        projectsEnabled = projectsEnabledByOrg.get(orgId) ?? true;
      }
      const endingProjects: {
        name: string;
        state: Exclude<ProjectEndDateState, null>;
      }[] = [];
      if (projectsEnabled) {
        const candidates = await db.query.projects.findMany({
          where: and(
            eq(projects.userId, user.id),
            ...(orgId ? [eq(projects.organizationId, orgId)] : []),
            eq(projects.status, "active"),
            isNotNull(projects.endDate),
            gte(
              projects.endDate,
              copenhagenDayStart(addDaysToDateStr(todayStr, -31)),
            ),
            lte(
              projects.endDate,
              copenhagenDayStart(addDaysToDateStr(todayStr, 8)),
            ),
          ),
          columns: { name: true, status: true, endDate: true },
          orderBy: (projects, { asc }) => [asc(projects.endDate)],
        });
        for (const project of candidates) {
          const state = projectEndDateState(project, todayStr);
          if (state && shouldNotifyProjectEndDate(state)) {
            endingProjects.push({ name: project.name, state });
          }
        }
      }
      const overdueProjects = endingProjects.filter(
        (p) => p.state.kind === "overdue",
      );
      const soonProjects = endingProjects.filter(
        (p) => p.state.kind === "soon",
      );

      // Skip if nothing to notify about
      if (
        upcomingTasks.length === 0 &&
        overdueTasks.length === 0 &&
        endingProjects.length === 0
      )
        continue;

      // Get notification channels
      const channels = await db
        .select()
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.userId, user.id),
            eq(notificationChannels.isEnabled, true),
          ),
        );

      if (channels.length === 0) continue;

      // Respect quiet hours for intrusive realtime channels.
      if (
        isWithinQuietHours(quietHoursByUser.get(user.id), now, user.timezone)
      ) {
        continue;
      }

      // Filter channels to only those active today (per user's weekday config,
      // resolved in user's timezone)
      const activeChannels = decryptChannelWebhooks(channels).filter((ch) =>
        isChannelActiveToday(ch, now, user.timezone),
      );

      if (activeChannels.length === 0) continue;

      // Send overdue alerts
      if (overdueTasks.length > 0) {
        const overdueChannels = activeChannels.filter(
          (ch) => ch.sendOverdueAlerts,
        );

        if (overdueChannels.length > 0) {
          const taskList = overdueTasks
            .slice(0, 10)
            .map((task) => {
              const daysOverdue = Math.floor(
                (today.getTime() - new Date(task.deadline ?? today).getTime()) /
                  (1000 * 60 * 60 * 24),
              );
              const project = task.project?.name || t("deadlines.noProject");
              return t("deadlines.overdueLine", {
                title: task.title,
                project,
                days: daysOverdue,
              });
            })
            .join("\n");

          const title = t("deadlines.overdueTitle", {
            count: overdueTasks.length,
          });

          for (const channel of overdueChannels) {
            try {
              if (
                channel.channelType === "discord" &&
                channel.discordWebhookUrl
              ) {
                await sendDiscordMessage(channel.discordWebhookUrl, {
                  embeds: [
                    {
                      title: `🚨 ${title}`,
                      description: taskList,
                      color: 0xef4444,
                      footer: { text: t("deadlines.overdueFooter") },
                      timestamp: new Date().toISOString(),
                    },
                  ],
                });
              } else if (
                channel.channelType === "slack" &&
                channel.slackWebhookUrl
              ) {
                await sendSlackMessage(channel.slackWebhookUrl, {
                  blocks: [
                    {
                      type: "header",
                      text: {
                        type: "plain_text",
                        text: `🚨 ${title}`,
                      },
                    },
                    {
                      type: "section",
                      text: {
                        type: "mrkdwn",
                        text: taskList.replace(/\*\*/g, "*"),
                      },
                    },
                  ],
                });
              } else if (
                channel.channelType === "browser_push" &&
                channel.pushSubscription
              ) {
                await sendPushNotification({
                  subscription: channel.pushSubscription as unknown as PushSub,
                  title: `🚨 ${title}`,
                  body: overdueTasks
                    .slice(0, 3)
                    .map((task) => task.title)
                    .join(", "),
                  url: "/dashboard/tasks",
                  tag: "overdue-alert",
                  locale,
                });
              }
            } catch (channelError) {
              console.error(
                `Failed to send overdue alert to ${channel.channelType}:`,
                channelError,
              );
            }
          }
        }
      }

      // Send deadline reminders for upcoming tasks
      if (upcomingTasks.length > 0) {
        const reminderChannels = activeChannels.filter(
          (ch) => ch.sendDeadlineReminders,
        );

        if (reminderChannels.length > 0) {
          const taskList = upcomingTasks
            .slice(0, 10)
            .map((task) => {
              const deadline = new Date(task.deadline ?? today);
              const isToday = deadline >= today && deadline < tomorrow;
              const daysUntil = Math.ceil(
                (deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
              );
              const whenText = isToday
                ? t("deadlines.whenToday")
                : daysUntil === 1
                  ? t("deadlines.whenTomorrow")
                  : t("deadlines.whenDays", { days: daysUntil });
              const project = task.project?.name || t("deadlines.noProject");
              return t("deadlines.upcomingLine", {
                title: task.title,
                project,
                when: whenText,
              });
            })
            .join("\n");

          const title = t("deadlines.upcomingTitle", {
            count: upcomingTasks.length,
          });

          for (const channel of reminderChannels) {
            try {
              if (
                channel.channelType === "discord" &&
                channel.discordWebhookUrl
              ) {
                await sendDiscordMessage(channel.discordWebhookUrl, {
                  embeds: [
                    {
                      title: `⏰ ${title}`,
                      description: taskList,
                      color: 0xf59e0b,
                      footer: { text: t("deadlines.upcomingFooter") },
                      timestamp: new Date().toISOString(),
                    },
                  ],
                });
              } else if (
                channel.channelType === "slack" &&
                channel.slackWebhookUrl
              ) {
                await sendSlackMessage(channel.slackWebhookUrl, {
                  blocks: [
                    {
                      type: "header",
                      text: {
                        type: "plain_text",
                        text: `⏰ ${title}`,
                      },
                    },
                    {
                      type: "section",
                      text: {
                        type: "mrkdwn",
                        text: taskList.replace(/\*\*/g, "*"),
                      },
                    },
                  ],
                });
              } else if (
                channel.channelType === "browser_push" &&
                channel.pushSubscription
              ) {
                await sendPushNotification({
                  subscription: channel.pushSubscription as unknown as PushSub,
                  title: `⏰ ${title}`,
                  body: upcomingTasks
                    .slice(0, 3)
                    .map((task) => task.title)
                    .join(", "),
                  url: "/dashboard/tasks",
                  tag: "deadline-reminder",
                  locale,
                });
              }
            } catch (channelError) {
              console.error(
                `Failed to send deadline reminder to ${channel.channelType}:`,
                channelError,
              );
            }
          }
        }
      }

      // Projekt-slutdatoer: overskredne via "overskredet"-kanaler, kommende
      // via påmindelseskanaler — samme valg som for opgaver
      if (overdueProjects.length > 0) {
        const channels = activeChannels.filter((ch) => ch.sendOverdueAlerts);
        if (channels.length > 0) {
          await sendProjectEndDateAlert(channels, {
            locale,
            title: t("deadlines.projOverdueTitle", {
              count: overdueProjects.length,
            }),
            emoji: "🚨",
            color: 0xef4444,
            lines: overdueProjects.map((p) => {
              const n = p.state.kind === "overdue" ? p.state.daysOverdue : 0;
              return t("deadlines.projOverdueLine", { name: p.name, days: n });
            }),
            pushBody: overdueProjects
              .slice(0, 3)
              .map((p) => p.name)
              .join(", "),
            tag: "project-overdue",
          });
        }
      }
      if (soonProjects.length > 0) {
        const channels = activeChannels.filter(
          (ch) => ch.sendDeadlineReminders,
        );
        if (channels.length > 0) {
          await sendProjectEndDateAlert(channels, {
            locale,
            title: t("deadlines.projSoonTitle", { count: soonProjects.length }),
            emoji: "⏰",
            color: 0xf59e0b,
            lines: soonProjects.map((p) => {
              const n = p.state.kind === "soon" ? p.state.daysLeft : 0;
              const when =
                n === 0
                  ? t("deadlines.whenToday")
                  : n === 1
                    ? t("deadlines.whenTomorrow")
                    : t("deadlines.whenDays", { days: n });
              return t("deadlines.projSoonLine", { name: p.name, when });
            }),
            pushBody: soonProjects
              .slice(0, 3)
              .map((p) => p.name)
              .join(", "),
            tag: "project-end-soon",
          });
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
      route: "/api/cron/deadline-alerts",
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
