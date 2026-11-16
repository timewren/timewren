import { Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
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

interface FirstProjectEmailProps {
  userName: string;
  projectName: string;
  clientName: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function FirstProjectEmail({
  mailBrand,
  userName,
  projectName,
  clientName,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  locale = "da",
}: FirstProjectEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("firstProject.preview", { project: projectName })}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>
        {mailMarkup(
          t("firstProject.intro", { project: projectName, client: clientName }),
        )}
      </Text>

      <PersonalBox>
        <Text style={personalBoxItem}>{t("firstProject.tip1")}</Text>
        <Text style={personalBoxItem}>{t("firstProject.tip2")}</Text>
        <Text style={{ ...personalBoxItem, margin: 0 }}>
          {t("firstProject.tip3", { brand: brand.name })}
        </Text>
      </PersonalBox>

      <PersonalButton href={`${dashboardUrl}/time/new`}>
        {t("firstProject.button")}
      </PersonalButton>

      <Text style={personalText}>{t("firstProject.closing")}</Text>
    </PersonalEmailLayout>
  );
}

export default FirstProjectEmail;
