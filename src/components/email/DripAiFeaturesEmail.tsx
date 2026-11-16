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

interface DripAiFeaturesEmailProps {
  userName: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/**
 * Sendes som drip_ai_features (dag 14, aktive brugere). Mailen handler ikke
 * længere om AI-hype, men om feltet "Skriv hvad du lavede" på Hjem, som er
 * den funktion alle brugere faktisk har: en dansk tekstfortolker uden AI.
 * AI er kun en valgfri reserve med brugerens egen nøgle (BYOK).
 */
export function DripAiFeaturesEmail({
  mailBrand,
  userName,
  dashboardUrl = mailBrand
    ? `${mailBrand.dashboardUrl}`
    : "https://timetrack.dk/dashboard",
  locale = "da",
}: DripAiFeaturesEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("aiFeatures.preview")}
      showReplyCta={false}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>{t("aiFeatures.intro")}</Text>

      <PersonalBox>
        <Text style={{ ...personalBoxItem, margin: 0 }}>
          {t("aiFeatures.example")}
        </Text>
      </PersonalBox>

      <Text style={personalText}>{t("aiFeatures.suggest")}</Text>

      <Text style={personalText}>{t("aiFeatures.parser")}</Text>

      <PersonalButton href={dashboardUrl}>
        {t("aiFeatures.button")}
      </PersonalButton>

      <Text style={personalText}>{t("aiFeatures.feedback")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripAiFeaturesEmail;
