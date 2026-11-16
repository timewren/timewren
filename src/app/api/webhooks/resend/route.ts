import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@/lib/db";
import {
  emailEvents,
  emailForwardingLogs,
  emailForwardingRules,
  emailPreferences,
  sentEmails,
  supportInboxes as supportInboxesTable,
  users,
} from "@/lib/db/schema";
import {
  extractInboundEmailId,
  type InboundEmail,
  processInboundEmail,
} from "@/lib/email/inbound";
import { extractInlineImages } from "@/lib/email/inline-images";
import { processSupportEmail } from "@/lib/email/support";
import { DEFAULT_FROM_EMAIL, getResend } from "@/lib/resend";
import { captureRouteError } from "@/lib/utils/sentry";

/** Samlet loft for afkodet indhold i en videresendt mail: 28 MiB fylder ca. 37 MB som base64, under Resends 40 MB. */
const MAX_FORWARD_DECODED_BYTES = 28 * 1024 * 1024;

/**
 * Resend Webhook Handler
 *
 * Handles incoming webhooks from Resend:
 * - email.received: Inbound emails — matched against forwarding rules
 * - email.delivered / email.bounced / email.failed: Delivery status updates
 *
 * Setup:
 * 1. Enable receiving on your domain in the Resend dashboard
 * 2. Create a webhook endpoint with events: email.received, email.delivered, email.bounced, email.failed
 * 3. Copy the signing secret to RESEND_WEBHOOK_SECRET in your env
 */

interface ResendInboundEmail {
  email_id: string;
  from: string;
  to: string[];
  subject: string;
  message_id?: string;
  html?: string;
  text?: string;
  created_at?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: Array<{
    filename: string;
    content_type: string;
    content: string;
  }>;
}

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: ResendInboundEmail & Record<string, unknown>;
}

/**
 * Match an email address against a forwarding pattern.
 * Supports exact match and wildcard domain match (*@domain.com).
 */
function matchesPattern(pattern: string, email: string): boolean {
  const p = pattern.toLowerCase().trim();
  const e = email.toLowerCase().trim();
  if (p === e) return true;
  if (p.startsWith("*@")) return e.endsWith(p.slice(1));
  if (p.startsWith("*")) return e.endsWith(p.slice(1));
  return false;
}

export async function POST(request: Request) {
  try {
    const payload = await request.text();
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("[Resend Webhook] RESEND_WEBHOOK_SECRET not configured");
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 },
      );
    }

    // Verify signature using Svix (Resend uses Svix under the hood)
    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.error("[Resend Webhook] Missing svix headers");
      return NextResponse.json(
        { error: "Missing signature headers" },
        { status: 401 },
      );
    }

    try {
      const wh = new Webhook(webhookSecret);
      wh.verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      console.error("[Resend Webhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let event: ResendWebhookEvent;
    try {
      event = JSON.parse(payload);
    } catch {
      console.error("[Resend Webhook] Invalid JSON");
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    console.warn(`[Resend Webhook] Received event: ${event.type}`);

    switch (event.type) {
      case "email.received":
        await handleInboundEmail(event.data);
        break;

      case "email.delivered":
      case "email.bounced":
      case "email.delivery_delayed":
      case "email.complained":
      case "email.opened":
      case "email.clicked":
        await handleDeliveryEvent(
          event.type,
          event.data.email_id,
          event.created_at,
          event.data,
        );
        break;

      case "contact.updated":
      case "contact.deleted":
        await handleContactEvent(event.type, event.data);
        break;

      default:
        console.warn(`[Resend Webhook] Unhandled event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Resend Webhook] Error:", error);
    captureRouteError(error, {
      route: "/api/webhooks/resend",
      type: "webhook",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

async function handleInboundEmail(data: ResendInboundEmail) {
  const { email_id, from, to, subject, html, text, attachments } = data;

  // Idempotency check
  const existing = await db.query.emailForwardingLogs.findFirst({
    where: eq(emailForwardingLogs.resendEmailId, email_id),
  });

  if (existing) {
    console.warn(`[Resend Webhook] Duplicate email_id ${email_id}, skipping`);
    return;
  }

  // Check if any to-address matches a support inbox
  if (to?.length) {
    const toAddrsLower = to.map((a) => a.toLowerCase().trim());
    const inboxes = await db
      .select({ id: supportInboxesTable.id, email: supportInboxesTable.email })
      .from(supportInboxesTable);

    for (const inbox of inboxes) {
      if (toAddrsLower.some((addr) => addr === inbox.email.toLowerCase())) {
        console.warn(
          `[Resend Webhook] Support inbox email detected: ${inbox.email}`,
        );

        try {
          // Fetch full email body if not included
          let emailHtml = html;
          let emailText = text;
          if (!emailHtml && !emailText) {
            try {
              const resend = getResend();
              const fullEmail = await Promise.race([
                resend.emails.receiving.get(email_id),
                new Promise<never>((_, reject) =>
                  setTimeout(
                    () => reject(new Error("resend body fetch timeout")),
                    10_000,
                  ),
                ),
              ]);
              emailHtml = fullEmail.data?.html || undefined;
              emailText = fullEmail.data?.text || undefined;
            } catch (fetchErr) {
              console.warn(
                `[Resend Webhook] Could not fetch email body for ${email_id}:`,
                fetchErr,
              );
            }
          }

          await processSupportEmail(
            inbox.id,
            {
              from,
              fromName: from.match(/^([^<]+)</)?.[1]?.trim() || from,
              subject: subject || "Ingen emne",
              messageId: data.message_id || email_id,
              html: emailHtml,
              text: emailText,
              inReplyTo: (data as unknown as Record<string, unknown>)
                .in_reply_to as string | undefined,
            },
            db,
          );

          // Log the forwarding
          await db.insert(emailForwardingLogs).values({
            ruleId: null,
            resendEmailId: email_id,
            fromAddress: from,
            toAddress: inbox.email,
            originalTo: inbox.email,
            subject: subject?.slice(0, 500) || null,
            status: "support_ticket",
            receivedAt: new Date(),
          });
        } catch (error) {
          console.error(
            `[Resend Webhook] Support email processing failed:`,
            error,
          );
          await db.insert(emailForwardingLogs).values({
            ruleId: null,
            resendEmailId: email_id,
            fromAddress: from,
            toAddress: inbox.email,
            originalTo: inbox.email,
            subject: subject?.slice(0, 500) || null,
            status: "failed",
            errorMessage:
              error instanceof Error ? error.message : "Unknown error",
            receivedAt: new Date(),
          });
        }
        return; // Handled by support inbox
      }
    }
  }

  // Check if any to-address matches task+{id}@... pattern (email-to-task)
  const taskAddress = to?.find((addr) => extractInboundEmailId(addr) !== null);
  if (taskAddress) {
    console.warn(`[Resend Webhook] Task email detected: ${taskAddress}`);

    try {
      // Resend webhook payload may not include body — fetch full email
      let textBody = text || "";
      let htmlBody = html;

      if (!textBody && !htmlBody) {
        try {
          const resend = getResend();
          const fullEmail = await resend.emails.receiving.get(email_id);
          textBody = fullEmail.data?.text || "";
          htmlBody = fullEmail.data?.html || undefined;
        } catch (fetchError) {
          console.warn(
            `[Resend Webhook] Could not fetch email body for ${email_id}:`,
            fetchError,
          );
        }
      }

      const inboundEmail: InboundEmail = {
        from,
        to,
        subject,
        messageId: data.message_id || email_id,
        textBody,
        htmlBody,
        date: data.created_at || new Date().toISOString(),
        attachments,
      };

      const result = await processInboundEmail(inboundEmail);

      const status = result.success ? "task_created" : "task_failed";

      await db.insert(emailForwardingLogs).values({
        ruleId: null,
        resendEmailId: email_id,
        fromAddress: from,
        toAddress: taskAddress,
        originalTo: taskAddress,
        subject: subject?.slice(0, 500) || null,
        status,
        errorMessage: result.error || null,
        metadata: result.success
          ? {
              taskId: result.taskId,
              taskTitle: result.taskTitle,
              aiUsed: result.aiUsed,
              attachmentCount: result.attachmentCount,
              clientMatched: result.clientMatched,
            }
          : null,
        receivedAt: new Date(),
      });

      console.warn(
        `[Resend Webhook] Task processing result: ${status}`,
        result.success
          ? { taskId: result.taskId, title: result.taskTitle }
          : { error: result.error },
      );

      return; // Skip forwarding rules
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      await db.insert(emailForwardingLogs).values({
        ruleId: null,
        resendEmailId: email_id,
        fromAddress: from,
        toAddress: taskAddress,
        originalTo: taskAddress,
        subject: subject?.slice(0, 500) || null,
        status: "task_failed",
        errorMessage,
        receivedAt: new Date(),
      });

      console.error(
        `[Resend Webhook] Task creation failed for ${taskAddress}:`,
        error,
      );
      return;
    }
  }

  // Get active forwarding rules
  const rules = await db.query.emailForwardingRules.findMany({
    where: eq(emailForwardingRules.isActive, true),
  });

  const originalTo = to?.[0] || "";
  let matched = false;

  for (const rule of rules) {
    // Check from pattern
    if (!matchesPattern(rule.fromPattern, from)) continue;

    // Check to pattern if specified
    const toPattern = rule.toPattern;
    if (toPattern && !to.some((addr) => matchesPattern(toPattern, addr))) {
      continue;
    }

    matched = true;

    // Build forwarded subject
    const fwdSubject = rule.subjectPrefix
      ? `${rule.subjectPrefix}${subject}`
      : subject;

    try {
      const resend = getResend();

      // Resend webhook may not include email body or attachments — fetch via API
      let emailHtml = html;
      let emailText = text;
      let emailAttachments = attachments || [];

      // Fetch full email from API if body or attachments are missing
      // Check that attachments have actual content, not just metadata
      const needsBody = !emailHtml && !emailText;
      const needsAttachments =
        !emailAttachments.length ||
        emailAttachments.some((att) => !att.content);

      if (needsBody || needsAttachments) {
        try {
          const fullEmail = await Promise.race([
            resend.emails.receiving.get(email_id),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("resend body fetch timeout")),
                10_000,
              ),
            ),
          ]);
          if (fullEmail.data) {
            if (needsBody) {
              emailHtml = fullEmail.data.html || undefined;
              emailText = fullEmail.data.text || undefined;
            }

            // Fetch attachment content individually via download URLs
            if (needsAttachments && fullEmail.data.attachments?.length) {
              const fetchedAttachments: typeof emailAttachments = [];
              for (const att of fullEmail.data.attachments) {
                try {
                  const attData = await resend.emails.receiving.attachments.get(
                    {
                      emailId: email_id,
                      id: att.id,
                    },
                  );
                  if (attData.data?.download_url) {
                    const resp = await fetch(attData.data.download_url);
                    const buffer = Buffer.from(await resp.arrayBuffer());
                    fetchedAttachments.push({
                      filename: att.filename || "attachment",
                      content_type: att.content_type,
                      content: buffer.toString("base64"),
                    });
                  }
                } catch (attErr) {
                  console.warn(
                    `[Resend Webhook] Could not fetch attachment ${att.id}:`,
                    attErr,
                  );
                }
              }
              emailAttachments = fetchedAttachments;
            }
          }
        } catch (fetchError) {
          console.warn(
            `[Resend Webhook] Could not fetch full email for ${email_id}:`,
            fetchError,
          );
        }
      }

      // Inline base64 images (Outlook-pasted screenshots can be enormous and
      // cause Resend API errors) are moved out of the html and sent as inline
      // CID attachments. Nothing is stored in S3.
      const rawBody =
        emailHtml || emailText || "(Ingen indhold i original email)";
      const { html: body, attachments: inlineImages } =
        extractInlineImages(rawBody);

      // Show original sender in the "from" display name so recipient
      // sees who actually sent it. The actual sending domain must be
      // verified in Resend, so we keep the verified address but wrap
      // the original sender's email as the display name.
      // Result: "john@example.com <noreply@timetrack.dk>"
      const fromAddress = DEFAULT_FROM_EMAIL;
      const fromDisplay = `${from} <${fromAddress.includes("<") ? fromAddress.replace(/.*</, "").replace(/>.*/, "") : fromAddress}>`;

      // Filter out any attachments missing content to prevent crashes
      const validAttachments = emailAttachments.filter((att) => att.content);

      // Build real attachments for the forwarded email. Inline images belong
      // to the body and are always attached, whether or not the rule forwards
      // regular attachments.
      // Resend afviser mails over 40 MB i alt (efter base64). Vedhæftninger der
      // ikke kan være i det resterende budget udelades og tælles i loggen.
      const inlineBytes = inlineImages.reduce(
        (sum, image) => sum + image.content.length,
        0,
      );
      let remainingBytes =
        MAX_FORWARD_DECODED_BYTES - inlineBytes - Buffer.byteLength(body);
      let omittedAttachments = 0;
      const forwardedAttachments: Array<{
        filename: string;
        content: Buffer;
        contentType: string | undefined;
      }> = [];
      if (rule.forwardAttachments) {
        for (const att of validAttachments) {
          const content = Buffer.from(att.content, "base64");
          if (content.length > remainingBytes) {
            omittedAttachments++;
            continue;
          }
          remainingBytes -= content.length;
          forwardedAttachments.push({
            filename: att.filename,
            content,
            contentType: att.content_type,
          });
        }
      }
      const bodyWithNote =
        omittedAttachments > 0
          ? `${body}<p style="color:#6b7280;font-style:italic">[${omittedAttachments} vedhæftning(er) udeladt, fordi mailen ellers ville overstige størrelsesgrænsen]</p>`
          : body;
      const resendAttachments = [
        ...forwardedAttachments,
        ...inlineImages.map((image) => ({
          filename: image.filename,
          content: image.content,
          contentType: image.contentType,
          contentId: image.contentId,
        })),
      ];

      const sendOptions = {
        from: fromDisplay,
        to: rule.toAddress,
        replyTo: from,
        subject: fwdSubject,
        html: bodyWithNote,
        ...(resendAttachments.length ? { attachments: resendAttachments } : {}),
      };

      // Bevidst direkte Resend: ruten kræver Resend-inbound og er ikke relevant
      // for selvhostere, så den går uden om det fælles send-lag.
      const result = await resend.emails.send(sendOptions);

      if (result.error) {
        throw new Error(
          `Resend API error: ${result.error.message || JSON.stringify(result.error)}`,
        );
      }

      // Log success
      await db.insert(emailForwardingLogs).values({
        ruleId: rule.id,
        resendEmailId: email_id,
        fromAddress: from,
        toAddress: rule.toAddress,
        originalTo,
        subject: subject?.slice(0, 500) || null,
        status: "forwarded",
        errorMessage:
          omittedAttachments > 0
            ? `${omittedAttachments} vedhæftning(er) udeladt (størrelsesgrænse)`
            : null,
        forwardedMessageId: result.data?.id || null,
        receivedAt: new Date(),
        forwardedAt: new Date(),
      });

      // Update rule stats
      await db
        .update(emailForwardingRules)
        .set({
          matchCount: rule.matchCount + 1,
          lastMatchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailForwardingRules.id, rule.id));

      console.warn(
        `[Resend Webhook] Forwarded email from ${from} to ${rule.toAddress} (rule: ${rule.name})`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      await db.insert(emailForwardingLogs).values({
        ruleId: rule.id,
        resendEmailId: email_id,
        fromAddress: from,
        toAddress: rule.toAddress,
        originalTo,
        subject: subject?.slice(0, 500) || null,
        status: "failed",
        errorMessage,
        receivedAt: new Date(),
      });

      console.error(
        `[Resend Webhook] Failed to forward email from ${from} to ${rule.toAddress}:`,
        error,
      );
    }
  }

  // Log no-match entries
  if (!matched) {
    await db.insert(emailForwardingLogs).values({
      ruleId: null,
      resendEmailId: email_id,
      fromAddress: from,
      toAddress: "",
      originalTo,
      subject: subject?.slice(0, 500) || null,
      status: "no_match",
      receivedAt: new Date(),
    });

    console.warn(`[Resend Webhook] No matching rule for email from ${from}`);
  }
}

/**
 * Handle contact events (updated, deleted) — bidirectional sync.
 * When a user unsubscribes via Resend's managed unsubscribe link,
 * we sync that change back to our local emailPreferences table.
 */
async function handleContactEvent(
  eventType: string,
  data: Record<string, unknown>,
) {
  try {
    const contactId = data.id as string | undefined;
    const unsubscribed = data.unsubscribed as boolean | undefined;

    if (!contactId) return;

    // Find user by resendContactId
    const user = await db.query.users.findFirst({
      where: eq(users.resendContactId, contactId),
      columns: { id: true },
    });

    if (!user) {
      console.warn(`[Resend Webhook] No user found for contact ${contactId}`);
      return;
    }

    if (eventType === "contact.updated" && unsubscribed === true) {
      // User unsubscribed via Resend — mark all marketing emails as off
      const existing = await db.query.emailPreferences.findFirst({
        where: eq(emailPreferences.userId, user.id),
      });

      if (existing) {
        await db
          .update(emailPreferences)
          .set({
            weeklyReport: false,
            monthlyReport: false,
            unbilledReminder: false,
            tipsAndTricks: false,
            productUpdates: false,
            updatedAt: new Date(),
          })
          .where(eq(emailPreferences.userId, user.id));
      }

      console.warn(`[Resend Webhook] Synced unsubscribe for user ${user.id}`);
    }

    if (eventType === "contact.deleted") {
      // Clear resendContactId on user
      await db
        .update(users)
        .set({ resendContactId: null })
        .where(eq(users.id, user.id));

      console.warn(`[Resend Webhook] Cleared contact ID for user ${user.id}`);
    }
  } catch (err) {
    console.error("[Resend Webhook] Error handling contact event:", err);
  }
}

/**
 * Handle delivery status events (delivered, bounced, opened, clicked, etc.)
 * Persists events to emailEvents table and updates sentEmails status.
 */
async function handleDeliveryEvent(
  eventType: string,
  resendEmailId: string,
  createdAt: string,
  data: Record<string, unknown>,
) {
  // Strip "email." prefix for storage — e.g. "email.delivered" → "delivered"
  const shortType = eventType.replace("email.", "");
  const occurredAt = createdAt ? new Date(createdAt) : new Date();

  try {
    // Insert event record
    await db.insert(emailEvents).values({
      resendEmailId,
      eventType: shortType,
      metadata: data,
      occurredAt,
    });

    // Update sentEmails status and timestamps
    const statusUpdates: Record<string, unknown> = {
      latestStatus: shortType,
    };

    if (shortType === "delivered") {
      statusUpdates.deliveredAt = occurredAt;
    } else if (shortType === "opened") {
      statusUpdates.openedAt = occurredAt;
    } else if (shortType === "bounced") {
      statusUpdates.bouncedAt = occurredAt;
    }

    await db
      .update(sentEmails)
      .set(statusUpdates)
      .where(eq(sentEmails.resendEmailId, resendEmailId));

    console.warn(
      `[Resend Webhook] Tracked ${shortType} event for ${resendEmailId}`,
    );
  } catch (err) {
    console.error(
      `[Resend Webhook] Failed to persist ${shortType} event for ${resendEmailId}:`,
      err,
    );
  }
}
