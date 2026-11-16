import { render } from "@react-email/render";
import { createElement } from "react";
import { CancellationConfirmedEmail } from "@/components/email/CancellationConfirmedEmail";
import { PaymentFailedEmail } from "@/components/email/PaymentFailedEmail";
import { PaymentReminderEmail } from "@/components/email/PaymentReminderEmail";
import {
  TrialEndingEmail,
  trialWhen,
} from "@/components/email/TrialEndingEmail";
import { mailT } from "@/lib/email/locale";
import { brandUrl, resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { logEmailSkipped, withEmailLogging } from "./logger";

// ─── Payment Failed ─────────────────────────────────────────────────

interface SendPaymentFailedEmailParams {
  to: string;
  userName: string;
  amountDue: string;
  billingPortalUrl: string;
  userId?: string;
}

export async function sendPaymentFailedEmail({
  to,
  userName,
  amountDue,
  billingPortalUrl,
  userId,
}: SendPaymentFailedEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const logContext = {
    emailType: "payment_failed" as const,
    to,
    amountDue,
  };

  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    return;
  }

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsBilling", locale, mb?.key);

  const emailHtml = await render(
    createElement(PaymentFailedEmail, {
      mailBrand: mb,
      locale,
      userName,
      amountDue,
      billingPortalUrl: brandUrl(billingPortalUrl, mb),
    }),
  );

  const subject = t("paymentFailed.subject");

  return withEmailLogging(
    { ...logContext, subject },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
      });

      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }

      return response;
    },
    userId ? { userId, emailType: "payment_failed" } : undefined,
  );
}

// ─── Trial Ending ───────────────────────────────────────────────────

interface SendTrialEndingEmailParams {
  to: string;
  userName: string;
  daysRemaining: number;
  upgradeUrl: string;
  userId?: string;
  /**
   * Optional template key persisted in email_delivery_logs. Defaults to
   * "trial_ending" (Alunta-driven). Use e.g. "trial_reminder_7d" /
   * "trial_reminder_1d" when you want to dedupe independently per cadence.
   */
  templateKey?: string;
}

export async function sendTrialEndingEmail({
  to,
  userName,
  daysRemaining,
  upgradeUrl,
  userId,
  templateKey = "trial_ending",
}: SendTrialEndingEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const logContext = {
    emailType: "trial_ending" as const,
    to,
    daysRemaining,
  };

  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    return;
  }

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsBilling", locale, mb?.key);

  const emailHtml = await render(
    createElement(TrialEndingEmail, {
      mailBrand: mb,
      locale,
      userName,
      daysRemaining,
      upgradeUrl: brandUrl(upgradeUrl, mb),
    }),
  );

  const when = trialWhen(daysRemaining, locale);
  const subject = t("trial.subject", { when });

  return withEmailLogging(
    { ...logContext, subject },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
      });

      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }

      return response;
    },
    userId
      ? {
          userId,
          emailType: templateKey as
            | "trial_ending"
            | "trial_reminder_7d"
            | "trial_reminder_1d",
        }
      : undefined,
  );
}

// ─── Cancellation Confirmed ─────────────────────────────────────────

interface SendCancellationConfirmedEmailParams {
  to: string;
  userName: string;
  endDate: string;
  reactivateUrl: string;
  userId?: string;
}

export async function sendCancellationConfirmedEmail({
  to,
  userName,
  endDate,
  reactivateUrl,
  userId,
}: SendCancellationConfirmedEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const logContext = {
    emailType: "cancellation_confirmed" as const,
    to,
  };

  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    return;
  }

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsBilling", locale, mb?.key);

  const emailHtml = await render(
    createElement(CancellationConfirmedEmail, {
      mailBrand: mb,
      locale,
      userName,
      endDate,
      reactivateUrl: brandUrl(reactivateUrl, mb),
    }),
  );

  const subject = t("cancel.subject");

  return withEmailLogging(
    { ...logContext, subject },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
      });

      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }

      return response;
    },
    userId ? { userId, emailType: "cancellation_confirmed" } : undefined,
  );
}

// ─── Payment Reminder (Dunning) ─────────────────────────────────────

interface SendPaymentReminderEmailParams {
  to: string;
  userName: string;
  urgency: "warning" | "urgent";
  daysOverdue: number;
  billingPortalUrl: string;
  userId?: string;
}

export async function sendPaymentReminderEmail({
  to,
  userName,
  urgency,
  daysOverdue,
  billingPortalUrl,
  userId,
}: SendPaymentReminderEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  // Typen pr. niveau lader dunning-cron'en deduplikere uden at læse det
  // oversatte emne (#1108).
  const emailType =
    urgency === "urgent"
      ? ("dunning_urgent" as const)
      : ("dunning_warning" as const);
  const logContext = {
    emailType,
    to,
    urgency,
    daysOverdue,
  };

  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    return;
  }

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsBilling", locale, mb?.key);

  const emailHtml = await render(
    createElement(PaymentReminderEmail, {
      mailBrand: mb,
      locale,
      userName,
      urgency,
      daysOverdue,
      billingPortalUrl: brandUrl(billingPortalUrl, mb),
    }),
  );

  const subject =
    urgency === "urgent"
      ? t("paymentReminder.subjectUrgent")
      : t("paymentReminder.subjectWarning");

  return withEmailLogging(
    { ...logContext, subject },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
      });

      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }

      return response;
    },
    userId ? { userId, emailType } : undefined,
  );
}
