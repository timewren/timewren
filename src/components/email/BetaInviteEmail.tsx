import { Link, Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import { MAIL } from "./brand";
import { mailMarkup } from "./mail-markup";
import {
  PersonalBox,
  PersonalButton,
  PersonalEmailLayout,
  personalBoxItem,
  personalLink,
  personalMuted,
  personalText,
} from "./PersonalEmailLayout";

interface BetaInviteEmailProps {
  recipientName?: string;
  signupUrl: string;
  discountCode?: string;
  customMessage?: string;
  locale?: string;
}

export function BetaInviteEmail({
  recipientName,
  signupUrl,
  discountCode,
  customMessage,
  locale = "da",
}: BetaInviteEmailProps) {
  const t = mailT("emailsDrip", locale);
  const contactEmail = buildBrand.contactEmail;
  const greeting = recipientName
    ? t("beta.greetingNamed", { name: recipientName })
    : t("beta.greeting");

  return (
    <PersonalEmailLayout
      locale={locale}
      preview={t("beta.preview")}
      showReplyCta={false}
    >
      <Text style={personalText}>{greeting}</Text>

      {customMessage ? (
        <Text style={personalText}>{customMessage}</Text>
      ) : (
        <>
          <Text style={personalText}>{t("beta.thanks")}</Text>

          <Text style={personalText}>{t("beta.about")}</Text>
        </>
      )}

      {discountCode && (
        <PersonalBox>
          <Text
            className="tt-muted"
            style={{
              ...personalBoxItem,
              color: MAIL.muted,
              margin: "0 0 2px 0",
            }}
          >
            {t("beta.discountLabel")}
          </Text>
          <Text
            style={{
              ...personalBoxItem,
              fontSize: "20px",
              fontWeight: 700,
              lineHeight: "28px",
              margin: "0 0 4px 0",
            }}
          >
            {discountCode}
          </Text>
          <Text
            className="tt-muted"
            style={{
              ...personalBoxItem,
              color: MAIL.muted,
              fontSize: "14px",
              lineHeight: "20px",
              margin: 0,
            }}
          >
            {t("beta.discountNote")}
          </Text>
        </PersonalBox>
      )}

      <PersonalButton href={signupUrl}>{t("beta.button")}</PersonalButton>

      <Text style={personalText}>{t("beta.feedback")}</Text>

      <Text className="tt-muted" style={personalMuted}>
        {mailMarkup(t("beta.writeMe", { email: contactEmail }), {
          mail: (label) => (
            <Link href={`mailto:${contactEmail}`} style={personalLink}>
              {label}
            </Link>
          ),
        })}
      </Text>
    </PersonalEmailLayout>
  );
}

export default BetaInviteEmail;
