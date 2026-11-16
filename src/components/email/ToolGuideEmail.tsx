import { Link, Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import {
  EmailButton,
  EmailHr,
  EmailShell,
  emailDivider,
  emailLink,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface ToolGuideEmailProps {
  toolName: string;
  guideLabel: string;
  guideUrl: string;
  toolUrl: string;
  trialUrl: string;
  locale?: string;
}

/** Guiden man bad om fra et af de gratis værktøjer på timetrack.dk. */
export function ToolGuideEmail({
  toolName,
  guideLabel,
  guideUrl,
  toolUrl,
  trialUrl,
  locale = "da",
}: ToolGuideEmailProps) {
  const t = mailT("emailsDrip", locale);
  const tool = toolName.toLowerCase();
  return (
    <EmailShell
      locale={locale}
      preview={t("toolGuide.preview", { tool })}
      kicker={t("toolGuide.kicker")}
      heading={t("toolGuide.heading", { tool })}
      footerNote={t("toolGuide.footerNote")}
    >
      <Text style={emailText}>{t("toolGuide.intro")}</Text>
      <EmailButton href={guideUrl}>{guideLabel}</EmailButton>
      <Text style={emailText}>
        <Link href={toolUrl} style={emailLink}>
          {t("toolGuide.openTool")}
        </Link>
      </Text>
      <EmailHr style={emailDivider} />
      <Text style={emailText}>
        {mailMarkup(t("toolGuide.pitch"), {
          trial: (label) => (
            <Link href={trialUrl} style={emailLink}>
              {label}
            </Link>
          ),
        })}
      </Text>
    </EmailShell>
  );
}

export default ToolGuideEmail;
