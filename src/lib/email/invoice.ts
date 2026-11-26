import { createElement } from "react";
import { InvoiceEmail } from "@/components/email/InvoiceEmail";
import type { DEMO_CURRENCY } from "@/lib/demo/demo-mode";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { logEmailSkipped, withEmailLogging } from "./logger";
import { renderEmail } from "./render-email";

interface SendInvoiceEmailParams {
  to: string;
  clientName: string;
  invoiceNumber: string;
  amount: string;
  currency?: typeof DEMO_CURRENCY;
  dueDate: string;
  senderName: string;
  senderEmail: string;
  notes?: string | null;
  userId?: string;
  invoiceId?: string;
  clientId?: string;
  /** Fakturaens org, så mailens status kan findes i org'en (emailActivity). */
  organizationId?: string | null;
  attachments?: { filename: string; content: Buffer }[];
}

export async function sendInvoiceEmail({
  to,
  clientName,
  invoiceNumber,
  amount,
  currency,
  dueDate,
  senderName,
  senderEmail,
  notes,
  userId,
  invoiceId,
  clientId,
  organizationId,
  attachments,
}: SendInvoiceEmailParams) {
  // Kundemail: afsenderens (kontoens) brand, ikke modtagerens.
  const mb = await resolveMailBrand({ userId });
  const logContext = {
    emailType: "invoice" as const,
    to,
    invoiceNumber,
    clientName,
    amount,
  };

  // Check if Resend API key is configured
  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    throw new Error(
      "Email service not configured. Contact administrator to set up RESEND_API_KEY.",
    );
  }

  // Kunden har ingen profil: mailen følger afsenderens sprog.
  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsBilling", locale, mb?.key);

  // Render email HTML
  const { html: emailHtml, text } = await renderEmail(
    createElement(InvoiceEmail, {
      mailBrand: mb,
      invoiceNumber,
      clientName,
      amount,
      currency,
      dueDate,
      senderName,
      senderEmail,
      notes,
      locale,
    }),
  );

  const subject = t("invoice.subject", {
    number: invoiceNumber,
    sender: senderName,
  });

  // Send email via Resend with structured logging
  return withEmailLogging(
    { ...logContext, subject },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
        text,
        replyTo: senderEmail,
        attachments,
      });

      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }

      return response;
    },
    userId
      ? {
          userId,
          organizationId: organizationId ?? undefined,
          emailType: "invoice",
          invoiceId,
          clientId,
        }
      : undefined,
  );
}
