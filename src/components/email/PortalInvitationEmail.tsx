import { Link, Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailShell,
  emailLink,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface PortalInvitationEmailProps {
  clientName: string;
  senderName: string;
  senderEmail: string;
  portalUrl: string;
  /** "account" → log in with email/password; "token" → direct link */
  accessType: "account" | "token";
  /** Only for account access: the email the client logs in with */
  loginEmail?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function PortalInvitationEmail({
  clientName,
  senderName,
  senderEmail,
  portalUrl,
  accessType,
  loginEmail,
  locale = "da",
  mailBrand,
}: PortalInvitationEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsAuth", locale, mailBrand?.key);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("portalInvite.preview", { sender: senderName })}
      kicker={t("portalInvite.kicker")}
      heading={t("portalInvite.heading")}
      footerNote={t("portalInvite.footerNote", {
        sender: senderName,
        brand: brand.name,
      })}
    >
      <Text style={emailText}>
        {t("portalInvite.greeting", { name: clientName })}
      </Text>
      <Text style={emailText}>
        {t("portalInvite.body", { sender: senderName })}
      </Text>
      <EmailButton href={portalUrl}>{t("portalInvite.button")}</EmailButton>
      {accessType === "account" && loginEmail && (
        <Text style={emailText}>
          {mailMarkup(
            t("portalInvite.account", {
              email: loginEmail,
              sender: senderName,
            }),
          )}
        </Text>
      )}
      {accessType === "token" && (
        <Text style={emailText}>{t("portalInvite.token")}</Text>
      )}
      <Text style={emailMuted}>
        {mailMarkup(
          t("portalInvite.questions", {
            sender: senderName,
            email: senderEmail,
          }),
          {
            mail: (text) => (
              <Link href={`mailto:${senderEmail}`} style={emailLink}>
                {text}
              </Link>
            ),
          },
        )}
      </Text>
    </EmailShell>
  );
}

export default PortalInvitationEmail;
