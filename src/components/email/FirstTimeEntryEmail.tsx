import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL_DASHBOARD_URL } from "./brand";
import { mailMarkup } from "./mail-markup";
import {
  PersonalButton,
  PersonalEmailLayout,
  personalText,
} from "./PersonalEmailLayout";

interface FirstTimeEntryEmailProps {
  userName: string;
  hours: string;
  projectName?: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function FirstTimeEntryEmail({
  mailBrand,
  userName,
  hours,
  projectName,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  locale = "da",
}: FirstTimeEntryEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  // Kalderen sender timer som "2,5" (en decimal); "1,0" vises som "1".
  const shownHours = hours.replace(/,0$/, "");

  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("firstTimeEntry.preview")}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>
        {mailMarkup(
          projectName
            ? t("firstTimeEntry.bodyProject", {
                hours: shownHours,
                project: projectName,
              })
            : t("firstTimeEntry.body", { hours: shownHours }),
        )}
      </Text>

      <Text style={personalText}>{t("firstTimeEntry.invoice")}</Text>

      <PersonalButton href={`${dashboardUrl}/time`}>
        {t("firstTimeEntry.button")}
      </PersonalButton>
    </PersonalEmailLayout>
  );
}

export default FirstTimeEntryEmail;
