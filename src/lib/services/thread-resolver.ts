import crypto from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailThreads } from "@/lib/db/schema";
import type { EmailMessage } from "./imap-client";

/**
 * Strip common email reply/forward prefixes from a subject line.
 * Handles Re:, Fwd:, FW:, SV: (Danish reply), VS: (Danish forward).
 */
function normalizeSubject(subject: string): string {
  let cleaned = subject.trim();
  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(/^(Re|Fwd|FW|SV|VS)\s*:\s*/i, "").trim();
  }
  return cleaned;
}

/**
 * Strip variable parts from a subject before hashing, so recurring alerts
 * (with unique timestamps/ticket numbers) collapse into the same hash.
 */
function normalizeSubjectForHash(subject: string): string {
  let normalized = subject;
  // Strip dates and timestamps (DD-MM-YYYY HH:MM:SS / DD/MM/YYYY HH:MM)
  normalized = normalized.replace(
    /\d{2}[-/]\d{2}[-/]\d{4}\s*\d{2}:\d{2}(:\d{2})?/g,
    "",
  );
  // Strip ISO-style dates (YYYY-MM-DD HH:MM:SS)
  normalized = normalized.replace(
    /\d{4}[-/]\d{2}[-/]\d{2}\s*\d{2}:\d{2}(:\d{2})?/g,
    "",
  );
  // Strip order/ticket numbers (#123)
  normalized = normalized.replace(/#\d+/g, "#");
  // Strip inline numbers after keywords (nr. 123, order 456)
  normalized = normalized.replace(/\b(nr\.?|number|ordre|order)\s*\d+/gi, "");
  // Strip "Re:", "Fwd:", "SV:", "VS:" prefixes (may already be done, but safe)
  normalized = normalized.replace(/^(Re|Fwd|SV|VS):\s*/gi, "");
  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

export function hashSubjectDomain(subject: string, domain: string): string {
  const normalized = normalizeSubjectForHash(normalizeSubject(subject));
  return crypto
    .createHash("sha256")
    .update(`${normalized.toLowerCase()}::${domain.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Resolve a conversationId for an email.
 * Priority:
 *   1. Gmail X-GM-THRID header
 *   2. In-Reply-To lookup
 *   3. References lookup
 *   4. Subject-match (normalized subject + sender domain, 14-day window)
 *   5. New conversationId
 */
export async function resolveConversationId(
  email: EmailMessage,
  userId: string,
): Promise<{
  conversationId: string;
  existingTaskId: string | null;
  threadPosition: number;
}> {
  // 1. Gmail thread ID
  if (email.threadId) {
    const existing = await db.query.emailThreads.findFirst({
      where: and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.conversationId, `gmail:${email.threadId}`),
      ),
      columns: { taskId: true },
      orderBy: desc(emailThreads.threadPosition),
    });

    const position = existing
      ? (await getThreadCount(userId, `gmail:${email.threadId}`)) + 1
      : 1;

    return {
      conversationId: `gmail:${email.threadId}`,
      existingTaskId: existing?.taskId ?? null,
      threadPosition: position,
    };
  }

  // 2. In-Reply-To lookup
  if (email.inReplyTo) {
    const match = await db.query.emailThreads.findFirst({
      where: and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.messageId, email.inReplyTo),
      ),
      columns: { conversationId: true, taskId: true },
    });

    if (match?.conversationId) {
      const position = (await getThreadCount(userId, match.conversationId)) + 1;
      return {
        conversationId: match.conversationId,
        existingTaskId: match.taskId,
        threadPosition: position,
      };
    }
  }

  // 3. References lookup (check any reference)
  if (email.references.length > 0) {
    for (const ref of email.references) {
      const match = await db.query.emailThreads.findFirst({
        where: and(
          eq(emailThreads.userId, userId),
          eq(emailThreads.messageId, ref),
        ),
        columns: { conversationId: true, taskId: true },
      });

      if (match?.conversationId) {
        const position =
          (await getThreadCount(userId, match.conversationId)) + 1;
        return {
          conversationId: match.conversationId,
          existingTaskId: match.taskId,
          threadPosition: position,
        };
      }
    }
  }

  // 4. Subject-match via indexed hash lookup (normalized subject + sender domain, 14-day window)
  const normalizedSubject = normalizeSubject(email.subject);
  if (normalizedSubject.length > 3) {
    const senderDomain = email.from.email.split("@")[1] || "";
    const subjectHash = hashSubjectDomain(normalizedSubject, senderDomain);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // Direct indexed lookup using the stored hash column
    const hashMatch = await db.query.emailThreads.findFirst({
      where: and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.subjectDomainHash, subjectHash),
        gte(emailThreads.receivedDate, fourteenDaysAgo),
      ),
      columns: { conversationId: true, taskId: true },
      orderBy: desc(emailThreads.receivedDate),
    });

    if (hashMatch?.conversationId) {
      const position =
        (await getThreadCount(userId, hashMatch.conversationId)) + 1;
      return {
        conversationId: hashMatch.conversationId,
        existingTaskId: hashMatch.taskId,
        threadPosition: position,
      };
    }

    // Fallback: scan recent candidates for rows without hash (backwards compat)
    const candidates = await db.query.emailThreads.findMany({
      where: and(
        eq(emailThreads.userId, userId),
        gte(emailThreads.receivedDate, fourteenDaysAgo),
      ),
      columns: {
        conversationId: true,
        taskId: true,
        subject: true,
        fromEmail: true,
        subjectDomainHash: true,
      },
      orderBy: desc(emailThreads.receivedDate),
      limit: 50,
    });

    for (const candidate of candidates) {
      if (candidate.subjectDomainHash) continue; // Already checked via indexed lookup
      const candDomain = candidate.fromEmail.split("@")[1] || "";
      const candHash = hashSubjectDomain(
        normalizeSubject(candidate.subject),
        candDomain,
      );

      if (candHash === subjectHash && candidate.conversationId) {
        const position =
          (await getThreadCount(userId, candidate.conversationId)) + 1;
        return {
          conversationId: candidate.conversationId,
          existingTaskId: candidate.taskId,
          threadPosition: position,
        };
      }
    }
  }

  // 5. New conversation — generate a new conversationId
  return {
    conversationId: `conv:${crypto.randomBytes(12).toString("hex")}`,
    existingTaskId: null,
    threadPosition: 1,
  };
}

async function getThreadCount(
  userId: string,
  conversationId: string,
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.conversationId, conversationId),
      ),
    );
  return result[0]?.count ?? 0;
}
