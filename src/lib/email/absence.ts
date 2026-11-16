import { render } from "@react-email/render";
import { createElement } from "react";
import { TimesheetNotificationEmail } from "@/components/email/TimesheetNotificationEmail";
import { getAppUrl } from "@/lib/config";
import { formatMailHours, formatMailPeriod, mailT } from "@/lib/email/locale";
import { type MailBrand, resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { type EmailType, logEmailSkipped, withEmailLogging } from "./logger";

const ABSENCE_URL = "/dashboard/enterprise/absence";

import {
  formatAbsenceDate,
  formatAbsencePeriod,
} from "@/lib/enterprise/absence-format";

export { formatAbsenceDate, formatAbsencePeriod };

function formatDays(
  days: number | null | undefined,
  t: ReturnType<typeof mailT>,
): string | null {
  if (days == null || !(days > 0)) return null;
  return t("absence.days", { days });
}

async function sendAbsenceEmail(params: {
  to: string;
  userId: string;
  emailType: EmailType;
  subject: string;
  recipientName: string;
  heading: string;
  bodyLines: string[];
  highlight?: string;
  ctaLabel: string;
  locale?: string;
  mb?: MailBrand;
}) {
  const logContext = { emailType: params.emailType, to: params.to };
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
      ctaUrl: `${params.mb?.appUrl ?? getAppUrl()}${ABSENCE_URL}`,
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

/** Til leder/admin når en medarbejder anmoder om fravær der kræver godkendelse. */
export async function sendAbsenceRequestedEmail(params: {
  to: string;
  managerName: string;
  employeeName: string;
  typeName: string;
  startDate: string;
  endDate: string | null;
  totalDays: number | null;
  note?: string | null;
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
  const period = formatMailPeriod(params.startDate, params.endDate, locale);
  const days = formatDays(params.totalDays, t);
  return sendAbsenceEmail({
    locale,
    mb,
    to: params.to,
    userId: params.userId,
    emailType: "absence_requested",
    subject: t("absence.requestedSubject", {
      employee: params.employeeName,
      type: params.typeName.toLowerCase(),
      period,
    }),
    recipientName: params.managerName,
    heading: t("absence.requestedHeading"),
    bodyLines: [
      days
        ? t("absence.requestedBodyDays", {
            employee: params.employeeName,
            type: params.typeName.toLowerCase(),
            period,
            days,
          })
        : t("absence.requestedBody", {
            employee: params.employeeName,
            type: params.typeName.toLowerCase(),
            period,
          }),
      t("absence.requestedBody2"),
    ],
    highlight: params.note
      ? t("absence.note", { note: params.note })
      : undefined,
    ctaLabel: t("absence.open"),
  });
}

/** Til medarbejderen når anmodningen godkendes eller afvises. */
export async function sendAbsenceDecidedEmail(params: {
  to: string;
  employeeName: string;
  managerName: string;
  typeName: string;
  startDate: string;
  endDate: string | null;
  decision: "approved" | "rejected";
  rejectionReason?: string | null;
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
  const period = formatMailPeriod(params.startDate, params.endDate, locale);
  const approved = params.decision === "approved";
  const type = params.typeName.toLowerCase();
  const values = { manager: params.managerName, type, period };
  return sendAbsenceEmail({
    locale,
    mb,
    to: params.to,
    userId: params.userId,
    emailType: approved ? "absence_approved" : "absence_rejected",
    subject: approved
      ? t("absence.approvedSubject", { period })
      : t("absence.rejectedSubject", { period }),
    recipientName: params.employeeName,
    heading: approved
      ? t("absence.approvedHeading")
      : t("absence.rejectedHeading"),
    bodyLines: approved
      ? [t("absence.approvedBody", values)]
      : [t("absence.rejectedBody", values)],
    highlight:
      !approved && params.rejectionReason
        ? t("timesheet.reason", { reason: params.rejectionReason })
        : undefined,
    ctaLabel: t("absence.open"),
  });
}

/** Til medarbejderen når lederen registrerer fravær på vedkommendes vegne. */
export async function sendAbsenceRegisteredEmail(params: {
  to: string;
  employeeName: string;
  registrarName: string;
  typeName: string;
  startDate: string;
  endDate: string | null;
  hoursPerDay?: number | null;
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
  const period = formatMailPeriod(params.startDate, params.endDate, locale);
  const type = params.typeName.toLowerCase();
  const partial =
    params.hoursPerDay != null && params.hoursPerDay > 0
      ? t("absence.hoursPerDay", {
          hours: formatMailHours(params.hoursPerDay, locale),
        })
      : null;
  return sendAbsenceEmail({
    locale,
    mb,
    to: params.to,
    userId: params.userId,
    emailType: "absence_registered",
    subject: t("absence.registeredSubject", {
      registrar: params.registrarName,
      type,
      period,
    }),
    recipientName: params.employeeName,
    heading: t("absence.registeredHeading"),
    bodyLines: [
      partial
        ? t("absence.registeredBodyPartial", {
            registrar: params.registrarName,
            type,
            period,
            partial,
          })
        : t("absence.registeredBody", {
            registrar: params.registrarName,
            type,
            period,
          }),
      params.endDate
        ? t("absence.registeredClosed")
        : t("absence.registeredOpen"),
    ],
    ctaLabel: t("absence.open"),
  });
}
