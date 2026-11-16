import { and, eq } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { calendarConnections } from "@/lib/db/schema";
import { registerWebhookChannel } from "@/lib/integrations/google-calendar";

// Cron schedule: 0 3 * * * (Daily at 03:00)
// Renews webhook channels for all active calendar connections.
// Google Calendar channels expire after 7 days, so daily renewal ensures no gaps.

export const GET = withCronLogging(
  "calendar-webhook-renew",
  async (_request) => {
    // Get all active connections
    const connections = await db.query.calendarConnections.findMany({
      where: and(
        eq(calendarConnections.provider, "google"),
        eq(calendarConnections.syncEnabled, true),
      ),
    });

    let renewed = 0;
    let failed = 0;

    for (const conn of connections) {
      try {
        const result = await registerWebhookChannel(conn.userId);
        if (result.success) {
          renewed++;
        } else {
          failed++;
          console.error(
            `[Webhook Renew] Failed for ${conn.id}: ${result.error}`,
          );
        }
      } catch (err) {
        failed++;
        console.error(`[Webhook Renew] Error for ${conn.id}:`, err);
      }
    }

    return {
      itemsProcessed: connections.length,
      itemsSucceeded: renewed,
      itemsFailed: failed,
    };
  },
);
