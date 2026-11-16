import { eq } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { calendarConnections } from "@/lib/db/schema";
import { syncCalendarEvents } from "@/lib/integrations/google-calendar";
import { syncICloudCalendars } from "@/lib/integrations/icloud-calendar";
import { captureRouteError } from "@/lib/utils/sentry";

/**
 * Calculate exponential backoff duration based on failure count
 * Returns milliseconds to wait before next attempt
 */
function calculateBackoffMs(failures: number): number {
  // Exponential backoff: 15min, 30min, 1h, 2h, 4h, max 8h
  const baseMs = 15 * 60 * 1000; // 15 minutes
  const maxMs = 8 * 60 * 60 * 1000; // 8 hours
  const backoffMs = Math.min(baseMs * 2 ** (failures - 1), maxMs);
  return backoffMs;
}

/**
 * Cron job to automatically sync Google Calendar for all connected users
 * Implements exponential backoff for persistent failures
 *
 * Schedule: Every 15 minutes (configured externally)
 */
export const GET = withCronLogging("calendar-sync", async (_request) => {
  const now = new Date();
  console.warn(
    `[Calendar Sync] Starting automatic sync at ${now.toISOString()}`,
  );

  // Find all active calendar connections that should be synced
  const connections = await db.query.calendarConnections.findMany({
    where: eq(calendarConnections.syncEnabled, true),
  });

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  // Filter connections based on multiple criteria
  const connectionsToSync = connections.filter((conn) => {
    // iCloud-kalendere synkes via forælder-forbindelsen (den bærer login)
    if (conn.provider === "apple" && conn.parentConnectionId) {
      return false;
    }
    // Skip if in backoff period
    if (conn.syncDisabledUntil && new Date(conn.syncDisabledUntil) > now) {
      return false;
    }
    // Skip if synced recently
    if (conn.lastSynced && new Date(conn.lastSynced) >= tenMinutesAgo) {
      return false;
    }
    return true;
  });

  const inBackoff = connections.filter(
    (conn) => conn.syncDisabledUntil && new Date(conn.syncDisabledUntil) > now,
  ).length;

  console.warn(
    `[Calendar Sync] Found ${connectionsToSync.length} connections to sync (${connections.length} total enabled, ${inBackoff} in backoff)`,
  );

  let succeeded = 0;
  let failed = 0;
  const errors: { userId: string; error: string; backoffUntil?: string }[] = [];
  const details: { userId: string; synced: number; updated: number }[] = [];

  // Process each connection
  for (const connection of connectionsToSync) {
    try {
      console.warn(`[Calendar Sync] Syncing for user ${connection.userId}...`);

      const syncResult =
        connection.provider === "apple"
          ? await syncICloudCalendars(connection.userId)
          : await syncCalendarEvents(connection.userId);

      if (syncResult.success) {
        succeeded++;
        details.push({
          userId: connection.userId,
          synced: syncResult.synced || 0,
          updated: syncResult.updated || 0,
        });

        // Reset failure tracking on success
        await db
          .update(calendarConnections)
          .set({
            consecutiveSyncFailures: 0,
            syncDisabledUntil: null,
            syncError: null,
            updatedAt: now,
          })
          .where(eq(calendarConnections.id, connection.id));

        console.warn(
          `[Calendar Sync] User ${connection.userId}: synced ${syncResult.synced} new, updated ${syncResult.updated}`,
        );
      } else {
        failed++;
        const errorMessage = syncResult.error || "Unknown error";

        // Increment failure counter and apply backoff
        const newFailureCount = (connection.consecutiveSyncFailures || 0) + 1;
        const backoffMs = calculateBackoffMs(newFailureCount);
        const backoffUntil = new Date(Date.now() + backoffMs);

        await db
          .update(calendarConnections)
          .set({
            consecutiveSyncFailures: newFailureCount,
            syncDisabledUntil: backoffUntil,
            syncError: errorMessage,
            updatedAt: now,
          })
          .where(eq(calendarConnections.id, connection.id));

        errors.push({
          userId: connection.userId,
          error: errorMessage,
          backoffUntil: backoffUntil.toISOString(),
        });

        console.error(
          `[Calendar Sync] User ${connection.userId} failed (attempt ${newFailureCount}, backoff until ${backoffUntil.toISOString()}): ${errorMessage}`,
        );
      }
    } catch (error) {
      failed++;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Apply backoff on exception too
      const newFailureCount = (connection.consecutiveSyncFailures || 0) + 1;
      const backoffMs = calculateBackoffMs(newFailureCount);
      const backoffUntil = new Date(Date.now() + backoffMs);

      await db
        .update(calendarConnections)
        .set({
          consecutiveSyncFailures: newFailureCount,
          syncDisabledUntil: backoffUntil,
          syncError: errorMessage,
          updatedAt: now,
        })
        .where(eq(calendarConnections.id, connection.id));

      errors.push({
        userId: connection.userId,
        error: errorMessage,
        backoffUntil: backoffUntil.toISOString(),
      });

      captureRouteError(error, {
        route: "/api/cron/calendar-sync",
        type: "cron",
      });
      console.error(
        `[Calendar Sync] Fatal error for user ${connection.userId} (backoff until ${backoffUntil.toISOString()}):`,
        error,
      );
    }
  }

  console.warn(
    `[Calendar Sync] Completed: ${succeeded} succeeded, ${failed} failed, ${connections.length - connectionsToSync.length - inBackoff} skipped, ${inBackoff} in backoff`,
  );

  return {
    itemsProcessed: connectionsToSync.length,
    itemsSucceeded: succeeded,
    itemsFailed: failed,
    metadata: {
      totalConnections: connections.length,
      inBackoff,
      skipped: connections.length - connectionsToSync.length - inBackoff,
      errors: errors.length > 0 ? errors : undefined,
      details: details.length > 0 ? details : undefined,
    },
  };
});
