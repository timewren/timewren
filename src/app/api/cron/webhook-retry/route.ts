import { withCronLogging } from "@/lib/cron/log-cron-run";
import { captureRouteError } from "@/lib/utils/sentry";
import { retryFailedWebhooks } from "@/lib/webhooks/delivery";

/**
 * Cron job to retry failed webhook deliveries
 * Should run every 5 minutes via Vercel Cron or similar
 *
 * Schedule: Every 5 minutes (configured in vercel.json)
 */
export const GET = withCronLogging("webhook-retry", async (_request) => {
  console.warn(
    `[Webhook Retry] Starting webhook retry job at ${new Date().toISOString()}`,
  );

  let results: Awaited<ReturnType<typeof retryFailedWebhooks>>;
  try {
    results = await retryFailedWebhooks();
  } catch (error) {
    captureRouteError(error, {
      route: "/api/cron/webhook-retry",
      type: "cron",
    });
    throw error;
  }

  console.warn(
    `[Webhook Retry] Completed: ${results.processed} processed, ${results.succeeded} succeeded, ${results.failed} failed, ${results.permanentlyFailed} permanently failed`,
  );

  return {
    itemsProcessed: results.processed,
    itemsSucceeded: results.succeeded,
    itemsFailed: results.failed + results.permanentlyFailed,
    metadata: {
      permanentlyFailed: results.permanentlyFailed,
    },
  };
});
