/**
 * Structured logging utility for email operations
 * Provides consistent, searchable logs for monitoring and debugging
 * Also persists sent emails to DB for delivery tracking
 */

import { db } from "@/lib/db";
import { sentEmails } from "@/lib/db/schema";
import { isSyntheticEmail, isSyntheticUserId } from "@/lib/synthetic-users";
import type { EmailType } from "./email-types";

export type { EmailType } from "./email-types";

export type EmailLogLevel = "info" | "warn" | "error";

interface EmailLogContext {
  emailType: EmailType;
  to: string;
  subject?: string;
  userId?: string;
  clientId?: string;
  invoiceId?: string;
  templateId?: string;
  [key: string]: unknown;
}

/** Optional tracking context for DB persistence */
export interface TrackingContext {
  userId: string;
  organizationId?: string;
  emailType: EmailType;
  invoiceId?: string;
  clientId?: string;
}

/**
 * Log an email operation event. Delivery details are only used for sending
 * and tracking. Provider and database errors can also contain those details.
 */
function logEmail(
  level: EmailLogLevel,
  event: string,
  context: EmailLogContext,
  durationMs?: number,
  skipReason?: string,
): void {
  const { emailType, userId, clientId, invoiceId, templateId } = context;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    context: { emailType, userId, clientId, invoiceId, templateId, skipReason },
    durationMs,
  };

  const logLine = JSON.stringify(entry);
  const logFn = { info: console.log, warn: console.warn, error: console.error }[
    level
  ];
  logFn(`[EMAIL] ${logLine}`);
}

/**
 * Log email send attempt
 */
export function logEmailSending(context: EmailLogContext): void {
  logEmail("info", "email.sending", context);
}

/**
 * Log successful email send
 */
export function logEmailSent(
  context: EmailLogContext,
  durationMs?: number,
): void {
  logEmail("info", "email.sent", context, durationMs);
}

/**
 * Log email skipped (e.g., user opted out)
 */
export function logEmailSkipped(
  context: EmailLogContext,
  reason: string,
): void {
  logEmail("info", "email.skipped", context, undefined, reason);
}

/**
 * Check whether an email of a given type was already sent to a user within a
 * recent time window. Used to deduplicate security/notification emails so we
 * never bombard a user with the same message in quick succession.
 *
 * Fails open (returns false) on any error so a tracking failure never blocks a
 * legitimate email.
 */
export async function wasEmailSentRecently(
  userId: string,
  emailType: EmailType,
  withinMs: number,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinMs);
    const recent = await db.query.sentEmails.findFirst({
      where: (e, { and, eq, gte }) =>
        and(
          eq(e.userId, userId),
          eq(e.emailType, emailType),
          gte(e.sentAt, since),
        ),
      columns: { id: true },
    });
    return Boolean(recent);
  } catch {
    console.error("[EMAIL] Failed to check recent sent emails", {
      userId,
      emailType,
    });
    return false;
  }
}

/**
 * Transactional/security emails that must ALWAYS be delivered, even if the
 * recipient has previously bounced or complained. Suppressing these would lock
 * users out of their account (e.g. password reset, 2FA codes, login alerts).
 */
const CRITICAL_EMAIL_TYPES: ReadonlySet<EmailType> = new Set<EmailType>([
  "password_changed",
  "new_login",
  "magic_link",
  "email_verification",
  "password_reset",
  "two_factor_code",
  "organization_invite",
  "data_export",
  // Business-critical: invoices go to clients and are manually triggered, so
  // never silently suppress them.
  "invoice",
]);

// How long a hard/soft bounce suppresses non-critical mail. Complaints (spam
// reports) suppress indefinitely.
const BOUNCE_SUPPRESSION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Determine whether we should suppress sending non-critical email to an
 * address because it previously bounced or the recipient marked us as spam.
 * Keyed by recipient email (NOT user id) so a bouncing client never suppresses
 * a freelancer's own mail, and vice-versa. Sending to known-bad addresses
 * harms domain/sender reputation.
 *
 * Fails open (returns false) on error so tracking issues never block email.
 */
export async function isRecipientSuppressed(email: string): Promise<boolean> {
  if (!email) return false;
  try {
    const row = await db.query.sentEmails.findFirst({
      where: (e, { and, eq, inArray }) =>
        and(
          eq(e.recipientEmail, email),
          inArray(e.latestStatus, ["bounced", "complained"]),
        ),
      orderBy: (e, { desc }) => desc(e.sentAt),
      columns: { latestStatus: true, bouncedAt: true, sentAt: true },
    });
    if (!row) return false;
    if (row.latestStatus === "complained") return true;
    if (row.latestStatus === "bounced") {
      const when = row.bouncedAt ?? row.sentAt;
      return when.getTime() > Date.now() - BOUNCE_SUPPRESSION_MS;
    }
    return false;
  } catch {
    console.error("[EMAIL] Failed to check recipient suppression");
    return false;
  }
}

/**
 * Helper to create email context with common fields
 */
export function createEmailContext(
  emailType: EmailType,
  to: string,
  extra?: Partial<EmailLogContext>,
): EmailLogContext {
  return {
    emailType,
    to,
    ...extra,
  };
}

/**
 * Persist a sent email record to the database.
 * Called after successful send when tracking context is provided.
 */
async function persistSentEmail(
  tracking: TrackingContext,
  recipientEmail: string,
  subject: string | undefined,
  resendEmailId: string | undefined,
): Promise<void> {
  try {
    await db.insert(sentEmails).values({
      resendEmailId: resendEmailId || null,
      userId: tracking.userId,
      organizationId: tracking.organizationId || null,
      emailType: tracking.emailType,
      recipientEmail,
      subject: subject?.slice(0, 500) || null,
      invoiceId: tracking.invoiceId || null,
      clientId: tracking.clientId || null,
      latestStatus: "sent",
      sentAt: new Date(),
    });
  } catch {
    console.error("[EMAIL] Failed to persist sent email to DB", {
      userId: tracking.userId,
      emailType: tracking.emailType,
      resendEmailId,
    });
  }
}

/**
 * Extract resendEmailId from the Resend API response.
 * Works with { data: { id: string } } shape.
 */
function extractResendEmailId(result: unknown): string | undefined {
  if (
    result &&
    typeof result === "object" &&
    "data" in result &&
    result.data &&
    typeof result.data === "object" &&
    "id" in result.data
  ) {
    return (result.data as { id: string }).id;
  }
  return undefined;
}

/**
 * Wrapper function to execute email sending with automatic logging
 * and optional DB persistence.
 *
 * Usage:
 * ```
 * await withEmailLogging(
 *   { emailType: "invoice", to: "user@example.com" },
 *   async () => {
 *     return await resend.emails.send({ ... });
 *   },
 *   { userId: "abc", emailType: "invoice", invoiceId: "123" }
 * );
 * ```
 */
export async function withEmailLogging<T>(
  context: EmailLogContext,
  sendFn: () => Promise<T>,
  tracking?: TrackingContext,
): Promise<T> {
  const startTime = Date.now();

  // Syntetiske overvågningskonti får aldrig mail — heller ikke kritisk mail
  // (login-advarsler ved hvert time-login fra en ny runner-IP).
  if (
    isSyntheticEmail(context.to) ||
    isSyntheticUserId(context.userId ?? tracking?.userId)
  ) {
    logEmailSkipped(context, "synthetic_user");
    return { data: null, error: null, skipped: true } as unknown as T;
  }

  // Suppress non-critical mail to addresses that have bounced or complained.
  // Critical transactional/security mail (password reset, 2FA, login alerts…)
  // is always allowed through so users never get locked out.
  if (tracking && !CRITICAL_EMAIL_TYPES.has(tracking.emailType)) {
    if (await isRecipientSuppressed(context.to)) {
      logEmailSkipped(context, "recipient_suppressed_bounce_or_complaint");
      return { data: null, error: null, skipped: true } as unknown as T;
    }
  }

  logEmailSending(context);

  try {
    const result = await sendFn();
    const durationMs = Date.now() - startTime;
    logEmailSent(context, durationMs);

    // Persist to DB if tracking context provided
    if (tracking) {
      const resendEmailId = extractResendEmailId(result);
      await persistSentEmail(
        tracking,
        context.to,
        context.subject,
        resendEmailId,
      );
    }

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logEmail("error", "email.failed", context, durationMs);
    throw error;
  }
}
