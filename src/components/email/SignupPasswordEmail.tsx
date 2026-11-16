import { Link, Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  bgAttr,
  MAIL,
  MAIL_DASHBOARD_URL,
  MAIL_FONT_MONO,
  MAIL_LOGIN_URL,
} from "./brand";
import {
  EmailButton,
  EmailShell,
  emailLink,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface SignupPasswordEmailProps {
  userName: string;
  password: string;
  dashboardUrl?: string;
  loginUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function SignupPasswordEmail({
  mailBrand,
  userName,
  password,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  loginUrl = mailBrand?.loginUrl ?? MAIL_LOGIN_URL,
  locale = "da",
}: SignupPasswordEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsAuth", locale, mailBrand?.key);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("signupPassword.preview", { brand: brand.name })}
      kicker={t("signupPassword.kicker")}
      heading={t("signupPassword.heading", {
        brand: brand.name,
        name: userName,
      })}
    >
      <Text style={emailText}>{t("signupPassword.intro")}</Text>
      <table
        role="presentation"
        border={0}
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ margin: "8px 0 12px" }}
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
                // Kodens tegn skal kunne skelnes (0/O, l/1), så den står i
                // fast bredde.
                fontFamily: MAIL_FONT_MONO,
                fontSize: "20px",
                fontWeight: 700,
                padding: "16px",
                textAlign: "center",
              }}
            >
              {password}
            </td>
          </tr>
        </tbody>
      </table>
      <Text style={emailMuted}>{t("signupPassword.changeIt")}</Text>
      <EmailButton href={dashboardUrl}>
        {t("signupPassword.button")}
      </EmailButton>
      <Text style={emailText}>
        {mailMarkup(t("signupPassword.alsoLogin", { url: loginUrl }), {
          login: (text) => (
            <Link href={loginUrl} style={emailLink}>
              {text}
            </Link>
          ),
        })}
      </Text>
      <Text style={emailText}>
        <strong>{t("signupPassword.getStarted")}</strong>
        <br />
        1. {t("signupPassword.step1")}
        <br />
        2. {t("signupPassword.step2")}
        <br />
        3. {t("signupPassword.step3")}
      </Text>
    </EmailShell>
  );
}

export default SignupPasswordEmail;
