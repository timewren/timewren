import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  outgoingWebhooks,
  type WebhookEventType,
  webhookDeliveries,
} from "@/lib/db/schema";
import { isDemoMode, logDemoSuppressed } from "@/lib/demo/demo-mode";
import { validateUrlForSSRF } from "@/lib/utils/ssrf-protection";
import { signWebhookPayload } from "./signing";

interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Sanitize response body to redact potentially sensitive data
 * Redacts common patterns like API keys, tokens, passwords, etc.
 */
function sanitizeResponseBody(body: string, maxLength: number = 1000): string {
  if (!body) return "";

  // Patterns to redact (case-insensitive)
  const sensitivePatterns = [
    // API keys and tokens
    /("?(?:api[_-]?key|apikey|api[_-]?secret|token|access[_-]?token|refresh[_-]?token|bearer|authorization|auth[_-]?token|secret[_-]?key|private[_-]?key)"?\s*[:=]\s*)"?[a-zA-Z0-9_\-./+=]{8,}"?/gi,
    // Passwords
    /("?(?:password|passwd|pwd|pass)"?\s*[:=]\s*)"?[^"'\s,}\]]{1,}"?/gi,
    // Credit card numbers (basic pattern)
    /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
    // Email addresses (partial redaction)
    /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
  ];

  let sanitized = body;

  // Apply redactions
  sanitized = sanitized.replace(sensitivePatterns[0], '$1"[REDACTED]"');
  sanitized = sanitized.replace(sensitivePatterns[1], '$1"[REDACTED]"');
  sanitized = sanitized.replace(sensitivePatterns[2], "[CARD REDACTED]");
  sanitized = sanitized.replace(sensitivePatterns[3], "[EMAIL]@$2");

  // Truncate to max length
  if (sanitized.length > maxLength) {
    return `${sanitized.substring(0, maxLength)}...[truncated]`;
  }

  return sanitized;
}

// Svaret gemmes kun som de første 1000 tegn (sanitizeResponseBody), så der er
// ingen grund til at læse mere end lidt over det fra modtageren (#1111).
const MAX_RESPONSE_BYTES = 16 * 1024;

/**
 * Læs højst maxBytes af svar-body og afbryd resten. Afbrydes signalet
 * undervejs (timeout), kastes en AbortError, så en modtager der sender
 * langsomt eller i det uendelige ikke kan holde leveringen fast.
 */
async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (!response.body) return "";
  if (signal.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  const reader = response.body.getReader();
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort);
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, maxBytes - received);
      received += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    if (signal.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    if (received >= maxBytes) {
      await reader.cancel().catch(() => {});
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Deliver a webhook to a single endpoint
 */
async function deliverWebhook(
  webhook: typeof outgoingWebhooks.$inferSelect,
  payload: WebhookPayload,
  attemptNumber: number = 1,
): Promise<{
  success: boolean;
  responseStatus?: number;
  responseBody?: string;
  responseTimeMs?: number;
  error?: string;
}> {
  // Offentlig demo: ingen udgående webhooks.
  if (isDemoMode()) {
    logDemoSuppressed("Webhook");
    return { success: false, responseTimeMs: 0, error: "Demo" };
  }

  const payloadString = JSON.stringify(payload);
  const startTime = Date.now();

  let signature: string;
  try {
    signature = signWebhookPayload(payloadString, webhook.secret);
  } catch (error) {
    console.error(
      `[webhooks] secret for webhook ${webhook.id} kunne ikke dekrypteres:`,
      error instanceof Error ? error.message : error,
    );
    return {
      success: false,
      responseTimeMs: 0,
      error: "Webhook-secret kunne ikke læses",
    };
  }

  // SSRF-revalidering (#203): URL'en valideres ved create/update, men DNS
  // kan re-peges bagefter (rebinding TOCTOU). Validér igen umiddelbart før
  // fetch — fejl tæller som failed delivery (og auto-disabler efter 10).
  const ssrfError = await validateUrlForSSRF(webhook.url, {
    rejectOnDnsFailure: true,
  });
  if (ssrfError) {
    return {
      success: false,
      responseTimeMs: Date.now() - startTime,
      error: `SSRF-guard: ${ssrfError}`,
    };
  }

  const controller = new AbortController();
  // Timeouten dækker både forbindelse og læsning af svaret (#1111).
  const timeoutId = setTimeout(() => controller.abort(), webhook.timeoutMs);

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": payload.event,
        "X-Webhook-Timestamp": payload.timestamp,
        "X-Webhook-Delivery-Attempt": String(attemptNumber),
        "User-Agent": "TimeTrack-Webhooks/1.0",
      },
      body: payloadString,
      signal: controller.signal,
      // Følg aldrig redirects: SSRF-checket ovenfor gælder kun den
      // oprindelige URL, ikke et Location-mål (#1111). 3xx tæller som fejl.
      redirect: "manual",
    });

    const responseTimeMs = Date.now() - startTime;
    const responseBody = await readBoundedBody(
      response,
      MAX_RESPONSE_BYTES,
      controller.signal,
    ).catch((error) => {
      // Timeout skal stadig melde fejl; andre læsefejl ignoreres som før.
      if (controller.signal.aborted) throw error;
      return "";
    });

    if (response.ok) {
      return {
        success: true,
        responseStatus: response.status,
        responseBody: sanitizeResponseBody(responseBody),
        responseTimeMs,
      };
    }

    return {
      success: false,
      responseStatus: response.status,
      responseBody: sanitizeResponseBody(responseBody),
      responseTimeMs,
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          success: false,
          responseTimeMs,
          error: `Request timed out after ${webhook.timeoutMs}ms`,
        };
      }
      return {
        success: false,
        responseTimeMs,
        error: error.message,
      };
    }

    return {
      success: false,
      responseTimeMs,
      error: "Unknown error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Ventetid før næste forsøg efter forsøg nr. n (indeks n-1); sidste værdi
// gentages. Cron kører hvert 5. minut, så 1 min betyder "næste kørsel".
const RETRY_BACKOFF_MINUTES = [1, 5, 30, 120, 360];

/** Tidspunkt for næste forsøg, efter at forsøg nr. attemptNumber fejlede. */
export function nextRetryAt(attemptNumber: number, now = new Date()): Date {
  const index = Math.min(
    Math.max(attemptNumber, 1) - 1,
    RETRY_BACKOFF_MINUTES.length - 1,
  );
  return new Date(now.getTime() + RETRY_BACKOFF_MINUTES[index] * 60_000);
}

// Retry-kørslen claimer en batch ved at skubbe scheduled_for frem (lease), så
// overlappende cron-kørsler ikke leverer de samme rækker igen. Med højst 60 s
// HTTP-timeout pr. levering tager en batch typisk højst 50 / 5 * 60 s = 10 min,
// så leasen har luft. DNS-opslag og DB-skrivninger ligger uden for timeouten,
// så det er ikke en hård grænse; overskrides leasen, kan en række leveres igen.
const RETRY_BATCH_SIZE = 50;
const RETRY_CONCURRENCY = 5;
const RETRY_CLAIM_LEASE_MS = 15 * 60_000;

/**
 * Trigger webhooks for a specific event
 */
export async function triggerWebhooks(
  userId: string,
  eventType: WebhookEventType,
  eventId: string | null,
  data: Record<string, unknown>,
  filters?: {
    clientId?: string;
    projectId?: string;
  },
  orgId?: string | null,
): Promise<{
  triggered: number;
  delivered: number;
  failed: number;
}> {
  // Find all active webhooks for this user/org that subscribe to this event
  const webhooks = await db.query.outgoingWebhooks.findMany({
    where: and(
      orgId
        ? eq(outgoingWebhooks.organizationId, orgId)
        : eq(outgoingWebhooks.userId, userId),
      eq(outgoingWebhooks.isActive, true),
    ),
  });

  // Filter webhooks by event type and optional client/project filters
  const matchingWebhooks = webhooks.filter((webhook) => {
    // Check if webhook subscribes to this event
    const events = webhook.events as WebhookEventType[];
    if (!events.includes(eventType)) return false;

    // Check client filter
    if (webhook.clientId && filters?.clientId !== webhook.clientId)
      return false;

    // Check project filter
    if (webhook.projectId && filters?.projectId !== webhook.projectId)
      return false;

    return true;
  });

  const results = {
    triggered: matchingWebhooks.length,
    delivered: 0,
    failed: 0,
  };

  if (matchingWebhooks.length === 0) {
    return results;
  }

  const payload: WebhookPayload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    data,
  };

  // Deliver to each webhook
  for (const webhook of matchingWebhooks) {
    const deliveryResult = await deliverWebhook(webhook, payload);

    // Create delivery record
    // Status flow: pending_retry -> success OR pending_retry -> failed (max retries)
    await db.insert(webhookDeliveries).values({
      webhookId: webhook.id,
      eventType,
      eventId,
      payload,
      attemptNumber: 1,
      status: deliveryResult.success ? "success" : "pending_retry",
      responseStatus: deliveryResult.responseStatus,
      responseBody: deliveryResult.responseBody,
      responseTimeMs: deliveryResult.responseTimeMs,
      errorMessage: deliveryResult.error,
      deliveredAt: deliveryResult.success ? new Date() : null,
      ...(deliveryResult.success ? {} : { scheduledFor: nextRetryAt(1) }),
    });

    // Update webhook stats using atomic SQL increments to prevent race conditions
    if (deliveryResult.success) {
      await db
        .update(outgoingWebhooks)
        .set({
          totalDeliveries: sql`${outgoingWebhooks.totalDeliveries} + 1`,
          successfulDeliveries: sql`${outgoingWebhooks.successfulDeliveries} + 1`,
          lastDeliveryAt: new Date(),
          lastDeliveryStatus: "success",
          consecutiveFailures: 0,
          updatedAt: new Date(),
        })
        .where(eq(outgoingWebhooks.id, webhook.id));
    } else {
      // For failures, we need to check consecutive failures for auto-disable
      // Use a subquery to atomically increment and check
      await db
        .update(outgoingWebhooks)
        .set({
          totalDeliveries: sql`${outgoingWebhooks.totalDeliveries} + 1`,
          failedDeliveries: sql`${outgoingWebhooks.failedDeliveries} + 1`,
          lastDeliveryAt: new Date(),
          lastDeliveryStatus: "failed",
          consecutiveFailures: sql`${outgoingWebhooks.consecutiveFailures} + 1`,
          // Auto-disable after 10 consecutive failures
          isActive: sql`CASE WHEN ${outgoingWebhooks.consecutiveFailures} >= 9 THEN false ELSE ${outgoingWebhooks.isActive} END`,
          disabledAt: sql`CASE WHEN ${outgoingWebhooks.consecutiveFailures} >= 9 THEN NOW() ELSE ${outgoingWebhooks.disabledAt} END`,
          disabledReason: sql`CASE WHEN ${outgoingWebhooks.consecutiveFailures} >= 9 THEN 'Auto-disabled after 10 consecutive failures' ELSE ${outgoingWebhooks.disabledReason} END`,
          updatedAt: new Date(),
        })
        .where(eq(outgoingWebhooks.id, webhook.id));
    }

    if (deliveryResult.success) {
      results.delivered++;
    } else {
      results.failed++;
    }
  }

  return results;
}

/**
 * Retry failed webhook deliveries
 * Should be called by a cron job
 *
 * Status flow:
 * - pending_retry: Delivery failed, eligible for retry
 * - success: Delivery succeeded
 * - failed: Max retries exceeded, permanently failed
 */
export async function retryFailedWebhooks(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  permanentlyFailed: number;
}> {
  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    permanentlyFailed: 0,
  };

  // Claim forfaldne leveringer atomisk (#1111): SKIP LOCKED gør, at en
  // samtidig kørsel springer rækkerne over, og den fremskudte scheduled_for
  // holder dem ude af senere kørsler, indtil denne er færdig med dem.
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + RETRY_CLAIM_LEASE_MS);
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE webhook_deliveries
    SET scheduled_for = ${leaseUntil.toISOString()}::timestamp
    WHERE id IN (
      SELECT id FROM webhook_deliveries
      WHERE status = 'pending_retry'
        AND scheduled_for <= ${now.toISOString()}::timestamp
      ORDER BY scheduled_for ASC
      LIMIT ${RETRY_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  // Handle both Postgres.js and node-postgres result shapes
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle result types vary
  const claimedRows = ((claimed as any).rows ?? claimed) as { id: string }[];
  const claimedIds = Array.isArray(claimedRows)
    ? claimedRows.map((row) => row.id)
    : [];

  if (claimedIds.length === 0) {
    return results;
  }

  const pendingDeliveries = await db.query.webhookDeliveries.findMany({
    where: inArray(webhookDeliveries.id, claimedIds),
    with: {
      webhook: true,
    },
    orderBy: [asc(webhookDeliveries.createdAt)],
  });

  const retryOne = async (delivery: (typeof pendingDeliveries)[number]) => {
    if (!delivery.webhook?.isActive) {
      // Skip if webhook is disabled - mark as failed to prevent infinite pending
      await db
        .update(webhookDeliveries)
        .set({
          status: "failed",
          errorMessage: "Webhook disabled",
          scheduledFor: new Date(),
        })
        .where(eq(webhookDeliveries.id, delivery.id));
      results.permanentlyFailed++;
      return;
    }

    results.processed++;

    // Check if we've exceeded retry count BEFORE attempting
    if (delivery.attemptNumber >= delivery.webhook.retryCount) {
      await db
        .update(webhookDeliveries)
        .set({ status: "failed", scheduledFor: new Date() })
        .where(eq(webhookDeliveries.id, delivery.id));
      results.permanentlyFailed++;
      return;
    }

    // Retry delivery
    const payload = delivery.payload as WebhookPayload;
    const nextAttempt = delivery.attemptNumber + 1;
    const isLastAttempt = nextAttempt >= delivery.webhook.retryCount;

    const deliveryResult = await deliverWebhook(
      delivery.webhook,
      payload,
      nextAttempt,
    );

    // Determine new status
    let newStatus: string;
    if (deliveryResult.success) {
      newStatus = "success";
      results.succeeded++;
    } else if (isLastAttempt) {
      newStatus = "failed"; // Permanently failed
      results.permanentlyFailed++;
    } else {
      newStatus = "pending_retry"; // Still has retries left
      results.failed++;
    }

    // Update delivery record
    await db
      .update(webhookDeliveries)
      .set({
        attemptNumber: nextAttempt,
        status: newStatus,
        responseStatus: deliveryResult.responseStatus,
        responseBody: deliveryResult.responseBody,
        responseTimeMs: deliveryResult.responseTimeMs,
        errorMessage: deliveryResult.error,
        deliveredAt: deliveryResult.success ? new Date() : null,
        // Backoff: næste forsøg først efter ventetiden (#1111). Afsluttede
        // rækker får leasen fjernet igen.
        scheduledFor:
          newStatus === "pending_retry" ? nextRetryAt(nextAttempt) : new Date(),
      })
      .where(eq(webhookDeliveries.id, delivery.id));

    // Update webhook stats using atomic increments
    if (deliveryResult.success) {
      await db
        .update(outgoingWebhooks)
        .set({
          successfulDeliveries: sql`${outgoingWebhooks.successfulDeliveries} + 1`,
          lastDeliveryStatus: "success",
          consecutiveFailures: 0,
          updatedAt: new Date(),
        })
        .where(eq(outgoingWebhooks.id, delivery.webhook.id));
    }
    // Note: We don't increment failedDeliveries here because it was already
    // incremented on the initial failure. Retries don't count as additional failures.
  };

  // Et lille antal parallelle leveringer, så én langsom modtager ikke
  // holder hele batchen i serielle timeouts.
  for (let i = 0; i < pendingDeliveries.length; i += RETRY_CONCURRENCY) {
    await Promise.all(
      pendingDeliveries.slice(i, i + RETRY_CONCURRENCY).map(retryOne),
    );
  }

  return results;
}

/**
 * Test a webhook by sending a test payload
 */
export async function testWebhook(
  webhookId: string,
  userId: string,
  orgId?: string | null,
): Promise<{
  success: boolean;
  responseStatus?: number;
  responseTimeMs?: number;
  error?: string;
}> {
  const webhook = await db.query.outgoingWebhooks.findFirst({
    where: and(
      eq(outgoingWebhooks.id, webhookId),
      orgId
        ? eq(outgoingWebhooks.organizationId, orgId)
        : eq(outgoingWebhooks.userId, userId),
    ),
  });

  if (!webhook) {
    return { success: false, error: "Webhook not found" };
  }

  // Use the first subscribed event type for testing (or fallback)
  const webhookEvents = webhook.events as WebhookEventType[];
  const testEventType: WebhookEventType =
    webhookEvents.length > 0 ? webhookEvents[0] : "client.created";

  const testPayload: WebhookPayload = {
    event: testEventType,
    timestamp: new Date().toISOString(),
    data: {
      test: true,
      message: "This is a test webhook delivery from TimeTrack",
      webhookId: webhook.id,
      webhookName: webhook.name,
      subscribedEvents: webhookEvents,
    },
  };

  return deliverWebhook(webhook, testPayload);
}

/**
 * Clean up old webhook delivery logs
 * Keeps deliveries for retention period, deletes older ones
 * Should be called periodically (e.g., daily)
 *
 * @param retentionDays Number of days to keep successful delivery logs (default: 30)
 * @param failedRetentionDays Number of days to keep failed delivery logs (default: 90)
 */
export async function cleanupOldDeliveries(
  retentionDays: number = 30,
  failedRetentionDays: number = 90,
): Promise<{
  successCutoff: string;
  failedCutoff: string;
}> {
  const successCutoffDate = new Date();
  successCutoffDate.setDate(successCutoffDate.getDate() - retentionDays);

  const failedCutoffDate = new Date();
  failedCutoffDate.setDate(failedCutoffDate.getDate() - failedRetentionDays);

  // Delete old successful deliveries
  await db
    .delete(webhookDeliveries)
    .where(
      and(
        lt(webhookDeliveries.createdAt, successCutoffDate),
        eq(webhookDeliveries.status, "success"),
      ),
    );

  // Delete old failed deliveries (keep longer for debugging)
  await db
    .delete(webhookDeliveries)
    .where(
      and(
        lt(webhookDeliveries.createdAt, failedCutoffDate),
        eq(webhookDeliveries.status, "failed"),
      ),
    );

  // Also clean up very old pending_retry that were never resolved
  await db
    .delete(webhookDeliveries)
    .where(
      and(
        lt(webhookDeliveries.createdAt, failedCutoffDate),
        eq(webhookDeliveries.status, "pending_retry"),
      ),
    );

  return {
    successCutoff: successCutoffDate.toISOString(),
    failedCutoff: failedCutoffDate.toISOString(),
  };
}
