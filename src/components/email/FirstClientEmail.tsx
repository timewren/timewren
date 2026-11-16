import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL_DASHBOARD_URL } from "./brand";
import { mailMarkup } from "./mail-markup";
import {
  PersonalBox,
  PersonalButton,
  PersonalEmailLayout,
  personalBoxItem,
  personalText,
} from "./PersonalEmailLayout";

interface FirstClientEmailProps {
  userName: string;
  clientName: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function FirstClientEmail({
  mailBrand,
  userName,
  clientName,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  locale = "da",
}: FirstClientEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("firstClient.preview", { client: clientName })}
      showReplyCta={false}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>
        {mailMarkup(t("firstClient.intro", { client: clientName }))}
      </Text>

      <PersonalBox>
        <Text style={personalBoxItem}>
          {t("firstClient.step1", { client: clientName })}
        </Text>
        <Text style={personalBoxItem}>{t("firstClient.step2")}</Text>
        <Text style={{ ...personalBoxItem, margin: 0 }}>
          {t("firstClient.step3")}
        </Text>
      </PersonalBox>

      <PersonalButton href={`${dashboardUrl}/projects/new`}>
        {t("firstClient.button")}
      </PersonalButton>

      <Text style={personalText}>{t("firstClient.help")}</Text>
    </PersonalEmailLayout>
  );
}

export default FirstClientEmail;
