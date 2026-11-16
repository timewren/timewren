import { lt } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  deviceAuthCodes,
  deviceIdempotencyKeys,
  stripeWebhookEvents,
  timerEvents,
  webhookEvents,
} from "@/lib/db/schema";
import { TIMER_EVENT_RETENTION_DAYS } from "@/lib/timer/events";
import { captureRouteError } from "@/lib/utils/sentry";
import { cleanupOldDeliveries } from "@/lib/webhooks/delivery";

/**
 * Cron job to clean up old webhook delivery logs
 * Keeps successful deliveries for 30 days, failed for 90 days
 * Also cleans up Stripe webhook event idempotency records older than 90 days
 * and the timer event log (timer_events) older than 30 days.
 *
 * Schedule: Daily at 3 AM (configured externally)
 */
export const GET = withCronLogging("webhook-cleanup", async (_request) => {
  const now = new Date();
  console.warn(
    `[Webhook Cleanup] Starting cleanup job at ${now.toISOString()}`,
  );

  let deliveryResults: Awaited<ReturnType<typeof cleanupOldDeliveries>>;
  try {
    deliveryResults = await cleanupOldDeliveries();
  } catch (error) {
    captureRouteError(error, {
      route: "/api/cron/webhook-cleanup",
      type: "cron",
    });
    throw error;
  }

  // Clean up old webhook events (older than 90 days)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const deletedLegacy = await db
    .delete(stripeWebhookEvents)
    .where(lt(stripeWebhookEvents.createdAt, cutoff));
  const legacyEventsDeleted =
    (deletedLegacy as unknown as { rowCount?: number }).rowCount ?? 0;

  const deletedNew = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.createdAt, cutoff));
  const webhookEventsDeleted =
    (deletedNew as unknown as { rowCount?: number }).rowCount ?? 0;

  // Timerens hændelseslog (A6) er et fejlsøgningsspor, ikke historik:
  // 30 dage rækker til at undersøge en kundeklage.
  const timerCutoff = new Date();
  timerCutoff.setDate(timerCutoff.getDate() - TIMER_EVENT_RETENTION_DAYS);
  const deletedTimerEvents = await db
    .delete(timerEvents)
    .where(lt(timerEvents.createdAt, timerCutoff));
  const timerEventsDeleted =
    (deletedTimerEvents as unknown as { rowCount?: number; count?: number })
      .rowCount ??
    (deletedTimerEvents as unknown as { count?: number }).count ??
    0;

  // Engangskoder fra enheds-login gælder 5 minutter. Et døgn efter udløb
  // er de (brugte som ubrugte) kun døde rækker.
  const deviceCodeCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const deletedDeviceCodes = await db
    .delete(deviceAuthCodes)
    .where(lt(deviceAuthCodes.expiresAt, deviceCodeCutoff));
  const deviceCodesDeleted =
    (deletedDeviceCodes as unknown as { rowCount?: number }).rowCount ?? 0;

  // Idempotensnøgler gælder 24 timer; derefter er de døde rækker.
  const deletedIdempotencyKeys = await db
    .delete(deviceIdempotencyKeys)
    .where(lt(deviceIdempotencyKeys.createdAt, deviceCodeCutoff));
  const idempotencyKeysDeleted =
    (deletedIdempotencyKeys as unknown as { rowCount?: number }).rowCount ??
    (deletedIdempotencyKeys as unknown as { count?: number }).count ??
    0;

  const totalDeleted =
    legacyEventsDeleted +
    webhookEventsDeleted +
    timerEventsDeleted +
    deviceCodesDeleted +
    idempotencyKeysDeleted;

  console.warn(
    `[Webhook Cleanup] Completed: deliveries cleaned. Legacy events: ${legacyEventsDeleted}, webhook events: ${webhookEventsDeleted}`,
  );

  return {
    itemsProcessed: totalDeleted,
    itemsSucceeded: totalDeleted,
    metadata: {
      ...deliveryResults,
      legacyEventsDeleted,
      webhookEventsDeleted,
      timerEventsDeleted,
      deviceCodesDeleted,
      idempotencyKeysDeleted,
    },
  };
});
