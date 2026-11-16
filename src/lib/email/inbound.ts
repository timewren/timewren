import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { isAIEnabled, parseEmailToTask } from "@/lib/ai";
import { detectInjectionAttempt } from "@/lib/ai/sanitize";
import { classifyEmail } from "@/lib/ai/task-parser";
import { resolvePrimaryOrgId } from "@/lib/auth/active-org";
import { getEmailDomain } from "@/lib/config";
import { db } from "@/lib/db";
import {
  aiProcessingLogs,
  taskAttachments,
  tasks,
  users,
} from "@/lib/db/schema";
import { mailT } from "@/lib/email/locale";
import { matchCustomer } from "@/lib/services/customer-matcher";
import { sanitizeEmailBodyToText } from "./sanitize-body";

/**
 * Generate a unique inbound email ID for a user
 * Format: 8 character alphanumeric string
 */
export function generateInboundEmailId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Get the full inbound email address for a user
 */
export function getInboundEmailAddress(inboundEmailId: string): string {
  const domain = process.env.INBOUND_EMAIL_DOMAIN || getEmailDomain();
  return `task+${inboundEmailId}@${domain}`;
}

/**
 * Extract user ID from inbound email address
 * e.g., task+abc12345@timetrack.dk -> abc12345
 */
export function extractInboundEmailId(toAddress: string): string | null {
  const match = toAddress.match(/task\+([a-z0-9]+)@/i);
  return match ? match[1] : null;
}

/**
 * Find user by their inbound email ID
 */
export async function findUserByInboundEmailId(inboundEmailId: string) {
  return db.query.users.findFirst({
    where: eq(users.inboundEmailId, inboundEmailId),
  });
}

/**
 * Assign an inbound email ID to a user (if they don't have one)
 */
export async function ensureUserHasInboundEmailId(
  userId: string,
): Promise<string> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (user.inboundEmailId) {
    return user.inboundEmailId;
  }

  // Generate and assign a new ID
  let newId = generateInboundEmailId();
  let attempts = 0;

  // Ensure uniqueness
  while (attempts < 10) {
    const existing = await findUserByInboundEmailId(newId);
    if (!existing) break;
    newId = generateInboundEmailId();
    attempts++;
  }

  await db
    .update(users)
    .set({ inboundEmailId: newId })
    .where(eq(users.id, userId));

  return newId;
}

/**
 * Provider-agnostic inbound email structure
 */
export interface InboundEmail {
  from: string;
  to: string[];
  subject: string;
  messageId: string;
  textBody: string;
  htmlBody?: string;
  date: string;
  attachments?: Array<{
    filename: string;
    content_type: string;
    content: string; // base64-encoded
  }>;
}

/**
 * Process result
 */
export interface ProcessEmailResult {
  success: boolean;
  taskId?: string;
  taskTitle?: string;
  error?: string;
  aiUsed: boolean;
  attachmentCount?: number;
  clientMatched?: boolean;
}

/**
 * Process an inbound email and create a task
 */
export async function processInboundEmail(
  email: InboundEmail,
): Promise<ProcessEmailResult> {
  const startTime = Date.now();

  // Extract inbound email ID from to addresses
  let inboundEmailId: string | null = null;
  for (const addr of email.to) {
    inboundEmailId = extractInboundEmailId(addr);
    if (inboundEmailId) break;
  }

  if (!inboundEmailId) {
    return {
      success: false,
      error: "Could not extract inbound email ID from address",
      aiUsed: false,
    };
  }

  // Find the user
  const user = await findUserByInboundEmailId(inboundEmailId);

  if (!user) {
    return {
      success: false,
      error: `No user found with inbound email ID: ${inboundEmailId}`,
      aiUsed: false,
    };
  }

  const emailBody = email.textBody || "";

  // Customer matching from sender email
  let clientId: string | null = null;
  let aiSuggestedClient: string | null = null;

  const senderEmail = extractEmailAddress(email.from);
  if (senderEmail) {
    try {
      const match = await matchCustomer(senderEmail, user.id, { skipAi: true });
      if (match.clientId) {
        if (match.confidence >= 0.8) {
          clientId = match.clientId;
        } else {
          aiSuggestedClient = match.clientId;
        }
      }
    } catch (error) {
      console.warn("[Inbound Email] Customer matching failed:", error);
    }
  }

  // Check user's AI autonomy setting
  let useAI =
    isAIEnabled() &&
    user.aiAutonomyLevel !== "manual" &&
    user.aiEmailProcessing !== false;

  // Run rule-based classification for baseline priority/deadline extraction.
  // Note: isActionable is intentionally NOT checked here — inbound emails are
  // sent to task+{id}@timetrack.dk by the user, so a task is always created.
  const classified = classifyEmail({
    subject: email.subject || "",
    body: emailBody,
    from: email.from,
  });

  let title =
    classified.title ||
    email.subject ||
    mailT("notifications", user.locale)("fallbackTaskTitle");
  let description: string | null =
    sanitizeEmailBodyToText(email.htmlBody, emailBody) || null;
  let priority = classified.priority;
  let deadline: Date | null = classified.deadline
    ? new Date(classified.deadline)
    : null;
  let estimatedMinutes: number | null = null;
  let aiConfidence: number | null = null;
  let aiUsed = false;

  if (useAI) {
    const injectionDetected =
      detectInjectionAttempt(email.subject || "") ||
      detectInjectionAttempt(emailBody);

    if (injectionDetected) {
      await db.insert(aiProcessingLogs).values({
        userId: user.id,
        sourceType: "email",
        sourceId: email.messageId,
        operation: "parse_email",
        model: "rule-based",
        inputData: {
          subject: email.subject,
          from: email.from,
          bodyLength: emailBody.length,
        },
        outputData: null,
        confidence: null,
        status: "rejected",
        errorMessage: "Prompt injection suspected",
        processingTimeMs: Date.now() - startTime,
      });
      useAI = false;
    }
  }

  if (useAI) {
    try {
      const parsed = await parseEmailToTask(
        {
          subject: email.subject,
          body: emailBody,
          from: email.from,
          receivedAt: email.date,
        },
        user.id,
      );

      title = parsed.title;
      if (parsed.description) description = parsed.description;
      priority = parsed.priority;
      estimatedMinutes = parsed.estimatedMinutes;
      aiConfidence = parsed.confidence;
      aiUsed = true;

      if (parsed.deadline) {
        deadline = new Date(parsed.deadline);
      }

      await db.insert(aiProcessingLogs).values({
        userId: user.id,
        sourceType: "email",
        sourceId: email.messageId,
        operation: "parse_email",
        model: "ai",
        inputData: {
          subject: email.subject,
          from: email.from,
          bodyLength: emailBody.length,
        },
        outputData: parsed,
        confidence: String(parsed.confidence),
        status: "success",
        processingTimeMs: Date.now() - startTime,
      });
    } catch (error) {
      console.error("AI email parsing failed:", error);
      aiUsed = false;
    }
  }

  // Resolve user's primary organization
  const orgId = await resolvePrimaryOrgId({ db, userId: user.id });

  // Get next position for backlog
  const maxPositionResult = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(position), 0)` })
    .from(tasks)
    .where(eq(tasks.userId, user.id));
  const position = (maxPositionResult[0]?.maxPos ?? 0) + 1;

  // Create the task
  const [newTask] = await db
    .insert(tasks)
    .values({
      title: title.slice(0, 255),
      description,
      priority,
      deadline,
      estimatedMinutes,
      aiConfidence: aiConfidence ? String(aiConfidence) : null,
      status: "backlog",
      position,
      sourceType: "email",
      sourceId: email.messageId,
      userId: user.id,
      organizationId: orgId,
      clientId,
      aiSuggestedClient,
    })
    .returning();

  // Save attachments
  const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB
  let attachmentCount = 0;

  if (email.attachments?.length && newTask) {
    for (const att of email.attachments) {
      try {
        const buf = Buffer.from(att.content, "base64");
        if (buf.length > MAX_ATTACHMENT_SIZE) continue;
        await db.insert(taskAttachments).values({
          taskId: newTask.id,
          userId: user.id,
          filename: att.filename.slice(0, 255),
          contentType: att.content_type.slice(0, 255),
          sizeBytes: buf.length,
          content: buf,
          sourceEmailId: email.messageId,
        });
        attachmentCount++;
      } catch (error) {
        console.warn(
          `[Inbound Email] Failed to save attachment ${att.filename}:`,
          error,
        );
      }
    }
  }

  return {
    success: true,
    taskId: newTask.id,
    taskTitle: newTask.title,
    aiUsed,
    attachmentCount,
    clientMatched: clientId !== null,
  };
}

/**
 * Extract email address from a "From" header value.
 * Handles both "Name <email@example.com>" and "email@example.com" formats.
 */
function extractEmailAddress(from: string): string | null {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();
  if (from.includes("@")) return from.trim().toLowerCase();
  return null;
}
