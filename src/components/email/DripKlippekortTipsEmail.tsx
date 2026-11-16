import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { EmailKlippekort } from "./EmailShell";
import {
  PersonalButton,
  PersonalEmailLayout,
  personalText,
} from "./PersonalEmailLayout";

interface DripKlippekortTipsEmailProps {
  userName: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function DripKlippekortTipsEmail({
  mailBrand,
  userName,
  dashboardUrl = mailBrand
    ? `${mailBrand.dashboardUrl}`
    : "https://timetrack.dk/dashboard",
  locale = "da",
}: DripKlippekortTipsEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("klippekortTips.preview")}
      showReplyCta={false}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>{t("klippekortTips.intro")}</Text>

      <EmailKlippekort
        locale={locale}
        name={t("klippekortTips.exampleName")}
        totalHours={20}
        remainingHours={7}
      />

      <Text style={personalText}>{t("klippekortTips.how")}</Text>

      <PersonalButton href={`${dashboardUrl}/klippekort/new`}>
        {t("klippekortTips.button")}
      </PersonalButton>

      <Text style={personalText}>{t("klippekortTips.sell")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripKlippekortTipsEmail;
