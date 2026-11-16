import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  PersonalButton,
  PersonalEmailLayout,
  personalText as text,
} from "./PersonalEmailLayout";

interface DripNoTimeEntryEmailProps {
  userName: string;
  /** Signeret afmeldingslink (List-Unsubscribe-målet) */
  unsubscribeUrl?: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/** Aktivering (#91/#175): 48 timer efter signup uden én tidspost. */
export function DripNoTimeEntryEmail({
  mailBrand,
  userName,
  unsubscribeUrl,
  dashboardUrl = mailBrand
    ? `${mailBrand.dashboardUrl}`
    : "https://timetrack.dk/dashboard",
  locale = "da",
}: DripNoTimeEntryEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("noTimeEntry.preview")}
      unsubscribeUrl={unsubscribeUrl}
      showReplyCta={false}
    >
      <Text style={text}>{t("greeting", { name: userName })}</Text>

      <Text style={text}>{t("noTimeEntry.intro")}</Text>

      <Text style={text}>{t("noTimeEntry.how")}</Text>

      <PersonalButton href={dashboardUrl}>
        {t("noTimeEntry.button")}
      </PersonalButton>

      <Text style={text}>{t("noTimeEntry.help")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripNoTimeEntryEmail;
