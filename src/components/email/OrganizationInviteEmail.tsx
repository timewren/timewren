import { Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailFallbackLink,
  EmailShell,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface OrganizationInviteEmailProps {
  inviterName: string;
  organizationName: string;
  inviteUrl: string;
  role: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function OrganizationInviteEmail({
  inviterName,
  organizationName,
  inviteUrl,
  role,
  locale = "da",
  mailBrand,
}: OrganizationInviteEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsAuth", locale, mailBrand?.key);
  const roleLabel = ["owner", "admin", "member"].includes(role)
    ? t(`orgInvite.role.${role}`)
    : role;
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("orgInvite.preview", {
        inviter: inviterName,
        org: organizationName,
      })}
      kicker={t("orgInvite.kicker")}
      heading={t("orgInvite.heading", { org: organizationName })}
      footerNote={t("orgInvite.footerNote", { brand: brand.name })}
    >
      <Text style={emailText}>
        {mailMarkup(
          t("orgInvite.body", {
            inviter: inviterName,
            role: roleLabel,
            org: organizationName,
            brand: brand.name,
          }),
        )}
      </Text>
      <Text style={emailText}>{t("orgInvite.body2")}</Text>
      <EmailButton href={inviteUrl}>{t("orgInvite.button")}</EmailButton>
      <Text style={emailMuted}>{t("orgInvite.expires")}</Text>
      <EmailFallbackLink href={inviteUrl} locale={locale} />
    </EmailShell>
  );
}

export default OrganizationInviteEmail;
