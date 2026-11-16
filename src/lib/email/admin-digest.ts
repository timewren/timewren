import { createElement } from "react";
import {
  AdminDigestEmail,
  type AdminDigestEmailProps,
} from "@/components/email/AdminDigestEmail";
import { toIntlLocale } from "@/i18n/format-locale";
import { mailT } from "@/lib/email/locale";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { renderEmail } from "./render-email";

export interface AdminDigestStats {
  newSignups: number;
  newSignupsLabels: { name: string; email: string; createdAt: Date }[];
  activeSubscriptions: number;
  trialsEndingSoon: number;
  pastDuePayments: number;
  paymentFailures: number;
  webhookErrors: number;
  flaggedUsers: number;
  openTickets: number;
  prepaidIntegrityOrphans: number;
  mrrActual: number;
  mrrChangePercent: number | null;
  /** Uden betalingsudbyder udelades abonnements-, MRR- og prøvetal. */
  billingEnabled: boolean;
  weekRange: { start: Date; end: Date };
}

function formatDKK(amount: number, locale: string): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: "currency",
    currency: "DKK",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(d: Date, locale: string): string {
  return d.toLocaleDateString(toIntlLocale(locale), {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "short",
  });
}

function digestProps(
  stats: AdminDigestStats,
  appUrl: string,
  locale: string,
): AdminDigestEmailProps {
  const t = mailT("emailsReports", locale);
  const pct = stats.mrrChangePercent;
  const mrrChange =
    pct === null
      ? t("admin.noData")
      : `${pct > 0 ? "+" : ""}${pct.toLocaleString(toIntlLocale(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  const alerts = [
    stats.billingEnabled && stats.pastDuePayments > 0
      ? t("admin.alertPastDue", { count: stats.pastDuePayments })
      : null,
    stats.paymentFailures > 0
      ? stats.billingEnabled
        ? t("admin.alertPaymentFailures", { count: stats.paymentFailures })
        : t("admin.alertMailFailures", { count: stats.paymentFailures })
      : null,
    stats.webhookErrors > 0
      ? t("admin.alertWebhook", { count: stats.webhookErrors })
      : null,
    stats.flaggedUsers > 0
      ? t("admin.alertFlagged", { count: stats.flaggedUsers })
      : null,
    stats.prepaidIntegrityOrphans > 0
      ? t("admin.alertPrepaidIntegrity", {
          count: stats.prepaidIntegrityOrphans,
        })
      : null,
    stats.openTickets > 0
      ? t("admin.alertTickets", { count: stats.openTickets })
      : null,
  ].filter((a): a is string => a !== null);
  // Supportsager alene udløser ikke boksen (som før), men står med, når den vises.
  const hasAlert =
    stats.pastDuePayments +
      stats.paymentFailures +
      stats.webhookErrors +
      stats.flaggedUsers +
      stats.prepaidIntegrityOrphans >
    0;
  return {
    weekLabel: t("admin.weekRange", {
      start: formatDate(stats.weekRange.start, locale),
      end: formatDate(stats.weekRange.end, locale),
    }),
    showBilling: stats.billingEnabled,
    mrr: formatDKK(stats.mrrActual, locale),
    mrrChange,
    mrrChangeTone: pct === null ? "none" : pct >= 0 ? "up" : "down",
    activeSubscriptions: stats.activeSubscriptions,
    trialsEndingSoon: stats.trialsEndingSoon,
    alerts: hasAlert ? alerts : [],
    newSignups: stats.newSignups,
    signups: stats.newSignupsLabels.slice(0, 10).map((u) => ({
      name: u.name || u.email,
      detail: `${u.email}, ${formatDate(new Date(u.createdAt), locale)}`,
    })),
    adminUrl: `${appUrl}/admin`,
    locale,
  };
}

export async function sendAdminDigest(params: {
  to: string[];
  stats: AdminDigestStats;
  appUrl: string;
}): Promise<void> {
  if (!resend || params.to.length === 0) return;
  const locale = await getRecipientLocale({ email: params.to[0] });
  const t = mailT("emailsReports", locale);
  const { html, text } = await renderEmail(
    createElement(
      AdminDigestEmail,
      digestProps(params.stats, params.appUrl, locale),
    ),
  );
  await resend.emails.send({
    from: DEFAULT_FROM_EMAIL,
    to: params.to,
    subject: t("admin.digestSubject", {
      date: formatDate(params.stats.weekRange.start, locale),
    }),
    html,
    text,
  });
}
