import { Link, Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL_DASHBOARD_URL } from "./brand";
import {
  EmailButton,
  EmailShell,
  emailLink,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface WelcomeEmailProps {
  userName: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for kontoen. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function WelcomeEmail({
  mailBrand,
  userName,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  locale: localeProp,
}: WelcomeEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  // Modtagerens sprog; ellers brandkontoens sprog (multibrand), ellers dansk.
  const locale = localeProp ?? mailBrand?.locale ?? "da";
  const t = mailT("emailsAuth", locale, mailBrand?.key);
  const values = { brand: brand.name };
  return (
    <EmailShell
      locale={locale}
      mailBrand={mailBrand}
      preview={t("welcome.preview", values)}
      kicker={t("welcome.kicker")}
      heading={t("welcome.heading", { name: userName })}
    >
      <Text style={emailText}>{t("welcome.intro", values)}</Text>
      <Text style={emailText}>
        1. {t("signupPassword.step1")}
        <br />
        2. {t("signupPassword.step2")}
        <br />
        3. {t("signupPassword.step3")}
      </Text>
      <EmailButton href={dashboardUrl}>
        {t("welcome.button", values)}
      </EmailButton>
      <Text style={emailMuted}>
        {mailMarkup(t("welcome.questions", { email: brand.supportEmail }), {
          help: (text) => (
            <Link href={`${dashboardUrl}/help`} style={emailLink}>
              {text}
            </Link>
          ),
          mail: (text) => (
            <Link href={`mailto:${brand.supportEmail}`} style={emailLink}>
              {text}
            </Link>
          ),
        })}
      </Text>
    </EmailShell>
  );
}

export default WelcomeEmail;
