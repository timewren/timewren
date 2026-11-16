import { render } from "@react-email/render";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { createElement } from "react";
import { InvoiceEmail } from "@/components/email/InvoiceEmail";
import { tr } from "@/i18n/server-text";
import { requireInvoiceRouteAccess } from "@/lib/auth/route-guards";
import { db } from "@/lib/db";
import { invoices, sentEmails } from "@/lib/db/schema";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import {
  buildInvoicePdfProps,
  renderInvoicePdfBuffer,
} from "@/lib/invoice-pdf";
import { isDraftInvoiceNumber } from "@/lib/invoices/draft-number";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { ensureRealInvoiceNumber } from "@/lib/trpc/routers/invoices";
import { resolvePlanTier } from "@/lib/trpc/trpc";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";
import { emitWebhookEvent } from "@/lib/webhooks/events";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Samme vagter som tRPC's moduleWriteProcedure("invoices"): aktiv
    // organisation, skriveadgang til fakturamodulet og et abonnement.
    const access = await requireInvoiceRouteAccess({
      headers: request.headers,
      moduleKey: "invoices",
      featureModule: "invoicing",
      required: "write",
    });
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status },
      );
    }
    const { userId, orgId } = access;
    try {
      await resolvePlanTier({ db, session: { user: { id: userId } }, orgId });
    } catch (err) {
      if (err instanceof TRPCError && err.code === "FORBIDDEN") {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    // Throttle pr. organisation (ellers pr. bruger), delt via Valkey (#1142).
    // Tælles bevidst før body-, faktura- og modtagertjek, så også afviste
    // kald (forkert id, ikke-tilladt modtager) bruger af kvoten og
    // sondering throttles.
    const limit = await rateLimiter.check(
      orgId
        ? `org:${orgId}:invoiceSend`
        : userRateLimitKey(userId, "invoiceSend"),
      "invoiceSend",
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.tooManyRequestsLater") },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(limit.resetIn / 1000)) },
        },
      );
    }

    const { id } = await params;

    // Parse request body. recipientEmail er valgfri: uden den sendes til
    // kundens registrerede mail, ligesom tRPC's sendEmail.
    const body = await request.json().catch(() => ({}));
    const requestedRecipient: unknown = body?.recipientEmail;

    if (
      requestedRecipient != null &&
      (typeof requestedRecipient !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedRecipient.trim()))
    ) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.invoiceSend.invalidRecipient") },
        { status: 400 },
      );
    }

    // Udstedelse ved afsendelse: en kladde skal have sit rigtige,
    // fortlobende nummer FOER PDF/email renderes (#196).
    const preInvoice = await db.query.invoices.findFirst({
      where: and(
        eq(invoices.id, id),
        orgId
          ? eq(invoices.organizationId, orgId)
          : eq(invoices.userId, userId),
      ),
      columns: { id: true, invoiceNumber: true },
      with: { client: { columns: { email: true } } },
    });
    if (!preInvoice) {
      return NextResponse.json(
        { error: await tr("serverErrors", "common.invoiceNotFound") },
        { status: 404 },
      );
    }

    const recipientEmail =
      typeof requestedRecipient === "string"
        ? requestedRecipient.trim()
        : preInvoice.client?.email?.trim();
    if (!recipientEmail) {
      return NextResponse.json(
        { error: await tr("serverErrors", "invoices.clientHasNoEmail") },
        { status: 400 },
      );
    }

    if (isDraftInvoiceNumber(preInvoice.invoiceNumber)) {
      await db.transaction(async (tx) => {
        await ensureRealInvoiceNumber(tx, preInvoice, userId, orgId);
      });
    }

    // Load invoice + PDF props via the shared helper so the emailed PDF is
    // identical to the downloaded one (VAT, logo, bank info, invoice lines).
    const pdfData = await buildInvoicePdfProps({
      invoiceId: id,
      userId,
      orgId,
    });

    if (!pdfData) {
      return NextResponse.json(
        { error: await tr("serverErrors", "common.invoiceNotFound") },
        { status: 404 },
      );
    }

    const { invoice, client, user, companyProfile, pdfProps } = pdfData;

    // Prefer the org's company profile as sender identity so the client sees
    // a consistent company regardless of which member sends.
    const senderName = companyProfile?.name || user.name;
    const senderEmail = companyProfile?.email || user.email;

    // Check if Resend API key is configured
    if (!isMailAvailable()) {
      return NextResponse.json(
        {
          error: await tr("serverErrors", "api.invoiceSend.emailNotConfigured"),
        },
        { status: 500 },
      );
    }

    // Generate PDF attachment
    const pdfBuffer = await renderInvoicePdfBuffer(pdfProps);

    // Kunden har ingen profil: mailen følger afsenderens sprog.
    // Brandet er afsenderens (kontoens), ikke kundens.
    const mb = await resolveMailBrand({ userId });
    const locale = await getRecipientLocale({
      userId,
      email: recipientEmail,
      fallback: mb?.locale,
    });
    const mailSubject = mailT(
      "emailsBilling",
      locale,
      mb?.key,
    )("invoice.subject", {
      number: invoice.invoiceNumber,
      sender: senderName,
    });

    // Render email HTML
    const emailHtml = await render(
      createElement(InvoiceEmail, {
        mailBrand: mb,
        invoiceNumber: invoice.invoiceNumber,
        clientName: client.name,
        amount: invoice.amount,
        dueDate:
          invoice.dueDate?.toISOString() || invoice.issueDate.toISOString(),
        senderName,
        senderEmail,
        notes: invoice.notes,
        locale,
      }),
    );

    // Send email via Resend
    const emailResponse = await resend.emails.send({
      from: mb?.from ?? DEFAULT_FROM_EMAIL,
      to: recipientEmail,
      replyTo: user.email,
      subject: mailSubject,
      html: emailHtml,
      attachments: [
        {
          filename: `Faktura_${invoice.invoiceNumber}.pdf`,
          content: pdfBuffer,
        },
      ],
    });

    if (emailResponse.error) {
      console.error("Resend error:", emailResponse.error);
      return NextResponse.json(
        {
          error: await tr("serverErrors", "api.invoiceSend.sendFailed"),
        },
        { status: 500 },
      );
    }

    // Track sent email in DB
    if (emailResponse.data?.id) {
      try {
        await db.insert(sentEmails).values({
          resendEmailId: emailResponse.data.id,
          userId,
          organizationId: invoice.organizationId ?? null,
          emailType: "invoice",
          recipientEmail: recipientEmail,
          subject: mailSubject,
          invoiceId: id,
          clientId: typeof client.id === "string" ? client.id : undefined,
          latestStatus: "sent",
          sentAt: new Date(),
        });
      } catch (trackErr) {
        console.error("Failed to track sent email:", trackErr);
      }
    }

    // Update invoice status to "sent" if it was draft. The webhook only
    // fires on this draft->sent transition — a resend of an already
    // sent/paid invoice must not re-announce (or misreport) its status.
    if (invoice.status === "draft") {
      await db
        .update(invoices)
        .set({
          status: "sent",
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id));

      emitWebhookEvent({
        userId: invoice.userId,
        orgId: invoice.organizationId,
        eventType: "invoice.sent",
        eventId: invoice.id,
        data: {
          invoice: { ...invoice, status: "sent" },
          sentTo: recipientEmail,
        },
        clientId: invoice.clientId,
      });
    }

    return NextResponse.json({
      success: true,
      emailId: emailResponse.data?.id,
      message: await tr("serverErrors", "api.invoiceSend.sent", {
        email: recipientEmail,
      }),
    });
  } catch (error) {
    console.error("Email sending error:", error);
    return NextResponse.json(
      { error: await tr("serverErrors", "api.invoiceSend.error") },
      { status: 500 },
    );
  }
}
