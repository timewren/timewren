import { createElement } from "react";
import {
  TaskNotificationEmail,
  type TaskNotificationEmailProps,
} from "@/components/email/TaskNotificationEmail";
import { toIntlLocale } from "@/i18n/format-locale";
import { brand } from "@/lib/brand";
import { getAppUrl, getEmailDomain } from "@/lib/config";
import { mailT, normalizeMailLocale } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { renderEmail } from "@/lib/email/render-email";
import { resend } from "@/lib/resend";

const FROM_EMAIL =
  process.env.FROM_EMAIL || `${brand.name} <noreply@${getEmailDomain()}>`;
const APP_URL = getAppUrl();

export type EmailTemplate =
  | "daily_digest"
  | "deadline_reminder"
  | "overdue_alert"
  | "weekly_review"
  | "ai_suggestion"
  | "general";

interface EmailNotificationParams {
  to: string;
  name: string;
  template: EmailTemplate;
  subject: string;
  data: Record<string, unknown>;
  /** Modtagerens sprog; standard dansk */
  locale?: string;
}

/**
 * Send an email notification
 */
export async function sendEmailNotification(
  params: EmailNotificationParams,
): Promise<void> {
  const { to, name, template, subject, data } = params;
  const locale = normalizeMailLocale(params.locale);
  const mb = await resolveMailBrand({ email: to });

  const { html, text } = await renderEmail(
    createElement(TaskNotificationEmail, {
      ...toEmailProps(template, name, data, locale, mb?.appUrl ?? APP_URL),
      locale,
      mailBrand: mb,
    }),
  );

  await resend.emails.send({
    from: mb?.from ?? FROM_EMAIL,
    to,
    subject,
    html,
    text,
  });
}

type TaskList = Array<{
  title: string;
  projectName?: string;
  priority?: string;
  deadline?: string;
}>;

/** Oversætter de løse notifikationsdata til mailskabelonens props. */
function toEmailProps(
  template: EmailTemplate,
  name: string,
  data: Record<string, unknown>,
  locale: string,
  appUrl: string,
): TaskNotificationEmailProps {
  const tasksUrl = `${appUrl}/dashboard/tasks`;
  switch (template) {
    case "daily_digest":
      return {
        kind: "daily_digest",
        name,
        dateLabel: new Date().toLocaleDateString(toIntlLocale(locale), {
          timeZone: "Europe/Copenhagen",
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
        tasksToday: (data.tasksToday as TaskList) || [],
        overdueCount: ((data.overdueTasks as TaskList) || []).length,
        completedYesterday: (data.completedYesterday as number) || 0,
        tasksUrl,
      };
    case "deadline_reminder":
      return {
        kind: "deadline_reminder",
        name,
        task: data.task as TaskList[number] | undefined,
        tasksUrl,
      };
    case "overdue_alert":
      return {
        kind: "overdue_alert",
        name,
        tasks: (data.tasks as TaskList) || [],
        tasksUrl,
      };
    case "weekly_review": {
      const stats = data.stats as
        | { tasksCompleted: number; hoursTracked: number; tasksCreated: number }
        | undefined;
      return {
        kind: "weekly_review",
        name,
        tasksCompleted: stats?.tasksCompleted || 0,
        hoursTracked: stats?.hoursTracked || 0,
        tasksCreated: stats?.tasksCreated || 0,
        dashboardUrl: `${appUrl}/dashboard`,
      };
    }
    case "ai_suggestion":
      return {
        kind: "ai_suggestion",
        name,
        suggestion:
          (data.suggestion as string) || (data.message as string) || "",
        tasksUrl,
      };
    default:
      return {
        kind: "general",
        name,
        message: (data.message as string) || "",
        url: data.url as string | undefined,
      };
  }
}

/**
 * Send daily digest email
 */
export async function sendDailyDigestEmail(
  to: string,
  name: string,
  data: {
    tasksToday: Array<{
      title: string;
      projectName?: string;
      priority?: string;
      deadline?: string;
    }>;
    overdueTasks: Array<{
      title: string;
      projectName?: string;
    }>;
    completedYesterday: number;
  },
  locale?: string,
): Promise<void> {
  const resolved = normalizeMailLocale(locale);
  const mb = await resolveMailBrand({ email: to });
  await sendEmailNotification({
    to,
    name,
    template: "daily_digest",
    locale: resolved,
    subject: mailT(
      "notifications",
      resolved,
      mb?.key,
    )("taskDigestSubject", {
      date: new Date().toLocaleDateString(toIntlLocale(resolved), {
        timeZone: "Europe/Copenhagen",
      }),
    }),
    data,
  });
}
