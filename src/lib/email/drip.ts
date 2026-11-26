import { render } from "@react-email/render";
import { createElement } from "react";
import { DripAiFeaturesEmail } from "@/components/email/DripAiFeaturesEmail";
import { DripClientNoKlippekortEmail } from "@/components/email/DripClientNoKlippekortEmail";
import { DripExtensionTipsEmail } from "@/components/email/DripExtensionTipsEmail";
import { DripFirstWeekStatsEmail } from "@/components/email/DripFirstWeekStatsEmail";
import { DripGettingStartedEmail } from "@/components/email/DripGettingStartedEmail";
import { DripKlippekortTipsEmail } from "@/components/email/DripKlippekortTipsEmail";
import { DripNeedHelpEmail } from "@/components/email/DripNeedHelpEmail";
import { DripNoTimeEntryEmail } from "@/components/email/DripNoTimeEntryEmail";
import { DripTimeNoInvoiceEmail } from "@/components/email/DripTimeNoInvoiceEmail";
import { DripUpgradeReminderEmail } from "@/components/email/DripUpgradeReminderEmail";
import { DripWelcomeEmail } from "@/components/email/DripWelcomeEmail";
import { DripWinBack30Email } from "@/components/email/DripWinBack30Email";
import { DripWinBack60Email } from "@/components/email/DripWinBack60Email";
import { toIntlLocale } from "@/i18n/format-locale";
import { getPersonalReplyTo } from "@/lib/config";
import { demoCurrencyForEmail } from "@/lib/demo/demo-mode";
import { mailT } from "@/lib/email/locale";
import { type MailBrand, resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isTestEmailRecipientOrAllow } from "@/lib/email/test-recipient";
import { PERSONAL_FROM_EMAIL, resend } from "@/lib/resend";
import { appUrlEnv } from "@/lib/runtime-env";
import { withEmailLogging } from "./logger";
import { renderEmail } from "./render-email";
import { buildUnsubscribeHeaders, buildUnsubscribeUrl } from "./unsubscribe";

interface DripEmailParams {
  to: string;
  userName: string;
  userId: string;
}

// ============================================
// 1a — Welcome (Day 0)
// ============================================

export async function sendDripWelcomeEmail({
  to,
  userName,
  userId,
}: DripEmailParams) {
  if (await isTestEmailRecipientOrAllow(to, userId)) return;
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const emailHtml = await render(
    createElement(DripWelcomeEmail, {
      mailBrand: mb,
      userName,
      dashboardUrl,
      locale,
    }),
  );

  const subject = t("welcome.subject", { name: userName });

  return withEmailLogging(
    { emailType: "drip_welcome", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error("Failed to send drip welcome email");
      }

      return response;
    },
    { userId, emailType: "drip_welcome" },
  );
}

// ============================================
// 1b — Getting Started (Day 3)
// ============================================

interface DripGettingStartedParams extends DripEmailParams {
  hasClient: boolean;
}

export async function sendDripGettingStartedEmail({
  to,
  userName,
  userId,
  hasClient,
}: DripGettingStartedParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const emailHtml = await render(
    createElement(DripGettingStartedEmail, {
      mailBrand: mb,
      locale,
      userName,
      hasClient,
      dashboardUrl,
    }),
  );

  const subject = t("gettingStarted.subject");

  return withEmailLogging(
    { emailType: "drip_getting_started", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error("Failed to send drip getting started email");
      }

      return response;
    },
    { userId, emailType: "drip_getting_started" },
  );
}

// ============================================
// 1c — Need Help (Day 7)
// ============================================

interface DripNeedHelpParams extends DripEmailParams {
  hasTimeEntries: boolean;
}

export async function sendDripNeedHelpEmail({
  to,
  userName,
  userId,
  hasTimeEntries,
}: DripNeedHelpParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const emailHtml = await render(
    createElement(DripNeedHelpEmail, {
      mailBrand: mb,
      locale,
      userName,
      hasTimeEntries,
      dashboardUrl,
    }),
  );

  const subject = t("needHelp.subject", { name: userName });

  return withEmailLogging(
    { emailType: "drip_need_help", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error("Failed to send drip need help email");
      }

      return response;
    },
    { userId, emailType: "drip_need_help" },
  );
}

// ============================================
// 2a — Extension Tips (Day 10)
// ============================================

export async function sendDripExtensionTipsEmail({
  to,
  userName,
  userId,
}: DripEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const emailHtml = await render(
    createElement(DripExtensionTipsEmail, {
      mailBrand: mb,
      userName,
      dashboardUrl,
      locale,
    }),
  );

  const subject = t("extensionTips.subject");

  return withEmailLogging(
    { emailType: "drip_extension_tips", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error("Failed to send drip extension tips email");
      }

      return response;
    },
    { userId, emailType: "drip_extension_tips" },
  );
}

// ============================================
// 2b — "Skriv hvad du lavede" (emailType drip_ai_features, Day 14)
// ============================================

export async function sendDripAiFeaturesEmail({
  to,
  userName,
  userId,
}: DripEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const emailHtml = await render(
    createElement(DripAiFeaturesEmail, {
      mailBrand: mb,
      userName,
      dashboardUrl,
      locale,
    }),
  );

  const subject = t("aiFeatures.subject");

  return withEmailLogging(
    { emailType: "drip_ai_features", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error("Failed to send drip AI features email");
      }

      return response;
    },
    { userId, emailType: "drip_ai_features" },
  );
}

// ============================================
// 2c — First Week Stats (Day 21)
// ============================================

interface DripFirstWeekStatsParams extends DripEmailParams {
  totalHoursTracked: number;
  clientCount: number;
  projectCount: number;
}

export async function sendDripFirstWeekStatsEmail({
  to,
  userName,
  userId,
  totalHoursTracked,
  clientCount,
  projectCount,
}: DripFirstWeekStatsParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const emailHtml = await render(
    createElement(DripFirstWeekStatsEmail, {
      mailBrand: mb,
      locale,
      userName,
      totalHoursTracked,
      clientCount,
      projectCount,
      dashboardUrl,
    }),
  );

  const subject = t("firstWeek.subject");

  return withEmailLogging(
    { emailType: "drip_first_week_stats", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error("Failed to send drip first week stats email");
      }

      return response;
    },
    { userId, emailType: "drip_first_week_stats" },
  );
}

// ============================================
// 3a — Upgrade Reminder (trial expires in 5 days)
// ============================================

interface DripUpgradeReminderParams extends DripEmailParams {
  daysLeft: number;
}

export async function sendDripUpgradeReminderEmail({
  to,
  userName,
  userId,
  daysLeft,
}: DripUpgradeReminderParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const emailHtml = await render(
    createElement(DripUpgradeReminderEmail, {
      mailBrand: mb,
      locale,
      userName,
      daysLeft,
      dashboardUrl,
    }),
  );

  const subject = t("upgrade.subject");

  return withEmailLogging(
    { emailType: "drip_upgrade_reminder", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error("Failed to send drip upgrade reminder email");
      }

      return response;
    },
    { userId, emailType: "drip_upgrade_reminder" },
  );
}

// ============================================
// 3b — Klippekort Tips
// ============================================

export async function sendDripKlippekortTipsEmail({
  to,
  userName,
  userId,
}: DripEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const emailHtml = await render(
    createElement(DripKlippekortTipsEmail, {
      mailBrand: mb,
      userName,
      dashboardUrl,
      locale,
    }),
  );

  const subject = t("klippekortTips.subject");

  return withEmailLogging(
    { emailType: "drip_klippekort_tips", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error("Failed to send drip klippekort tips email");
      }

      return response;
    },
    { userId, emailType: "drip_klippekort_tips" },
  );
}

// ============================================
// 4a — Win Back 30 days
// ============================================

interface DripWinBack30Params extends DripEmailParams {
  unbilledHours?: number;
  unbilledValue?: number;
  pendingTasks?: number;
}

export async function sendDripWinBack30Email({
  to,
  userName,
  userId,
  unbilledHours,
  unbilledValue,
  pendingTasks,
}: DripWinBack30Params) {
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const emailHtml = await render(
    createElement(DripWinBack30Email, {
      currencyCode: demoCurrencyForEmail(to),
      mailBrand: mb,
      locale,
      userName,
      unbilledHours,
      unbilledValue,
      pendingTasks,
      dashboardUrl,
    }),
  );

  const subject = t("winBack30.subject", { name: userName });

  return withEmailLogging(
    { emailType: "drip_win_back_30", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error("Failed to send drip win back 30 email");
      }

      return response;
    },
    { userId, emailType: "drip_win_back_30" },
  );
}

// ============================================
// 4b — Win Back 60 days
// ============================================

export async function sendDripWinBack60Email({
  to,
  userName,
  userId,
}: DripEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;
  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);

  const emailHtml = await render(
    createElement(DripWinBack60Email, {
      mailBrand: mb,
      userName,
      dashboardUrl,
      locale,
    }),
  );

  const subject = t("winBack60.subject");

  return withEmailLogging(
    { emailType: "drip_win_back_60", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error("Failed to send drip win back 60 email");
      }

      return response;
    },
    { userId, emailType: "drip_win_back_60" },
  );
}

// ============================================
// Aktivering (#91/#175) — adfærdstriggede mails
// ============================================

async function sendActivationDrip(params: {
  emailType:
    | "drip_no_time_48h"
    | "drip_time_no_invoice"
    | "drip_client_no_klippekort";
  to: string;
  userId: string;
  subject: string;
  html: string;
  text: string;
  mb?: MailBrand;
}) {
  const { emailType, to, userId, subject, html, text, mb } = params;
  return withEmailLogging(
    { emailType, to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? PERSONAL_FROM_EMAIL,
        replyTo: mb?.brand.supportEmail ?? getPersonalReplyTo(),
        to,
        subject,
        html,
        text,
        headers: buildUnsubscribeHeaders(userId, mb?.appUrl),
      });

      if (response.error) {
        throw new Error(`Failed to send ${emailType} email`);
      }

      return response;
    },
    { userId, emailType },
  );
}

/** 48 timer efter signup uden én tidspost. */
export async function sendDripNoTimeEntryEmail({
  to,
  userName,
  userId,
}: DripEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;
  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const { html, text } = await renderEmail(
    createElement(DripNoTimeEntryEmail, {
      mailBrand: mb,
      locale,
      userName,
      dashboardUrl,
      unsubscribeUrl: buildUnsubscribeUrl(userId, mb?.appUrl),
    }),
  );
  return sendActivationDrip({
    emailType: "drip_no_time_48h",
    to,
    userId,
    subject: t("noTimeEntry.subject"),
    html,
    text,
    mb,
  });
}

/** Tid registreret, men ingen faktura (kun planer med fakturering). */
export async function sendDripTimeNoInvoiceEmail({
  to,
  userName,
  userId,
  unbilledHours,
}: DripEmailParams & { unbilledHours: number }) {
  const mb = await resolveMailBrand({ userId, email: to });
  const invoiceUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard/invoices/new`;
  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const hours = new Intl.NumberFormat(toIntlLocale(locale), {
    maximumFractionDigits: 1,
  }).format(unbilledHours);
  const { html, text } = await renderEmail(
    createElement(DripTimeNoInvoiceEmail, {
      mailBrand: mb,
      locale,
      userName,
      unbilledHours: hours,
      invoiceUrl,
      unsubscribeUrl: buildUnsubscribeUrl(userId, mb?.appUrl),
    }),
  );
  return sendActivationDrip({
    emailType: "drip_time_no_invoice",
    to,
    userId,
    subject: t("timeNoInvoice.subject"),
    html,
    text,
    mb,
  });
}

/** Kunde oprettet, men intet klippekort (kun planer med klippekort). */
export async function sendDripClientNoKlippekortEmail({
  to,
  userName,
  userId,
}: DripEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const klippekortUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard/klippekort`;
  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsDrip", locale, mb?.key);
  const { html, text } = await renderEmail(
    createElement(DripClientNoKlippekortEmail, {
      mailBrand: mb,
      locale,
      userName,
      klippekortUrl,
      unsubscribeUrl: buildUnsubscribeUrl(userId, mb?.appUrl),
    }),
  );
  return sendActivationDrip({
    emailType: "drip_client_no_klippekort",
    to,
    userId,
    subject: t("clientNoKlippekort.subject"),
    html,
    text,
    mb,
  });
}
