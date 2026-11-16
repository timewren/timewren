import { render } from "@react-email/render";
import { createElement } from "react";
import { TimesheetNotificationEmail } from "@/components/email/TimesheetNotificationEmail";
import { getAppUrl } from "@/lib/config";
import { formatMailHours, mailT } from "@/lib/email/locale";
import {
  brandUrl,
  type MailBrand,
  resolveMailBrand,
} from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { type EmailType, logEmailSkipped, withEmailLogging } from "./logger";

function weekNumber(weekStart: string): number {
  const [y, m, d] = weekStart.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNo =
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    );
  return weekNo;
}

export async function sendTimesheetEmail(params: {
  to: string;
  userId: string;
  emailType: EmailType;
  subject: string;
  recipientName: string;
  heading: string;
  bodyLines: string[];
  highlight?: string;
  ctaLabel: string;
  ctaUrl: string;
  locale?: string;
  mb?: MailBrand;
}) {
  const logContext = {
    emailType: params.emailType,
    to: params.to,
  };
  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    return null;
  }

  const html = await render(
    createElement(TimesheetNotificationEmail, {
      mailBrand: params.mb,
      locale: params.locale,
      recipientName: params.recipientName,
      heading: params.heading,
      bodyLines: params.bodyLines,
      highlight: params.highlight,
      ctaLabel: params.ctaLabel,
      ctaUrl: brandUrl(params.ctaUrl, params.mb),
    }),
  );

  return withEmailLogging(
    { ...logContext, subject: params.subject },
    async () => {
      const response = await resend.emails.send({
        from: params.mb?.from ?? DEFAULT_FROM_EMAIL,
        to: params.to,
        subject: params.subject,
        html,
      });
      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }
      return response;
    },
    { userId: params.userId, emailType: params.emailType },
  );
}

/** Til lederen når en medarbejder indsender sin uge. */
export async function sendTimesheetSubmittedEmail(params: {
  to: string;
  managerName: string;
  employeeName: string;
  weekStart: string;
  totalHours: number;
  userId: string;
}) {
  const mb = await resolveMailBrand({
    userId: params.userId,
    email: params.to,
  });
  const locale = await getRecipientLocale({
    userId: params.userId,
    email: params.to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsReports", locale, mb?.key);
  const week = t("timesheet.week", { week: weekNumber(params.weekStart) });
  return sendTimesheetEmail({
    locale,
    mb,
    to: params.to,
    userId: params.userId,
    emailType: "timesheet_submitted",
    subject: t("timesheet.submittedSubject", {
      employee: params.employeeName,
      week,
    }),
    recipientName: params.managerName,
    heading: t("timesheet.submittedHeading"),
    bodyLines: [
      t("timesheet.submittedBody1", {
        employee: params.employeeName,
        week,
        hours: formatMailHours(params.totalHours, locale),
      }),
      t("timesheet.submittedBody2"),
    ],
    ctaLabel: t("timesheet.submittedCta"),
    ctaUrl: `${mb?.appUrl ?? getAppUrl()}/dashboard/enterprise/team`,
  });
}

/** Fredags-påmindelse til medarbejderen om at indsende ugens timeseddel. */
export async function sendTimesheetReminderEmail(params: {
  to: string;
  employeeName: string;
  weekStart: string;
  registeredHours: number;
  userId: string;
}) {
  const mb = await resolveMailBrand({
    userId: params.userId,
    email: params.to,
  });
  const locale = await getRecipientLocale({
    userId: params.userId,
    email: params.to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsReports", locale, mb?.key);
  const week = t("timesheet.week", { week: weekNumber(params.weekStart) });
  return sendTimesheetEmail({
    locale,
    mb,
    to: params.to,
    userId: params.userId,
    emailType: "timesheet_reminder",
    subject: t("timesheet.reminderSubject", { week }),
    recipientName: params.employeeName,
    heading: t("timesheet.reminderHeading"),
    bodyLines: [
      params.registeredHours > 0
        ? t("timesheet.reminderBodyHours", {
            hours: formatMailHours(params.registeredHours, locale),
            week,
          })
        : t("timesheet.reminderBodyNone", { week }),
      t("timesheet.reminderBody2"),
    ],
    ctaLabel: t("timesheet.openTimesheet"),
    ctaUrl: `${mb?.appUrl ?? getAppUrl()}/dashboard/enterprise/timesheet`,
  });
}

/** Til medarbejderen når ugen godkendes eller afvises. */
export async function sendTimesheetDecisionEmail(params: {
  to: string;
  employeeName: string;
  managerName: string;
  weekStart: string;
  decision: "approved" | "rejected";
  rejectionReason?: string;
  userId: string;
}) {
  const mb = await resolveMailBrand({
    userId: params.userId,
    email: params.to,
  });
  const locale = await getRecipientLocale({
    userId: params.userId,
    email: params.to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsReports", locale, mb?.key);
  const week = t("timesheet.week", { week: weekNumber(params.weekStart) });
  const approved = params.decision === "approved";
  const values = { week, manager: params.managerName };
  return sendTimesheetEmail({
    locale,
    mb,
    to: params.to,
    userId: params.userId,
    emailType: `timesheet_${params.decision}`,
    subject: approved
      ? t("timesheet.approvedSubject", values)
      : t("timesheet.rejectedSubject", values),
    recipientName: params.employeeName,
    heading: approved
      ? t("timesheet.approvedHeading")
      : t("timesheet.rejectedHeading"),
    bodyLines: approved
      ? [t("timesheet.approvedBody", values)]
      : [t("timesheet.rejectedBody", values)],
    highlight:
      !approved && params.rejectionReason
        ? t("timesheet.reason", { reason: params.rejectionReason })
        : undefined,
    ctaLabel: t("timesheet.openTimesheet"),
    ctaUrl: `${mb?.appUrl ?? getAppUrl()}/dashboard/enterprise/timesheet`,
  });
}
