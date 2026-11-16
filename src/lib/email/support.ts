import { and, eq, or } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { MAIL, MAIL_FONT } from "@/components/email/brand";
import type { db as DbType } from "@/lib/db";
import {
  adminSettings,
  supportMessages,
  supportTickets,
  users,
} from "@/lib/db/schema";
import { mailT } from "@/lib/email/locale";
import { notifyAdmin } from "@/lib/notifications/admin";
import { resend } from "@/lib/resend";

/**
 * Process an inbound email destined for a support inbox.
 */
export async function processSupportEmail(
  inboxId: string,
  email: {
    from: string;
    fromName: string;
    subject: string;
    messageId: string;
    html?: string;
    text?: string;
    inReplyTo?: string;
  },
  db: typeof DbType,
) {
  const senderEmail = extractEmailAddress(email.from) ?? email.from;
  const senderName =
    email.fromName || extractDisplayName(email.from) || senderEmail;

  // Check if reply to existing ticket
  let existingTicket: typeof supportTickets.$inferSelect | null = null;

  // 1. Check In-Reply-To header against message IDs
  if (email.inReplyTo) {
    const msg = await db.query.supportMessages.findFirst({
      where: eq(supportMessages.messageId, email.inReplyTo),
      columns: { ticketId: true },
    });
    if (msg) {
      existingTicket =
        (await db.query.supportTickets.findFirst({
          where: eq(supportTickets.id, msg.ticketId),
        })) ?? null;
    }
  }

  // 2. Check subject for [#TICKET-ID] pattern
  if (!existingTicket && email.subject) {
    const ticketIdMatch = email.subject.match(/\[#([0-9a-f-]{36})\]/i);
    if (ticketIdMatch) {
      existingTicket =
        (await db.query.supportTickets.findFirst({
          where: eq(supportTickets.id, ticketIdMatch[1]),
        })) ?? null;
    }
  }

  const body = email.html || email.text || "";
  const bodyText = email.text || "";

  if (existingTicket) {
    // Add message to existing ticket
    await db.insert(supportMessages).values({
      ticketId: existingTicket.id,
      direction: "inbound",
      fromEmail: senderEmail,
      fromName: senderName,
      body,
      bodyText,
      messageId: email.messageId || null,
    });

    // Reopen if closed, update timestamp
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (existingTicket.status === "closed") {
      updates.status = "open";
      updates.closedAt = null;
    }

    await db
      .update(supportTickets)
      .set(updates)
      .where(eq(supportTickets.id, existingTicket.id));

    // Notify admin
    try {
      await notifyAdmin("support_ticket", {
        userName: senderName,
        userEmail: senderEmail,
        reason: mailT("notifications")("admin.supportReply", {
          subject: existingTicket.subject,
        }),
      });
    } catch {
      // Non-blocking
    }

    return { ticketId: existingTicket.id, isNew: false };
  }

  // New ticket — auto-match sender to user
  let matchedUserId: string | null = null;
  const matchedUser = await db.query.users.findFirst({
    where: eq(users.email, senderEmail),
    columns: { id: true },
  });
  if (matchedUser) {
    matchedUserId = matchedUser.id;
  }

  // Create ticket
  const [ticket] = await db
    .insert(supportTickets)
    .values({
      subject: (
        email.subject || mailT("notifications")("admin.supportNoSubject")
      ).slice(0, 500),
      senderEmail,
      senderName,
      userId: matchedUserId,
      inboxId,
      status: "open",
      priority: "normal",
    })
    .returning();

  // Create first message
  await db.insert(supportMessages).values({
    ticketId: ticket.id,
    direction: "inbound",
    fromEmail: senderEmail,
    fromName: senderName,
    body,
    bodyText,
    messageId: email.messageId || null,
  });

  // Notify admin
  try {
    await notifyAdmin("support_ticket", {
      userName: senderName,
      userEmail: senderEmail,
      reason: mailT("notifications")("admin.supportNew", {
        subject: ticket.subject,
      }),
    });
  } catch {
    // Non-blocking
  }

  return { ticketId: ticket.id, isNew: true };
}

/**
 * Send a support reply email and save the message.
 */
export async function sendSupportReply(
  ticketId: string,
  body: string,
  adminUserId: string,
  db: typeof DbType,
) {
  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, ticketId),
    with: { inbox: true },
  });

  if (!ticket) {
    throw new Error("Ticket ikke fundet");
  }

  const admin = await db.query.users.findFirst({
    where: eq(users.id, adminUserId),
    columns: { name: true, email: true },
  });

  // Get signature: inbox-specific or global
  let signature = ticket.inbox.signature;
  if (!signature) {
    const globalSig = await db.query.adminSettings.findFirst({
      where: eq(adminSettings.id, "support_signature"),
    });
    signature = globalSig?.value ?? null;
  }

  // Build HTML body
  const htmlBody = buildReplyHtml(body, signature);

  // Get last outbound message for In-Reply-To
  const lastOutbound = await db.query.supportMessages.findFirst({
    where: and(
      eq(supportMessages.ticketId, ticketId),
      or(
        eq(supportMessages.direction, "outbound"),
        eq(supportMessages.direction, "inbound"),
      ),
    ),
    orderBy: (m, { desc }) => [desc(m.createdAt)],
    columns: { messageId: true },
  });

  // Send email via the shared mail transport
  const subject = `Re: [#${ticket.id}] ${ticket.subject}`;

  const headers: Record<string, string> = {};
  if (lastOutbound?.messageId) {
    headers["In-Reply-To"] = lastOutbound.messageId;
    headers.References = lastOutbound.messageId;
  }

  const result = await resend.emails.send({
    from: `${ticket.inbox.name} <${ticket.inbox.email}>`,
    to: ticket.senderEmail,
    subject,
    html: htmlBody,
    headers,
  });

  if (result.error) {
    throw new Error(
      `Resend API fejl: ${result.error.message || JSON.stringify(result.error)}`,
    );
  }

  // Save outbound message
  const [message] = await db
    .insert(supportMessages)
    .values({
      ticketId,
      direction: "outbound",
      fromEmail: ticket.inbox.email,
      fromName: admin?.name ?? "Support",
      body: htmlBody,
      bodyText: body,
      messageId: result.data?.id ?? null,
    })
    .returning();

  // Update ticket status to in_progress if still open
  if (ticket.status === "open") {
    await db
      .update(supportTickets)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId));
  } else {
    await db
      .update(supportTickets)
      .set({ updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId));
  }

  return message;
}

function buildReplyHtml(body: string, signature: string | null): string {
  // Convert plain text body to HTML paragraphs
  const bodyHtml = body
    .split("\n\n")
    .map(
      (p) =>
        `<p style="margin:0 0 12px 0">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  // Bevidst uden brandet ramme: et supportsvar skal ligne en almindelig mail.
  let html = `<div style="font-family:${MAIL_FONT.replace(/"/g, "'")};font-size:15px;color:${MAIL.text};line-height:1.6">${bodyHtml}`;

  if (signature) {
    const safeSignature = sanitizeHtml(signature, {
      allowedTags: [
        "p",
        "br",
        "strong",
        "em",
        "a",
        "img",
        "div",
        "span",
        "table",
        "tr",
        "td",
        "th",
        "hr",
        "b",
        "i",
        "u",
      ],
      allowedAttributes: {
        a: ["href", "target", "rel", "style"],
        img: ["src", "alt", "width", "height", "style"],
        "*": ["style", "class"],
      },
    });
    html += `<div style="margin-top:24px;padding-top:16px;border-top:1px solid ${MAIL.line};color:${MAIL.muted};font-size:13px">${safeSignature}</div>`;
  }

  html += "</div>";
  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractEmailAddress(from: string): string | null {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();
  if (from.includes("@")) return from.trim().toLowerCase();
  return null;
}

function extractDisplayName(from: string): string | null {
  const match = from.match(/^([^<]+)</);
  if (match) return match[1].trim();
  return null;
}
