import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { emailIntegrations } from "@/lib/db/schema";
import { processEmailSyncQueue } from "@/lib/workers/email-sync-worker";

export const GET = withCronLogging("email-sync", async (request) => {
  // Health check mode — return a Response directly so caller gets raw status
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "health") {
    const integrations = await db.query.emailIntegrations.findMany({
      where: eq(emailIntegrations.syncEnabled, true),
      columns: {
        lastSyncedAt: true,
        lastSyncStatus: true,
        lastHeartbeat: true,
        consecutiveSyncFailures: true,
        uidValidity: true,
        highestProcessedUid: true,
        processedEmailsCount: true,
      },
    });

    return NextResponse.json({
      success: true,
      activeIntegrations: integrations.length,
      integrations: integrations.map((i) => ({
        lastSyncedAt: i.lastSyncedAt,
        lastSyncStatus: i.lastSyncStatus,
        lastHeartbeat: i.lastHeartbeat,
        consecutiveSyncFailures: i.consecutiveSyncFailures,
        uidValidity: i.uidValidity,
        highestProcessedUid: i.highestProcessedUid,
        processedEmailsCount: i.processedEmailsCount,
      })),
    });
  }

  // En fejl logges og rapporteres én gang af withCronLogging.
  const result = await processEmailSyncQueue();

  // Stale sync detection: flag integrations that haven't synced in 2x their frequency
  const activeIntegrations = await db.query.emailIntegrations.findMany({
    where: eq(emailIntegrations.syncEnabled, true),
    columns: {
      id: true,
      syncFrequencyMinutes: true,
      lastSyncedAt: true,
      lastSyncStatus: true,
    },
  });

  const now = Date.now();
  let staleCount = 0;
  for (const integration of activeIntegrations) {
    if (!integration.lastSyncedAt) continue;
    const staleThresholdMs = integration.syncFrequencyMinutes * 2 * 60 * 1000;
    const msSinceSync = now - new Date(integration.lastSyncedAt).getTime();
    if (
      msSinceSync > staleThresholdMs &&
      integration.lastSyncStatus !== "stale"
    ) {
      await db
        .update(emailIntegrations)
        .set({ lastSyncStatus: "stale", updatedAt: new Date() })
        .where(eq(emailIntegrations.id, integration.id));
      console.warn(
        `[Cron] Email sync stale for integration ${integration.id} — last sync ${Math.round(msSinceSync / 60000)}min ago (threshold: ${integration.syncFrequencyMinutes * 2}min)`,
      );
      staleCount++;
    }
  }

  return {
    itemsProcessed: result.processed,
    itemsSucceeded: result.processed,
    staleIntegrations: staleCount,
  };
});
