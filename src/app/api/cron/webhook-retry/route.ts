import { withCronLogging } from "@/lib/cron/log-cron-run";
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

  // En fejl logges og rapporteres én gang af withCronLogging.
  const results = await retryFailedWebhooks();

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
