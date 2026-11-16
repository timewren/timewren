import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  PersonalBox,
  PersonalButton,
  PersonalEmailLayout,
  personalBoxItem,
  personalText,
} from "./PersonalEmailLayout";

interface DripExtensionTipsEmailProps {
  userName: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

// dashboardUrl er med i props for kalderne, men mailen linker kun til
// Chrome Web Store (det gjorde den også før).
export function DripExtensionTipsEmail({
  userName,
  locale = "da",
  mailBrand,
}: DripExtensionTipsEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("extensionTips.preview")}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>{t("extensionTips.intro")}</Text>

      <PersonalBox>
        <Text style={personalBoxItem}>{t("extensionTips.tip1")}</Text>
        <Text style={{ ...personalBoxItem, margin: 0 }}>
          {t("extensionTips.tip2")}
        </Text>
      </PersonalBox>

      <PersonalButton href="https://chromewebstore.google.com/detail/omfnfamlmdfaobhcphdfhcnihcllekof">
        {t("extensionTips.button")}
      </PersonalButton>
    </PersonalEmailLayout>
  );
}

export default DripExtensionTipsEmail;
