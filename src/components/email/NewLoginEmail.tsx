import { Link, Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL_DASHBOARD_URL } from "./brand";
import {
  EmailButton,
  EmailCallout,
  EmailKeyValue,
  EmailShell,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface NewLoginEmailProps {
  userName: string;
  loginAt: Date;
  ipAddress?: string;
  userAgent?: string;
  location?: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/** "Chrome på Windows" — nok til at genkende sin egen enhed. */
export function describeDevice(ua?: string, locale = "da"): string {
  const t = mailT("emailsAuth", locale);
  if (!ua) return t("security.unknownDevice");
  let browser = t("security.browser");
  if (ua.includes("Chrome") && !ua.includes("Edge")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Edge")) browser = "Edge";

  let os = "";
  if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";

  return os ? t("security.deviceOn", { browser, os }) : browser;
}

export function NewLoginEmail({
  mailBrand,
  userName,
  loginAt,
  ipAddress,
  userAgent,
  location,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  locale = "da",
}: NewLoginEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsAuth", locale, mailBrand?.key);
  const device = describeDevice(userAgent, locale);
  const when = loginAt.toLocaleString(toIntlLocale(locale), {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("newLogin.preview", { brand: brand.name, device })}
      kicker={t("security.kicker")}
      heading={t("newLogin.heading")}
      footerNote={t("security.footerNote")}
      showSettingsLink
    >
      <Text style={emailText}>
        {t("security.greeting", { name: userName })}
      </Text>
      <Text style={emailText}>{t("newLogin.body", { brand: brand.name })}</Text>
      <EmailKeyValue
        rows={[
          { label: t("security.time"), value: when },
          { label: t("security.device"), value: device, strong: true },
          ...(ipAddress ? [{ label: t("security.ip"), value: ipAddress }] : []),
          ...(location
            ? [{ label: t("security.place"), value: location }]
            : []),
        ]}
      />
      <EmailCallout tone="danger" title={t("security.notYou")}>
        {mailMarkup(t("newLogin.calloutBody", { email: brand.supportEmail }), {
          mail: (text) => (
            <Link href={`mailto:${brand.supportEmail}`} style={calloutLink}>
              {text}
            </Link>
          ),
        })}
      </EmailCallout>
      <EmailButton href={`${dashboardUrl}/settings`}>
        {t("security.openSettings")}
      </EmailButton>
    </EmailShell>
  );
}

/** Arver callout-farven, så linket kan læses på den røde bund. */
export const calloutLink = { color: "inherit", textDecoration: "underline" };

export default NewLoginEmail;
