import { render } from "@react-email/render";
import { createElement } from "react";
import { FirstClientEmail } from "@/components/email/FirstClientEmail";
import { FirstInvoiceEmail } from "@/components/email/FirstInvoiceEmail";
import { FirstProjectEmail } from "@/components/email/FirstProjectEmail";
import { FirstTimeEntryEmail } from "@/components/email/FirstTimeEntryEmail";
import { InactivityEmail } from "@/components/email/InactivityEmail";
import { getPersonalReplyTo } from "@/lib/config";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, PERSONAL_FROM_EMAIL, resend } from "@/lib/resend";
import { appUrlEnv } from "@/lib/runtime-env";
import { withEmailLogging } from "./logger";
import { buildUnsubscribeHeaders } from "./unsubscribe";

interface InactivityEmailParams {
  to: string;
  userName: string;
  daysSinceLastActivity: number;
  unbilledHours?: number;
  unbilledValue?: number;
  pendingTasks?: number;
  userId?: string;
}

export async function sendInactivityEmail({
  to,
  userName,
  daysSinceLastActivity,
  unbilledHours,
  unbilledValue,
  pendingTasks,
  userId,
}: InactivityEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error("Email service not configured.");
  }

  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);

  const emailHtml = await render(
    createElement(InactivityEmail, {
      mailBrand: mb,
      locale,
      userName,
      daysSinceLastActivity,
      unbilledHours,
      unbilledValue,
      pendingTasks,
      dashboardUrl,
    }),
  );

  const subject = t("inactivity.subject", { days: daysSinceLastActivity });

  return withEmailLogging(
    { emailType: "inactivity", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
        headers: userId
          ? buildUnsubscribeHeaders(userId, mb?.appUrl)
          : undefined,
      });

      if (response.error) {
        throw new Error(
          `Failed to send inactivity email: ${response.error.message}`,
        );
      }

      return response;
    },
    userId ? { userId, emailType: "inactivity" } : undefined,
  );
}

// Onboarding Milestone Emails

interface FirstClientEmailParams {
  to: string;
  userName: string;
  clientName: string;
  userId?: string;
}

export async function sendFirstClientEmail({
  to,
  userName,
  clientName,
  userId,
}: FirstClientEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error("Email service not configured.");
  }

  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);

  const emailHtml = await render(
    createElement(FirstClientEmail, {
      mailBrand: mb,
      locale,
      userName,
      clientName,
      dashboardUrl,
    }),
  );

  const subject = t("firstClient.subject");

  return withEmailLogging(
    { emailType: "first_client", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: userId
          ? buildUnsubscribeHeaders(userId, mb?.appUrl)
          : undefined,
      });

      if (response.error) {
        console.error("Resend error:", response.error);
        throw new Error("Failed to send first client email");
      }

      return response;
    },
    userId ? { userId, emailType: "first_client" } : undefined,
  );
}

interface FirstProjectEmailParams {
  to: string;
  userName: string;
  projectName: string;
  clientName: string;
  userId?: string;
}

export async function sendFirstProjectEmail({
  to,
  userName,
  projectName,
  clientName,
  userId,
}: FirstProjectEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error("Email service not configured.");
  }

  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);

  const emailHtml = await render(
    createElement(FirstProjectEmail, {
      mailBrand: mb,
      locale,
      userName,
      projectName,
      clientName,
      dashboardUrl,
    }),
  );

  const subject = t("firstProject.subject");

  return withEmailLogging(
    { emailType: "first_project", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: userId
          ? buildUnsubscribeHeaders(userId, mb?.appUrl)
          : undefined,
      });

      if (response.error) {
        console.error("Resend error:", response.error);
        throw new Error("Failed to send first project email");
      }

      return response;
    },
    userId ? { userId, emailType: "first_project" } : undefined,
  );
}

interface FirstTimeEntryEmailParams {
  to: string;
  userName: string;
  hours: string;
  projectName?: string;
  userId?: string;
}

export async function sendFirstTimeEntryEmail({
  to,
  userName,
  hours,
  projectName,
  userId,
}: FirstTimeEntryEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error("Email service not configured.");
  }

  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);

  const emailHtml = await render(
    createElement(FirstTimeEntryEmail, {
      mailBrand: mb,
      locale,
      userName,
      hours,
      projectName,
      dashboardUrl,
    }),
  );

  const subject = t("firstTimeEntry.subject");

  return withEmailLogging(
    { emailType: "first_time_entry", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: userId
          ? buildUnsubscribeHeaders(userId, mb?.appUrl)
          : undefined,
      });

      if (response.error) {
        console.error("Resend error:", response.error);
        throw new Error("Failed to send first time entry email");
      }

      return response;
    },
    userId ? { userId, emailType: "first_time_entry" } : undefined,
  );
}

interface FirstInvoiceEmailParams {
  to: string;
  userName: string;
  invoiceNumber: string;
  amount: string;
  clientName: string;
  userId?: string;
}

export async function sendFirstInvoiceEmail({
  to,
  userName,
  invoiceNumber,
  amount,
  clientName,
  userId,
}: FirstInvoiceEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error("Email service not configured.");
  }

  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);

  const emailHtml = await render(
    createElement(FirstInvoiceEmail, {
      mailBrand: mb,
      locale,
      userName,
      invoiceNumber,
      amount,
      clientName,
      dashboardUrl,
    }),
  );

  const subject = t("firstInvoice.subject");

  return withEmailLogging(
    { emailType: "first_invoice", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: userId
          ? buildUnsubscribeHeaders(userId, mb?.appUrl)
          : undefined,
      });

      if (response.error) {
        console.error("Resend error:", response.error);
        throw new Error("Failed to send first invoice email");
      }

      return response;
    },
    userId ? { userId, emailType: "first_invoice" } : undefined,
  );
}
