/**
 * Structured logging utility for email operations
 * Provides consistent, searchable logs for monitoring and debugging
 * Also persists sent emails to DB for delivery tracking
 */

import { db } from "@/lib/db";
import { sentEmails } from "@/lib/db/schema";
import { isSyntheticEmail, isSyntheticUserId } from "@/lib/synthetic-users";

export type EmailType =
  | "welcome"
  | "password_changed"
  | "new_login"
  | "magic_link"
  | "email_verification"
  | "password_reset"
  | "two_factor_code"
  | "invoice"
  | "first_client"
  | "first_project"
  | "first_time_entry"
  | "first_invoice"
  | "low_balance_alert"
  | "expiry_warning"
  | "weekly_summary"
  | "monthly_summary"
  | "unbilled_reminder"
  | "end_of_day"
  | "inactivity"
  | "organization_invite"
  | "data_export"
  | "test"
  | "drip_welcome"
  | "drip_getting_started"
  | "drip_need_help"
  | "drip_extension_tips"
  | "drip_ai_features"
  | "drip_first_week_stats"
  | "drip_upgrade_reminder"
  | "drip_klippekort_tips"
  | "drip_win_back_30"
  | "drip_win_back_60"
  // Aktivering (#91/#175): adfærdstriggede, én gang pr. bruger
  | "drip_no_time_48h"
  | "drip_time_no_invoice"
  | "drip_client_no_klippekort"
  | "beta_invite"
  | "payment_failed"
  | "trial_ending"
  | "trial_reminder_7d"
  | "trial_reminder_1d"
  | "cancellation_confirmed"
  | "dunning_reminder"
  // Rykkerniveauer (#1108); "dunning_reminder" er kun i gamle rækker
  | "dunning_warning"
  | "dunning_urgent"
  | "import_complete"
  | "alunta_klippekort_created"
  | "timesheet_submitted"
  | "timesheet_reminder"
  | "timesheet_approved"
  | "timesheet_rejected"
  | "absence_requested"
  | "absence_approved"
  | "absence_rejected"
  | "absence_registered"
  | "time_approval_request"
  | "portal_invitation"
  | "timesheet_reopened"
  | "absence_sick_registered"
  | "compliance_warning"
  | "manager_digest"
  | "project_budget_alert"
  | "coverage_reminder"
  | "period_closing_ready"
  | "period_closing_approved"
  | "period_closing_unlocked";

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

interface EmailLogEntry {
  timestamp: string;
  level: EmailLogLevel;
  event: string;
  context: EmailLogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  durationMs?: number;
}

/**
 * Log an email operation event
 */
function logEmail(
  level: EmailLogLevel,
  event: string,
  context: EmailLogContext,
  error?: unknown,
  durationMs?: number,
): void {
  const entry: EmailLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    context,
    durationMs,
  };

  // Extract error details if present
  if (error) {
    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      };
    } else if (typeof error === "object" && error !== null) {
      entry.error = {
        name: "UnknownError",
        message: JSON.stringify(error),
      };
    } else {
      entry.error = {
        name: "UnknownError",
        message: String(error),
      };
    }
  }

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
  logEmail("info", "email.sent", context, undefined, durationMs);
}

/**
 * Log email send failure
 */
export function logEmailError(
  context: EmailLogContext,
  error: unknown,
  durationMs?: number,
): void {
  logEmail("error", "email.failed", context, error, durationMs);
}

/**
 * Log email skipped (e.g., user opted out)
 */
export function logEmailSkipped(
  context: EmailLogContext,
  reason: string,
): void {
  logEmail("info", "email.skipped", { ...context, skipReason: reason });
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
  } catch (err) {
    console.error("[EMAIL] Failed to check recent sent emails:", err);
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
  } catch (err) {
    console.error("[EMAIL] Failed to check recipient suppression:", err);
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
  } catch (err) {
    // Don't let tracking failures break email sending
    console.error("[EMAIL] Failed to persist sent email to DB:", err);
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
    logEmailError(context, error, durationMs);
    throw error;
  }
}
