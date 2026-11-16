import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  PersonalButton,
  PersonalEmailLayout,
  personalText as text,
} from "./PersonalEmailLayout";

interface DripClientNoKlippekortEmailProps {
  userName: string;
  /** Signeret afmeldingslink (List-Unsubscribe-målet) */
  unsubscribeUrl?: string;
  klippekortUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/** Aktivering (#91/#175): kunde oprettet, men intet klippekort. */
export function DripClientNoKlippekortEmail({
  mailBrand,
  userName,
  unsubscribeUrl,
  klippekortUrl = mailBrand
    ? `${mailBrand.dashboardUrl}/klippekort`
    : "https://timetrack.dk/dashboard/klippekort",
  locale = "da",
}: DripClientNoKlippekortEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("clientNoKlippekort.preview")}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={text}>{t("greeting", { name: userName })}</Text>

      <Text style={text}>{t("clientNoKlippekort.body")}</Text>

      <PersonalButton href={klippekortUrl}>
        {t("clientNoKlippekort.button")}
      </PersonalButton>

      <Text style={text}>{t("clientNoKlippekort.usage")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripClientNoKlippekortEmail;
