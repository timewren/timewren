import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolvePrimaryOrgId } from "@/lib/auth/active-org";
import { db } from "@/lib/db";
import { integrationSyncLogs, invoices, users } from "@/lib/db/schema";
import { markInvoicePaid } from "@/lib/invoices/mark-paid";
import { captureRouteError } from "@/lib/utils/sentry";

/**
 * Billy Webhook Handler
 *
 * Handles incoming webhooks from Billy's Billing API
 * Events: invoice.paid, invoice.approved, etc.
 *
 * To set up webhooks in Billy:
 * 1. Go to Settings > Integrations > Webhooks
 * 2. Add endpoint: https://your-domain.com/api/webhooks/billy
 * 3. Select events: invoice.paid, invoice.approved
 */

interface BillyWebhookPayload {
  event: string;
  data: {
    invoice?: {
      id: string;
      invoiceNo: number;
      state: "draft" | "approved" | "sent" | "paid" | "voided";
      contactId: string;
      grossAmount: number;
      currency: string;
      paymentDate?: string;
    };
    payment?: {
      id: string;
      invoiceId: string;
      amount: number;
      entryDate: string;
    };
  };
  organizationId: string;
  timestamp: string;
}

// Verify webhook signature from Billy
function verifyBillySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Protect against timing attacks - buffers must be same length
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  } catch {
    // timingSafeEqual throws if buffers have different lengths
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
    const signature = request.headers.get("x-billy-signature") || "";

    // Get webhook secret from environment
    const webhookSecret = process.env.BILLY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("[Billy Webhook] BILLY_WEBHOOK_SECRET not configured");
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 },
      );
    }

    // Verify signature
    if (!signature) {
      console.error("[Billy Webhook] Missing signature header");
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }
    if (!verifyBillySignature(payload, signature, webhookSecret)) {
      console.error("[Billy Webhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse and validate payload
    let data: BillyWebhookPayload;
    try {
      data = JSON.parse(payload);
    } catch {
      console.error("[Billy Webhook] Invalid JSON payload");
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    console.warn(`[Billy Webhook] Received event: ${data.event}`);

    // Find user by Billy organization ID
    const user = data.organizationId
      ? await db.query.users.findFirst({
          where: eq(users.billyOrganizationId, data.organizationId),
        })
      : null;

    if (!user) {
      console.warn(
        `[Billy Webhook] No user found for organization ${data.organizationId}. Event logged but not processed.`,
      );
      // Return success to Billy (we received it) but don't process further
      return NextResponse.json({ received: true, processed: false });
    }

    // Resolve the connecting user's org. Billy is connected per-user, but in a
    // team a colleague may have exported the invoice via this user's Billy, so
    // status webhooks must match invoices org-wide, not just this user's.
    const orgId = await resolvePrimaryOrgId({ db, userId: user.id });

    // Log the webhook for debugging/auditing
    const [logEntry] = await db
      .insert(integrationSyncLogs)
      .values({
        userId: user.id,
        integrationType: "billy",
        operation: `webhook_${data.event}`,
        status: "pending",
        metadata: { payload: data },
      })
      .returning();

    // Handle specific events
    switch (data.event) {
      case "invoice.paid": {
        if (!data.data.invoice) break;

        const billyInvoice = data.data.invoice;

        // Find matching invoice in our system by Billy invoice ID
        const matchingInvoice = await db.query.invoices.findFirst({
          where: and(
            eq(invoices.billyInvoiceId, billyInvoice.id),
            orgId
              ? eq(invoices.organizationId, orgId)
              : eq(invoices.userId, user.id),
          ),
        });

        if (matchingInvoice) {
          // Update invoice status to paid (+ invoice.paid webhook, #1110)
          await markInvoicePaid(db, {
            invoiceId: matchingInvoice.id,
            paidDate: billyInvoice.paymentDate
              ? new Date(billyInvoice.paymentDate)
              : new Date(),
            previousStatus: matchingInvoice.status,
          });

          console.warn(
            `[Billy Webhook] Invoice ${matchingInvoice.invoiceNumber} marked as paid (Billy ID: ${billyInvoice.id})`,
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
            `[Billy Webhook] No matching invoice found for Billy invoice ${billyInvoice.id}`,
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

      case "invoice.approved": {
        if (!data.data.invoice) break;

        // Update sync log
        await db
          .update(integrationSyncLogs)
          .set({
            status: "success",
            itemsProcessed: 1,
          })
          .where(eq(integrationSyncLogs.id, logEntry.id));

        console.warn(
          `[Billy Webhook] Invoice ${data.data.invoice.invoiceNo} approved`,
        );
        break;
      }

      case "payment.created": {
        if (!data.data.payment) break;

        // Update sync log
        await db
          .update(integrationSyncLogs)
          .set({
            status: "success",
            itemsProcessed: 1,
          })
          .where(eq(integrationSyncLogs.id, logEntry.id));

        console.warn(
          `[Billy Webhook] Payment created for invoice ${data.data.payment.invoiceId}`,
        );
        break;
      }

      default:
        console.warn(`[Billy Webhook] Unhandled event type: ${data.event}`);
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
    console.error("[Billy Webhook] Error:", error);
    // Capture to Sentry so real infrastructure failures still surface,
    // even though we return 200 to prevent provider retry-storm.
    captureRouteError(error, {
      route: "/api/webhooks/billy",
      type: "webhook",
    });
    return NextResponse.json(
      { received: true, error: "handler_failed" },
      { status: 200 },
    );
  }
}
