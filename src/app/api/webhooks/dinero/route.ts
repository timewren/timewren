import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolvePrimaryOrgId } from "@/lib/auth/active-org";
import { db } from "@/lib/db";
import { integrationSyncLogs, invoices, users } from "@/lib/db/schema";
import { markInvoicePaid } from "@/lib/invoices/mark-paid";
import { captureRouteError } from "@/lib/utils/sentry";

/**
 * Dinero Webhook Handler
 *
 * Handles incoming webhooks from Dinero API
 * Events: invoice.booked, invoice.paid, etc.
 *
 * To set up webhooks in Dinero:
 * 1. Go to Settings > API > Webhooks
 * 2. Add endpoint: https://your-domain.com/api/webhooks/dinero
 * 3. Select events you want to receive
 */

interface DineroWebhookPayload {
  EventType: string;
  Timestamp: string;
  Data: {
    OrganizationId?: number;
    InvoiceId?: string;
    InvoiceNumber?: string;
    ContactId?: string;
    Amount?: number;
    Currency?: string;
    PaymentDate?: string;
    Status?: string;
  };
}

// Verify webhook signature from Dinero
function verifyDineroSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  // Dinero uses HMAC-SHA256 with base64 encoding
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json(
        { error: "Expected application/json" },
        { status: 415 },
      );
    }
    const payload = await request.text();
    const signature = request.headers.get("x-dinero-signature") || "";

    // Get webhook secret from environment
    const webhookSecret = process.env.DINERO_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("[Dinero Webhook] DINERO_WEBHOOK_SECRET not configured");
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 },
      );
    }

    // Verify signature
    if (!signature) {
      console.error("[Dinero Webhook] Missing signature header");
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }
    if (!verifyDineroSignature(payload, signature, webhookSecret)) {
      console.error("[Dinero Webhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse and validate payload
    let data: DineroWebhookPayload;
    try {
      data = JSON.parse(payload);
    } catch {
      console.error("[Dinero Webhook] Invalid JSON payload");
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    console.warn(`[Dinero Webhook] Received event: ${data.EventType}`);

    // Find user by Dinero organization ID
    const organizationId = data.Data.OrganizationId?.toString();
    const user = organizationId
      ? await db.query.users.findFirst({
          where: eq(users.dineroOrganizationId, organizationId),
        })
      : null;

    if (!user) {
      console.warn(
        `[Dinero Webhook] No user found for organization ${organizationId}. Event logged but not processed.`,
      );
      // Return success to Dinero (we received it) but don't process further
      return NextResponse.json({ received: true, processed: false });
    }

    // Resolve the connecting user's team org (distinct from the Dinero org id
    // above). In a team a colleague may have exported the invoice via this
    // user's Dinero, so status webhooks must match invoices org-wide.
    const teamOrgId = await resolvePrimaryOrgId({ db, userId: user.id });

    // Log the webhook for debugging/auditing
    const [logEntry] = await db
      .insert(integrationSyncLogs)
      .values({
        userId: user.id,
        integrationType: "dinero",
        operation: `webhook_${data.EventType.toLowerCase()}`,
        status: "pending",
        metadata: { payload: data },
      })
      .returning();

    // Handle specific events
    switch (data.EventType) {
      case "InvoicePaid": {
        if (!data.Data.InvoiceId) break;

        // Find matching invoice in our system by Dinero invoice GUID
        const matchingInvoice = await db.query.invoices.findFirst({
          where: and(
            eq(invoices.dineroInvoiceGuid, data.Data.InvoiceId),
            teamOrgId
              ? eq(invoices.organizationId, teamOrgId)
              : eq(invoices.userId, user.id),
          ),
        });

        if (matchingInvoice) {
          // Update invoice status to paid (+ invoice.paid webhook, #1110)
          await markInvoicePaid(db, {
            invoiceId: matchingInvoice.id,
            paidDate: data.Data.PaymentDate
              ? new Date(data.Data.PaymentDate)
              : new Date(),
            previousStatus: matchingInvoice.status,
          });

          console.warn(
            `[Dinero Webhook] Invoice ${matchingInvoice.invoiceNumber} marked as paid (Dinero ID: ${data.Data.InvoiceId})`,
          );

          // Update sync log
          await db
            .update(integrationSyncLogs)
            .set({
              status: "success",
              itemsProcessed: 1,
              metadata: {
                payload: data,
                invoiceId: matchingInvoice.id,
                invoiceNumber: matchingInvoice.invoiceNumber,
              },
            })
            .where(eq(integrationSyncLogs.id, logEntry.id));
        } else {
          console.warn(
            `[Dinero Webhook] No matching invoice found for Dinero invoice ${data.Data.InvoiceId}`,
          );
          await db
            .update(integrationSyncLogs)
            .set({
              status: "success",
              itemsProcessed: 0,
              metadata: {
                payload: data,
                warning: "No matching invoice found",
              },
            })
            .where(eq(integrationSyncLogs.id, logEntry.id));
        }
        break;
      }

      case "InvoiceBooked": {
        if (!data.Data.InvoiceId) break;

        // Update sync log
        await db
          .update(integrationSyncLogs)
          .set({
            status: "success",
            itemsProcessed: 1,
          })
          .where(eq(integrationSyncLogs.id, logEntry.id));

        console.warn(
          `[Dinero Webhook] Invoice ${data.Data.InvoiceNumber} booked`,
        );
        break;
      }

      case "InvoiceSent": {
        if (!data.Data.InvoiceId) break;

        // Update sync log
        await db
          .update(integrationSyncLogs)
          .set({
            status: "success",
            itemsProcessed: 1,
          })
          .where(eq(integrationSyncLogs.id, logEntry.id));

        console.warn(
          `[Dinero Webhook] Invoice ${data.Data.InvoiceNumber} sent`,
        );
        break;
      }

      case "ContactCreated":
      case "ContactUpdated": {
        // Could be used to sync contact changes back to TimeTrack
        await db
          .update(integrationSyncLogs)
          .set({
            status: "success",
            itemsProcessed: 1,
          })
          .where(eq(integrationSyncLogs.id, logEntry.id));

        console.warn(`[Dinero Webhook] Contact event: ${data.EventType}`);
        break;
      }

      default:
        console.warn(
          `[Dinero Webhook] Unhandled event type: ${data.EventType}`,
        );
        await db
          .update(integrationSyncLogs)
          .set({
            status: "success",
            itemsProcessed: 0,
          })
          .where(eq(integrationSyncLogs.id, logEntry.id));
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Dinero Webhook] Error:", error);
    // Capture to Sentry so real infrastructure failures still surface,
    // even though we return 200 to prevent provider retry-storm.
    captureRouteError(error, {
      route: "/api/webhooks/dinero",
      type: "webhook",
    });
    return NextResponse.json(
      { received: true, error: "handler_failed" },
      { status: 200 },
    );
  }
}
