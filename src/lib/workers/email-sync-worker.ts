import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { parseEmailToTask } from "@/lib/ai";
import {
  aiQuickClassify,
  getCachedClassification,
  updateClassificationCache,
} from "@/lib/ai/email-classifier";
import { detectInjectionAttempt, sanitizeForPrompt } from "@/lib/ai/sanitize";
import { analyzeAttachments } from "@/lib/ai/task-parser";
import { db } from "@/lib/db";
import {
  aiProcessingLogs,
  emailFilterRules,
  emailIntegrations,
  emailSyncQueue,
  emailThreads,
  members,
  tasks,
  users,
} from "@/lib/db/schema";
import { storeAttachments } from "@/lib/email/store-attachments";
import { toLocalDateStr } from "@/lib/format";
import { matchCustomer } from "@/lib/services/customer-matcher";
import type { EmailMessage } from "@/lib/services/imap-client";
import { ImapClientService } from "@/lib/services/imap-client";
import {
  hashSubjectDomain,
  resolveConversationId,
} from "@/lib/services/thread-resolver";
import { isDisposableEmail } from "@/lib/utils/email-blocklist";
import { decrypt, isEncrypted } from "@/lib/utils/encryption";
import { failStaleProcessingJobs } from "@/lib/workers/email-sync-queue-maintenance";

const DEFAULT_SYNC_LOOKBACK_DAYS = 7;
const MATCH_CONFIDENCE_THRESHOLD = 0.5;

export type EmailSyncJobType = "incremental_sync" | "process_email";

export async function enqueueEmailSyncJob(
  userId: string,
  jobType: EmailSyncJobType,
  payload: Record<string, unknown> = {},
) {
  await db.insert(emailSyncQueue).values({
    userId,
    jobType,
    payload,
    status: "pending",
    priority: 5,
    scheduledFor: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function processEmailSyncQueue(): Promise<{ processed: number }> {
  const now = new Date();

  // Et hængende `processing`-job blokerer planlæggeren for brugeren
  await failStaleProcessingJobs(db, now);

  // Cleanup completed/failed/cancelled jobs older than 7 days
  await db
    .delete(emailSyncQueue)
    .where(
      and(
        inArray(emailSyncQueue.status, ["completed", "failed", "cancelled"]),
        lte(
          emailSyncQueue.completedAt,
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        ),
      ),
    );

  await enqueueDueIntegrations(now);
  const pending = await db.query.emailSyncQueue.findMany({
    where: and(
      eq(emailSyncQueue.status, "pending"),
      lte(emailSyncQueue.scheduledFor, now),
    ),
    orderBy: [asc(emailSyncQueue.priority), asc(emailSyncQueue.scheduledFor)],
    limit: 5,
  });

  let processed = 0;

  for (const job of pending) {
    const startedAt = new Date();
    await db
      .update(emailSyncQueue)
      .set({
        status: "processing",
        startedAt,
        attemptCount: sql`${emailSyncQueue.attemptCount} + 1`,
        updatedAt: startedAt,
      })
      .where(eq(emailSyncQueue.id, job.id));

    try {
      if (job.jobType === "incremental_sync") {
        const sinceDays = (job.payload as Record<string, unknown>)?.sinceDays as
          | number
          | undefined;
        await runIncrementalSync(job.userId, sinceDays);
      }

      await db
        .update(emailSyncQueue)
        .set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailSyncQueue.id, job.id));
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const stack = error instanceof Error ? error.stack : null;

      const [updated] = await db
        .update(emailSyncQueue)
        .set({
          status: "failed",
          errorMessage: message,
          errorStack: stack,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailSyncQueue.id, job.id))
        .returning({
          attemptCount: emailSyncQueue.attemptCount,
          max: emailSyncQueue.maxAttempts,
        });

      const attemptCount = updated?.attemptCount ?? job.attemptCount + 1;
      const maxAttempts = updated?.max ?? job.maxAttempts;

      if (attemptCount < maxAttempts) {
        const backoffMinutes =
          Math.min(60, 2 ** attemptCount) * (0.5 + Math.random() * 0.5);
        await db
          .update(emailSyncQueue)
          .set({
            status: "pending",
            scheduledFor: new Date(Date.now() + backoffMinutes * 60 * 1000),
            updatedAt: new Date(),
          })
          .where(eq(emailSyncQueue.id, job.id));
      }
    }
  }

  return { processed };
}

async function enqueueDueIntegrations(now: Date) {
  const integrations = await db.query.emailIntegrations.findMany({
    where: eq(emailIntegrations.syncEnabled, true),
  });

  for (const integration of integrations) {
    if (integration.syncDisabledUntil && integration.syncDisabledUntil > now) {
      continue;
    }

    const lastSync = integration.lastSyncedAt
      ? new Date(integration.lastSyncedAt)
      : null;
    const minutesSinceLastSync = lastSync
      ? (now.getTime() - lastSync.getTime()) / 60000
      : Infinity;

    if (minutesSinceLastSync < integration.syncFrequencyMinutes) {
      continue;
    }

    const existingJob = await db.query.emailSyncQueue.findFirst({
      where: and(
        eq(emailSyncQueue.userId, integration.userId),
        inArray(emailSyncQueue.status, ["pending", "processing"]),
      ),
      columns: { id: true },
    });

    if (existingJob) continue;

    await enqueueEmailSyncJob(integration.userId, "incremental_sync");
  }
}

/**
 * Quick domain lookup against client database.
 * Returns whether the sender domain belongs to a known client.
 */
async function quickDomainLookup(
  domain: string,
  userId: string,
  domainCache: Map<string, { isKnown: boolean; clientId: string | null }>,
): Promise<{ isKnown: boolean; clientId: string | null }> {
  const cached = domainCache.get(domain);
  if (cached) {
    return cached;
  }

  const result = await matchCustomer(`lookup@${domain}`, userId, {
    skipAi: true,
  });
  const entry = {
    isKnown: result.clientId !== null && result.confidence >= 0.6,
    clientId: result.clientId,
  };
  domainCache.set(domain, entry);
  return entry;
}

async function runIncrementalSync(
  userId: string,
  overrideSinceDays?: number,
): Promise<void> {
  const integration = await db.query.emailIntegrations.findFirst({
    where: eq(emailIntegrations.userId, userId),
  });

  if (!integration?.syncEnabled) {
    return;
  }

  if (
    integration.syncDisabledUntil &&
    integration.syncDisabledUntil > new Date()
  ) {
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      aiEmailProcessing: true,
      aiAutonomyLevel: true,
    },
  });

  if (!user) {
    return;
  }

  // Resolve org for task inserts
  const orgMembership = await db.query.members.findFirst({
    where: eq(members.userId, userId),
    columns: { organizationId: true },
  });
  const orgId = orgMembership?.organizationId ?? null;

  const decryptedPassword = decrypt(integration.imapPassword);
  if (isEncrypted(decryptedPassword)) {
    throw new Error(
      "IMAP password could not be decrypted — encryption key may have changed",
    );
  }

  const client = new ImapClientService({
    host: integration.imapHost,
    port: integration.imapPort,
    user: integration.imapUsername,
    password: decryptedPassword,
    tls: integration.imapUseSSL,
    mailbox: integration.targetMailbox,
  });

  const startedAt = new Date();
  let processedCount = 0;

  // Write heartbeat at sync start
  await db
    .update(emailIntegrations)
    .set({ lastHeartbeat: startedAt })
    .where(eq(emailIntegrations.id, integration.id));

  try {
    // F3: UID-based fetch if uidValidity matches, else date-based fallback
    let emails: EmailMessage[];
    let newUidValidity: number | undefined;
    let newHighestUid: number | undefined;

    const canUseUid =
      !overrideSinceDays &&
      integration.uidValidity &&
      integration.highestProcessedUid;

    if (canUseUid && integration.highestProcessedUid) {
      const uidResult = await client.fetchNewEmailsByUid(
        integration.highestProcessedUid,
      );

      if (uidResult.uidValidity === integration.uidValidity) {
        emails = uidResult.messages;
        newHighestUid = uidResult.highestUid;
        newUidValidity = uidResult.uidValidity;
      } else {
        // UIDVALIDITY changed — full date-based resync
        const sinceDate = integration.lastSyncedAt
          ? new Date(integration.lastSyncedAt)
          : new Date(
              Date.now() - DEFAULT_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
            );
        emails = await client.fetchNewEmails(sinceDate);
        newUidValidity = uidResult.uidValidity;
        newHighestUid =
          emails.length > 0
            ? Math.max(...emails.map((e) => e.uid || 0))
            : undefined;
      }
    } else {
      const sinceDate = overrideSinceDays
        ? new Date(Date.now() - overrideSinceDays * 24 * 60 * 60 * 1000)
        : integration.lastSyncedAt
          ? new Date(integration.lastSyncedAt)
          : new Date(
              Date.now() - DEFAULT_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
            );
      emails = await client.fetchNewEmails(sinceDate);
      // Try to capture UID info for future syncs
      newHighestUid =
        emails.length > 0
          ? Math.max(...emails.map((e) => e.uid || 0))
          : undefined;
    }

    // F4: Domain cache for known customer fast-path
    const domainCache = new Map<
      string,
      { isKnown: boolean; clientId: string | null }
    >();

    for (const email of emails) {
      const senderEmail = email.from.email.toLowerCase();
      const senderDomain = senderEmail.split("@")[1] || "";

      // F4: Quick domain lookup for known customers
      const domainInfo = await quickDomainLookup(
        senderDomain,
        userId,
        domainCache,
      );
      let isKnownCustomer = domainInfo.isKnown;

      // Even from known customer domains, skip automated/noreply senders
      if (isKnownCustomer) {
        const automatedSenderPatterns = [
          /^(noreply|no-reply|donotreply|wordpress|backup|alert|monitor|cron|daemon|system|mailer-daemon|postmaster)@/i,
          /wordpress@/i,
          /wpvivid/i,
          /wordfence/i,
        ];

        const isAutomatedSender = automatedSenderPatterns.some((p) =>
          p.test(senderEmail),
        );

        // Also check subject for automated alert patterns
        const automatedSubjectPatterns = [
          /\[.*\]\s*(Advarsel|Warning|Alert|Backup|Error)/i,
          /Backup (Failed|Completed|Succeeded)/i,
          /Advarsel om filændring/i,
          /Wordfence/i,
          /Administrator Toolkit/i,
          /Uptime (Monitoring|Alert)/i,
        ];

        const isAutomatedSubject = automatedSubjectPatterns.some((p) =>
          p.test(email.subject),
        );

        if (isAutomatedSender || isAutomatedSubject) {
          // Don't fast-track — run through normal classification pipeline instead
          isKnownCustomer = false;
        }
      }

      // Client domains only mode: skip emails from non-client domains
      if (integration.clientDomainsOnly && !isKnownCustomer) {
        continue;
      }

      // For unknown senders: full filter pipeline
      if (!isKnownCustomer) {
        if (!passesEmailFilters(integration, email.from.email, email.subject)) {
          continue;
        }
        const passesLearned = await passesLearnedRules(
          userId,
          email.from.email,
          email.subject,
        );
        if (!passesLearned) {
          continue;
        }
      }

      // Dedup check
      const existing = await db.query.emailThreads.findFirst({
        where: and(
          eq(emailThreads.userId, userId),
          eq(emailThreads.messageId, email.messageId),
        ),
      });
      if (existing) {
        continue;
      }

      // F2: Resolve conversation/thread
      const { conversationId, existingTaskId, threadPosition } =
        await resolveConversationId(email, userId);

      // Injection detection (always runs, even for known customers)
      const parseStart = Date.now();
      const injectionDetected =
        detectInjectionAttempt(email.subject) ||
        detectInjectionAttempt(email.bodyText);

      if (injectionDetected) {
        await db.insert(aiProcessingLogs).values({
          userId,
          sourceType: "email",
          sourceId: email.messageId,
          operation: "parse_email",
          model: "rule-based",
          inputData: {
            subject: email.subject,
            from: email.from.email,
            bodyLength: email.bodyText.length,
          },
          outputData: null,
          confidence: null,
          status: "rejected",
          errorMessage: "Prompt injection suspected",
          processingTimeMs: Date.now() - parseStart,
        });

        if (!isKnownCustomer) continue;

        // Sanitize content for known customers — still create task, but with clean content
        email.subject = sanitizeForPrompt(email.subject, {
          maxLength: 500,
          allowNewlines: false,
          context: "email-subject",
        });
        email.bodyText = sanitizeForPrompt(email.bodyText, {
          maxLength: 5000,
          allowNewlines: true,
          context: "email-body",
        });
        console.warn(
          `[EmailSync] Injection detected from known customer ${senderEmail} — content sanitized`,
        );
      }

      const shouldUseAI =
        user.aiEmailProcessing &&
        user.aiAutonomyLevel !== "manual" &&
        !injectionDetected;

      let parsed: Awaited<ReturnType<typeof parseEmailToTask>>;
      let senderPriority: "high" | "normal" = "normal";

      if (isKnownCustomer) {
        // F4: Fast-path for known customers — skip classification, always create task
        senderPriority = "high";
        parsed = await parseEmailToTask(
          {
            subject: email.subject,
            body: email.bodyText,
            from: email.from.email,
            receivedAt: email.receivedDate.toISOString(),
            headers: email.headers,
          },
          shouldUseAI ? userId : undefined,
        );
      } else {
        // Pre-fetch sender reputation for rule-based classification
        const cachedReputation = await getCachedClassification(
          userId,
          senderDomain,
        );

        parsed = await parseEmailToTask(
          {
            subject: email.subject,
            body: email.bodyText,
            from: email.from.email,
            receivedAt: email.receivedDate.toISOString(),
            headers: email.headers,
          },
          shouldUseAI ? userId : undefined,
          { senderReputation: cachedReputation },
        );

        // F1: AI fallback for uncertain classifications
        if (
          parsed.isUncertain &&
          parsed.isActionable &&
          user.aiEmailProcessing &&
          shouldUseAI
        ) {
          try {
            // Use pre-fetched cache
            if (cachedReputation) {
              if (!cachedReputation.actionable) {
                parsed = { ...parsed, isActionable: false };
              }
            } else {
              // AI quick classify
              const aiResult = await aiQuickClassify(
                email.subject,
                email.bodyText.slice(0, 300),
                email.from.email,
                userId,
              );

              // Update cache
              await updateClassificationCache(
                userId,
                senderDomain,
                aiResult.actionable,
                aiResult.confidence,
              );

              if (!aiResult.actionable) {
                parsed = { ...parsed, isActionable: false };
              }

              // Log AI classification
              await db.insert(aiProcessingLogs).values({
                userId,
                sourceType: "email",
                sourceId: email.messageId,
                operation: "quick_classify",
                model: "gpt-4o-mini",
                inputData: {
                  subject: email.subject,
                  from: email.from.email,
                  bodyLength: email.bodyText.length,
                },
                outputData: aiResult,
                confidence: String(aiResult.confidence),
                status: aiResult.actionable ? "success" : "skipped",
                processingTimeMs: Date.now() - parseStart,
              });
            }
          } catch {
            // AI fallback failed — treat as actionable (current behavior)
          }
        }
      }

      const matched = isKnownCustomer
        ? {
            clientId: domainInfo.clientId,
            confidence: 0.9,
            matchReason: "domain_cache",
          }
        : await matchCustomer(email.from.email, userId);

      let taskId = existingTaskId;

      // F2: If this email belongs to an existing thread, update the task instead of creating
      if (existingTaskId) {
        const existingTask = await db.query.tasks.findFirst({
          where: eq(tasks.id, existingTaskId),
          columns: {
            priority: true,
            status: true,
            threadEmailCount: true,
            lastThreadUpdate: true,
            description: true,
          },
        });

        const updates: Record<string, unknown> = {
          threadEmailCount: sql`COALESCE(${tasks.threadEmailCount}, 1) + 1`,
          lastThreadUpdate: new Date(),
          updatedAt: new Date(),
        };

        // K1: Priority escalation — only for non-automated emails, max once per 24h
        const isAutoReply =
          email.headers.autoSubmitted !== null ||
          email.headers.xAutoResponseSuppress !== null ||
          email.headers.precedence === "bulk";

        const lastUpdate = existingTask?.lastThreadUpdate
          ? new Date(existingTask.lastThreadUpdate).getTime()
          : 0;
        const hoursSinceLastEscalation =
          (Date.now() - lastUpdate) / (1000 * 60 * 60);

        if (
          existingTask &&
          existingTask.status !== "done" &&
          existingTask.priority &&
          !isAutoReply &&
          hoursSinceLastEscalation >= 24
        ) {
          const escalation: Record<string, string> = {
            low: "medium",
            medium: "high",
            high: "urgent",
          };
          const newPriority =
            escalation[existingTask.priority] || existingTask.priority;
          if (newPriority !== existingTask.priority) {
            updates.priority = newPriority;
          }
        }

        // K2: Thread summary — bounded to prevent unlimited growth
        const emailCount = (existingTask?.threadEmailCount ?? 1) + 1;
        const currentDescLen = existingTask?.description?.length ?? 0;
        if (currentDescLen < 8000) {
          const summaryLine = `\n\n---\n📧 ${emailCount} emails i tråden. Seneste (${toLocalDateStr(email.receivedDate)}): ${email.subject}`;
          updates.description = sql`COALESCE(${tasks.description}, '') || ${summaryLine}`;
        }

        await db.update(tasks).set(updates).where(eq(tasks.id, existingTaskId));
      } else if (parsed.isActionable) {
        // Near-duplicate detection: same sender + similar subject within 10 minutes
        const tenMinutesAgo = new Date(
          email.receivedDate.getTime() - 10 * 60 * 1000,
        );
        const dupHash = hashSubjectDomain(email.subject, senderDomain);
        const nearDuplicate = await db.query.emailThreads.findFirst({
          where: and(
            eq(emailThreads.userId, userId),
            eq(emailThreads.subjectDomainHash, dupHash),
            gte(emailThreads.receivedDate, tenMinutesAgo),
          ),
          columns: { taskId: true },
          orderBy: desc(emailThreads.receivedDate),
        });

        if (nearDuplicate?.taskId) {
          // Merge into existing task instead of creating new
          await db
            .update(tasks)
            .set({
              threadEmailCount: sql`COALESCE(${tasks.threadEmailCount}, 1) + 1`,
              lastThreadUpdate: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, nearDuplicate.taskId));
          taskId = nearDuplicate.taskId;
        }

        if (!nearDuplicate?.taskId) {
          // Attachment-aware prioritization
          const attachmentHint = analyzeAttachments(
            email.attachments.map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              size: a.size,
            })),
          );

          let taskTitle = parsed.title;
          let taskPriority = parsed.priority;

          if (
            attachmentHint.titlePrefix &&
            !taskTitle.toLowerCase().includes("faktura") &&
            !taskTitle.toLowerCase().includes("kontrakt")
          ) {
            taskTitle = `${attachmentHint.titlePrefix}${taskTitle}`;
          }
          if (attachmentHint.priorityBoost) {
            const priorityOrder = ["low", "medium", "high", "urgent"];
            const currentIdx = priorityOrder.indexOf(taskPriority);
            const boostIdx = priorityOrder.indexOf(
              attachmentHint.priorityBoost,
            );
            if (boostIdx > currentIdx) {
              taskPriority =
                attachmentHint.priorityBoost as typeof taskPriority;
            }
          }

          const maxPositionResult = await db
            .select({ maxPos: sql<number>`COALESCE(MAX(position), 0)` })
            .from(tasks)
            .where(eq(tasks.userId, userId));
          const position = (maxPositionResult[0]?.maxPos ?? 0) + 1;

          const [createdTask] = await db
            .insert(tasks)
            .values({
              userId,
              organizationId: orgId,
              title: taskTitle.slice(0, 255),
              description: parsed.description || email.bodyText.slice(0, 2000),
              priority: taskPriority,
              deadline: parsed.deadline ? new Date(parsed.deadline) : null,
              estimatedMinutes: parsed.estimatedMinutes || null,
              status: "backlog",
              position,
              sourceType: "email",
              sourceId: email.messageId,
              aiConfidence: String(parsed.confidence),
              aiProcessedAt: new Date(),
              aiSuggestedClient: matched.clientId,
              clientId:
                matched.clientId &&
                matched.confidence >= MATCH_CONFIDENCE_THRESHOLD
                  ? matched.clientId
                  : null,
            })
            .returning({ id: tasks.id });

          taskId = createdTask.id;
        } // end !nearDuplicate
      }

      const storedAttachments = await storeAttachments(
        email.attachments,
        email.messageId,
      );

      // Store email thread record with F2 conversation tracking
      // senderDomain already defined above in the loop
      await db.insert(emailThreads).values({
        userId,
        taskId,
        messageId: email.messageId,
        threadId: email.threadId,
        inReplyTo: email.inReplyTo || null,
        references: email.references,
        conversationId,
        threadPosition,
        senderPriority,
        subject: email.subject,
        fromEmail: email.from.email,
        fromName: email.from.name || null,
        toEmails: email.to,
        ccEmails: email.cc,
        receivedDate: email.receivedDate,
        bodyText: email.bodyText,
        bodyHtml: email.bodyHtml,
        attachments: storedAttachments,
        isProcessed: true,
        matchedClientId: matched.clientId,
        matchConfidence: String(matched.confidence),
        subjectDomainHash: hashSubjectDomain(email.subject, senderDomain),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.insert(aiProcessingLogs).values({
        userId,
        sourceType: "email",
        sourceId: email.messageId,
        operation: "parse_email",
        model: shouldUseAI ? "gpt-4o-mini" : "rule-based",
        inputData: {
          subject: email.subject,
          from: email.from.email,
          bodyLength: email.bodyText.length,
          isKnownCustomer,
          senderPriority,
        },
        outputData: parsed,
        confidence: String(parsed.confidence),
        status: parsed.isActionable ? "success" : "skipped",
        processingTimeMs: Date.now() - parseStart,
      });

      processedCount++;
    }

    // Update integration with sync results and UID tracking
    const updateData: Record<string, unknown> = {
      lastSyncedAt: startedAt,
      lastSyncStatus: "success",
      lastSyncError: null,
      processedEmailsCount: sql`${emailIntegrations.processedEmailsCount} + ${processedCount}`,
      consecutiveSyncFailures: 0,
      syncDisabledUntil: null,
      lastHeartbeat: new Date(),
      updatedAt: new Date(),
    };

    if (newUidValidity) {
      updateData.uidValidity = newUidValidity;
    }
    if (newHighestUid && newHighestUid > 0) {
      updateData.highestProcessedUid = newHighestUid;
    }

    await db
      .update(emailIntegrations)
      .set(updateData)
      .where(eq(emailIntegrations.id, integration.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    const [updatedIntegration] = await db
      .update(emailIntegrations)
      .set({
        lastSyncStatus: "error",
        lastSyncError: message,
        consecutiveSyncFailures: sql`${emailIntegrations.consecutiveSyncFailures} + 1`,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailIntegrations.id, integration.id))
      .returning({
        consecutiveSyncFailures: emailIntegrations.consecutiveSyncFailures,
      });

    // Circuit breaker: disable sync temporarily after repeated failures
    const failures = updatedIntegration?.consecutiveSyncFailures ?? 0;
    if (failures >= 3) {
      const backoffMinutes = Math.min(
        60 * 24, // max 24 hours
        5 * 2 ** (failures - 3), // 5, 10, 20, 40, 80... minutes
      );
      const disableUntil = new Date(Date.now() + backoffMinutes * 60 * 1000);

      await db
        .update(emailIntegrations)
        .set({ syncDisabledUntil: disableUntil })
        .where(eq(emailIntegrations.id, integration.id));

      console.warn(
        `[EmailSync] Integration ${integration.id} disabled until ${disableUntil.toISOString()} after ${failures} consecutive failures`,
      );
    }

    throw error;
  }
}

async function passesLearnedRules(
  userId: string,
  fromEmail: string,
  subject: string,
): Promise<boolean> {
  const rules = await db.query.emailFilterRules.findMany({
    where: and(
      eq(emailFilterRules.userId, userId),
      eq(emailFilterRules.isActive, true),
    ),
    columns: { id: true, ruleType: true, pattern: true },
  });

  const sender = fromEmail.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const senderDomain = sender.split("@")[1] || "";

  for (const rule of rules) {
    let matched = false;
    switch (rule.ruleType) {
      case "sender_email":
        matched = sender === rule.pattern;
        break;
      case "sender_domain":
        matched =
          senderDomain === rule.pattern ||
          senderDomain.endsWith(`.${rule.pattern}`);
        break;
      case "subject_contains":
        matched = lowerSubject.includes(rule.pattern);
        break;
    }

    if (matched) {
      // Increment match count async (fire-and-forget)
      db.update(emailFilterRules)
        .set({
          matchCount: sql`${emailFilterRules.matchCount} + 1`,
          lastMatchedAt: new Date(),
        })
        .where(eq(emailFilterRules.id, rule.id))
        .catch(() => {});
      return false;
    }
  }

  return true;
}

function passesEmailFilters(
  integration: typeof emailIntegrations.$inferSelect,
  fromEmail: string,
  subject?: string,
): boolean {
  const sender = fromEmail.toLowerCase();
  const subjectText = subject?.toLowerCase() || "";

  // Block disposable/temporary email addresses
  if (isDisposableEmail(sender)) {
    return false;
  }

  if (
    integration.senderBlacklist?.some((blocked) =>
      sender.includes(blocked.toLowerCase()),
    )
  ) {
    return false;
  }

  if (
    integration.senderWhitelist &&
    integration.senderWhitelist.length > 0 &&
    !integration.senderWhitelist.some((allowed) =>
      sender.includes(allowed.toLowerCase()),
    )
  ) {
    return false;
  }

  if (integration.subjectFilters && integration.subjectFilters.length > 0) {
    const hasMatch = integration.subjectFilters.some((pattern) => {
      const trimmed = pattern.trim();
      if (!isSafeSubjectFilter(trimmed)) {
        return false;
      }
      try {
        return new RegExp(trimmed, "i").test(subjectText);
      } catch {
        return false;
      }
    });
    if (!hasMatch) {
      return false;
    }
  }

  return true;
}

const MAX_SUBJECT_FILTER_LENGTH = 120;
const UNSAFE_REGEX_PATTERN =
  /(\([^)]*[+*][^)]*\)[+*{])|(\.\*){2,}|(\+|\*){2,}|\{\d+,\d*\}\s*[+*]/;

function isSafeSubjectFilter(pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.length > MAX_SUBJECT_FILTER_LENGTH) return false;
  if (UNSAFE_REGEX_PATTERN.test(pattern)) return false;
  return true;
}
