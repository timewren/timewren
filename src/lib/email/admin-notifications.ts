import { createElement } from "react";
import { AdminNotificationEmail } from "@/components/email/AdminNotificationEmail";
import { toIntlLocale } from "@/i18n/format-locale";
import { mailT } from "@/lib/email/locale";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { renderEmail } from "./render-email";

interface AdminNotificationEmailParams {
  to: string;
  subject: string;
  eventTitle: string;
  userName?: string;
  userEmail?: string;
  userId?: string;
  planName?: string;
  daysLeft?: number;
  reason?: string;
  userLink?: string;
}

/**
 * Send an admin notification email.
 * Rendered with EmailShell (React escapes all values).
 */
export async function sendAdminNotificationEmail(
  params: AdminNotificationEmailParams,
): Promise<void> {
  if (!isMailAvailable()) {
    console.error("[Admin Email] RESEND_API_KEY not configured, skipping");
    return;
  }

  const {
    to,
    subject,
    eventTitle,
    userName,
    userEmail,
    planName,
    daysLeft,
    reason,
    userLink,
  } = params;

  const locale = await getRecipientLocale({ email: to });
  const t = mailT("emailsReports", locale);
  const timestamp = new Date().toLocaleString(toIntlLocale(locale), {
    timeZone: "Europe/Copenhagen",
    dateStyle: "long",
    timeStyle: "short",
  });

  const rows: { label: string; value: string }[] = [];
  if (userName) rows.push({ label: t("admin.rowName"), value: userName });
  if (userEmail) rows.push({ label: t("admin.rowMail"), value: userEmail });
  if (planName) rows.push({ label: t("admin.rowPlan"), value: planName });
  if (daysLeft !== undefined)
    rows.push({ label: t("admin.rowDaysLeft"), value: String(daysLeft) });
  if (reason) rows.push({ label: t("admin.rowReason"), value: reason });
  rows.push({ label: t("admin.rowTime"), value: timestamp });

  const { html, text } = await renderEmail(
    createElement(AdminNotificationEmail, {
      eventTitle,
      rows,
      userLink,
      locale,
    }),
  );

  const response = await resend.emails.send({
    from: DEFAULT_FROM_EMAIL,
    to,
    subject,
    html,
    text,
  });

  if (response.error) {
    throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
  }
}
