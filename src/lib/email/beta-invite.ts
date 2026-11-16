import { render } from "@react-email/render";
import { createElement } from "react";
import { BetaInviteEmail } from "@/components/email/BetaInviteEmail";
import { getPersonalReplyTo } from "@/lib/config";
import { mailT } from "@/lib/email/locale";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { PERSONAL_FROM_EMAIL, resend } from "@/lib/resend";
import { appUrlEnv } from "@/lib/runtime-env";
import { withEmailLogging } from "./logger";

interface SendBetaInviteEmailParams {
  to: string;
  recipientName?: string;
  discountCode?: string;
  customMessage?: string;
}

export async function sendBetaInviteEmail({
  to,
  recipientName,
  discountCode,
  customMessage,
}: SendBetaInviteEmailParams) {
  const signupUrl = `${appUrlEnv()}/signup`;

  const locale = await getRecipientLocale({ email: to });
  const t = mailT("emailsDrip", locale);

  const emailHtml = await render(
    createElement(BetaInviteEmail, {
      recipientName,
      signupUrl,
      discountCode,
      customMessage,
      locale,
    }),
  );

  const subject = recipientName
    ? t("beta.subjectNamed", { name: recipientName })
    : t("beta.subject");

  return withEmailLogging(
    { emailType: "beta_invite", to, subject },
    async () => {
      const response = await resend.emails.send({
        from: PERSONAL_FROM_EMAIL,
        replyTo: getPersonalReplyTo(),
        to,
        subject,
        html: emailHtml,
      });

      if (response.error) {
        throw new Error("Failed to send beta invite email");
      }

      return response;
    },
  );
}
