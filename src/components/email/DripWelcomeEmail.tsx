import { Link, Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { mailMarkup } from "./mail-markup";
import {
  PersonalBox,
  PersonalButton,
  PersonalEmailLayout,
  personalBoxItem,
  personalLink,
  personalMuted,
  personalText,
} from "./PersonalEmailLayout";

interface DripWelcomeEmailProps {
  userName: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function DripWelcomeEmail({
  mailBrand,
  userName,
  dashboardUrl = mailBrand
    ? `${mailBrand.dashboardUrl}`
    : "https://timetrack.dk/dashboard",
  locale = "da",
}: DripWelcomeEmailProps) {
  // Mads skriver fra TimeTrack; TimeWren-konti får brandets supportadresse.
  const personalEmail =
    mailBrand?.brand.supportEmail ?? buildBrand.contactEmail;
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("welcome.preview", { name: userName })}
      showReplyCta={false}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>{t("welcome.intro")}</Text>

      <Text style={personalText}>{t("welcome.threeSteps")}</Text>

      <PersonalBox>
        <Text style={personalBoxItem}>{t("welcome.step1")}</Text>
        <Text style={personalBoxItem}>{t("welcome.step2")}</Text>
        <Text style={{ ...personalBoxItem, margin: 0 }}>
          {t("welcome.step3")}
        </Text>
      </PersonalBox>

      <PersonalButton href={dashboardUrl}>{t("openApp")}</PersonalButton>

      <Text style={personalText}>{t("welcome.why")}</Text>

      <Text style={personalMuted}>
        {mailMarkup(t("welcome.questions", { email: personalEmail }), {
          mail: (label) => (
            <Link href={`mailto:${personalEmail}`} style={personalLink}>
              {label}
            </Link>
          ),
        })}
      </Text>
    </PersonalEmailLayout>
  );
}

export default DripWelcomeEmail;
