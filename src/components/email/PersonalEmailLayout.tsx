import { Hr, Img, Link, Text } from "@react-email/components";
import type { ReactNode } from "react";
import { marketingUrl } from "@/lib/config";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  bgAttr,
  MAIL,
  MAIL_APP_URL,
  MAIL_AVATAR_URL,
  MAIL_FONT,
} from "./brand";
import {
  EmailButton,
  emailLink,
  emailMuted,
  emailText,
  MailFrame,
} from "./EmailShell";

interface PersonalEmailLayoutProps {
  preview: string;
  children: ReactNode;
  /** Synligt afmeldingslink (markedsførings- og drip-mails) */
  unsubscribeUrl?: string;
  /** Skjul "svar gerne"-linjen, når brødteksten selv beder om svar */
  showReplyCta?: boolean;
  /** Hvorfor modtageren får mailen, hvis det ikke er en TimeTrack-konto */
  footerNote?: string;
  /** Modtagerens sprog (standard "da") */
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/**
 * Ramme for alle mails fra Mads selv (velkomst, drip, support): jeg-form,
 * ingen brandet header, og hans portræt i signaturen nederst som i en
 * almindelig mail. Systemmails bruger EmailShell.
 */
export function PersonalEmailLayout({
  preview,
  children,
  unsubscribeUrl,
  showReplyCta = true,
  footerNote,
  locale = "da",
  mailBrand,
}: PersonalEmailLayoutProps) {
  const t = mailT("emails", locale, mailBrand?.key);
  const appUrl = mailBrand?.appUrl ?? MAIL_APP_URL;
  const settingsUrl = `${appUrl}/dashboard/settings/notifications`;
  // Portrættet ligger i public/brand/ og serveres fra brandets egen host.
  const avatarUrl = mailBrand
    ? `${mailBrand.siteUrl}/brand/mads-128.jpg`
    : MAIL_AVATAR_URL;

  const footer = (
    <>
      <Text style={footerText}>
        {footerNote ?? t("personal.accountNote")}{" "}
        <Link href={settingsUrl} style={footerLink}>
          {t("shell.mailSettings")}
        </Link>
        {unsubscribeUrl && (
          <>
            {" "}
            {t("personal.or")}{" "}
            <Link href={unsubscribeUrl} style={footerLink}>
              {t("personal.unsubscribe")}
            </Link>
          </>
        )}
        .
      </Text>
      <Text style={footerText}>
        <Link href={mailBrand?.siteUrl ?? marketingUrl()} style={footerLink}>
          {mailBrand?.brand.name ?? "TimeTrack"}
        </Link>{" "}
        {t("shell.madeBy")}
      </Text>
    </>
  );

  return (
    <MailFrame preview={preview} footer={footer} locale={locale}>
      {children}

      {showReplyCta && (
        <Text style={{ ...emailText, margin: "8px 0 0 0" }}>
          {t("personal.replyCta")}
        </Text>
      )}

      <Hr style={{ borderColor: MAIL.line, margin: "24px 0 16px" }} />
      <table role="presentation" border={0} cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            {avatarUrl && (
              <td style={{ paddingRight: "14px", verticalAlign: "middle" }}>
                <Img
                  src={avatarUrl}
                  width="56"
                  height="56"
                  alt="Mads Holst Jensen"
                  style={{
                    border: 0,
                    borderRadius: "50%",
                    display: "block",
                    height: "56px",
                    width: "56px",
                  }}
                />
              </td>
            )}
            <td style={{ verticalAlign: "middle" }}>
              <Text style={{ ...emailText, margin: "0 0 2px 0" }}>
                Mads Holst Jensen
              </Text>
              <Text className="tt-muted" style={{ ...emailMuted, margin: 0 }}>
                {t("personal.role")}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
    </MailFrame>
  );
}

// ─── Byggeklodser til de personlige mails ────────────────────────────

export const personalText = emailText;
export const personalMuted = emailMuted;
export const personalLink = emailLink;

/** Primær handling: samme bulletproof knap som systemmailene. */
export function PersonalButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return <EmailButton href={href}>{children}</EmailButton>;
}

/**
 * Rolig boks til fx en kort trin-liste eller et tal, der skal ses. Lys
 * grå flade uden farvet kant (BRAND.md: én brandfarve, ingen pynt).
 */
export function PersonalBox({ children }: { children: ReactNode }) {
  return (
    <table
      role="presentation"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      width="100%"
      style={{ margin: "16px 0" }}
    >
      <tbody>
        <tr>
          <td
            {...bgAttr(MAIL.surface)}
            style={{
              backgroundColor: MAIL.surface,
              borderRadius: "8px",
              color: MAIL.text,
              fontFamily: MAIL_FONT,
              fontSize: "15px",
              lineHeight: "24px",
              padding: "14px 18px",
            }}
          >
            {children}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Linje i en PersonalBox. */
export const personalBoxItem = {
  color: MAIL.text,
  fontFamily: MAIL_FONT,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 4px 0",
};

const footerText = {
  color: MAIL.muted,
  fontFamily: MAIL_FONT,
  fontSize: "12px",
  lineHeight: "18px",
  margin: "0 0 4px 0",
};

const footerLink = {
  color: MAIL.muted,
  textDecoration: "underline",
};

export default PersonalEmailLayout;
