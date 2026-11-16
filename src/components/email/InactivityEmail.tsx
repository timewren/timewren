import { Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL_DASHBOARD_URL } from "./brand";
import {
  EmailButton,
  EmailShell,
  EmailStats,
  emailMuted,
  emailText,
} from "./EmailShell";

interface InactivityEmailProps {
  userName: string;
  daysSinceLastActivity: number;
  unbilledHours?: number;
  unbilledValue?: number;
  pendingTasks?: number;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function InactivityEmail({
  mailBrand,
  userName,
  daysSinceLastActivity,
  unbilledHours = 0,
  unbilledValue = 0,
  pendingTasks = 0,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  locale = "da",
}: InactivityEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  const intl = toIntlLocale(locale);
  const currency = (amount: number) =>
    new Intl.NumberFormat(intl, {
      style: "currency",
      currency: "DKK",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  const hoursFormat = new Intl.NumberFormat(intl, { maximumFractionDigits: 2 });
  const days = { days: daysSinceLastActivity };

  const stats = [
    ...(unbilledHours > 0
      ? [
          {
            label: t("inactivity.unbilled"),
            value: t("inactivity.hoursUnit", {
              hours: hoursFormat.format(unbilledHours),
            }),
          },
        ]
      : []),
    ...(unbilledValue > 0
      ? [
          {
            label: t("inactivity.readyToInvoice"),
            value: currency(unbilledValue),
            sub: t("inactivity.readyToInvoiceSub"),
          },
        ]
      : []),
    ...(pendingTasks > 0
      ? [
          {
            label: t("inactivity.openTasks"),
            value: String(pendingTasks),
            sub: t("inactivity.openTasksSub"),
          },
        ]
      : []),
  ];

  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("inactivity.preview", days)}
      kicker={t("inactivity.kicker")}
      heading={t("inactivity.heading")}
      footerNote={t("inactivity.footerNote")}
      showSettingsLink
    >
      <Text style={emailText}>{t("greeting", { name: userName })}</Text>
      <Text style={emailText}>
        {stats.length > 0
          ? t("inactivity.withStats", days)
          : t("inactivity.noStats", days)}
      </Text>
      {stats.length > 0 && <EmailStats stats={stats} />}
      <EmailButton href={`${dashboardUrl}/time`}>
        {t("inactivity.button")}
      </EmailButton>
      <Text style={emailMuted}>{t("inactivity.muted")}</Text>
    </EmailShell>
  );
}

export default InactivityEmail;
