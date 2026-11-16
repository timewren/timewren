import { Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { bgAttr, MAIL, MAIL_FONT } from "./brand";
import { EmailShell, emailText } from "./EmailShell";

interface TwoFactorCodeEmailProps {
  userName: string;
  code: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function TwoFactorCodeEmail({
  userName,
  code,
  locale = "da",
  mailBrand,
}: TwoFactorCodeEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsAuth", locale, mailBrand?.key);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("twoFactor.preview", { brand: brand.name, code })}
      kicker={t("security.kicker")}
      heading={t("twoFactor.heading")}
      footerNote={t("twoFactor.footerNote")}
    >
      <Text style={emailText}>
        {t("security.greeting", { name: userName })}
      </Text>
      <Text style={emailText}>{t("twoFactor.enterCode")}</Text>
      <table
        role="presentation"
        border={0}
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ margin: "8px 0 20px" }}
      >
        <tbody>
          <tr>
            <td
              {...bgAttr(MAIL.surface)}
              style={{
                backgroundColor: MAIL.surface,
                border: `1px solid ${MAIL.line}`,
                borderRadius: "8px",
                color: MAIL.text,
                fontFamily: MAIL_FONT,
                fontSize: "32px",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 700,
                // Mellemrum mellem cifrene gør koden let at aflæse og taste.
                letterSpacing: "4px",
                lineHeight: "40px",
                padding: "16px",
                textAlign: "center",
              }}
            >
              {code}
            </td>
          </tr>
        </tbody>
      </table>
      <Text style={emailText}>
        {t("twoFactor.expires", { brand: brand.name })}
      </Text>
    </EmailShell>
  );
}

export default TwoFactorCodeEmail;
