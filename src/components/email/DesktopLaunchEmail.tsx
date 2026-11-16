import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import {
  PersonalButton,
  PersonalEmailLayout,
  personalText,
} from "./PersonalEmailLayout";

interface DesktopLaunchEmailProps {
  heading: string;
  message: string;
  downloadUrl: string;
  locale?: string;
}

/** Mads' mail til ventelisten, når desktop-appen kan hentes. */
export function DesktopLaunchEmail({
  heading,
  message,
  downloadUrl,
  locale = "da",
}: DesktopLaunchEmailProps) {
  const t = mailT("emailsDrip", locale);
  return (
    <PersonalEmailLayout
      locale={locale}
      preview={message}
      footerNote={t("desktopLaunch.footerNote")}
    >
      <Text
        style={{
          ...personalText,
          fontSize: "22px",
          fontWeight: 700,
          lineHeight: "28px",
        }}
      >
        {heading}
      </Text>
      <Text style={personalText}>{message}</Text>
      <PersonalButton href={downloadUrl}>
        {t("desktopLaunch.button")}
      </PersonalButton>
    </PersonalEmailLayout>
  );
}

export default DesktopLaunchEmail;
