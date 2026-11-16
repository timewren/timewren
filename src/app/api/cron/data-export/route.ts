import { and, eq, inArray, lte, notInArray } from "drizzle-orm";
import { getAppUrl } from "@/lib/config";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { dataExportRequests, users } from "@/lib/db/schema";
import { sendDataExportReady } from "@/lib/email/data-export";
import {
  ORG_EXPORT_DOWNLOADABLE,
  ZIP_EXPORT_TYPES,
} from "@/lib/export/org-export/access";
import { processOrgExports } from "@/lib/export/org-export/job";
import { revealToken } from "@/lib/security/token-hash";
import { generateUserDataExport } from "@/lib/utils/data-export";
import { captureRouteError } from "@/lib/utils/sentry";

// Process pending data export requests
// Schedule: */2 * * * * (every 2 minutes)

const MAX_BATCH_SIZE = 5;

export const GET = withCronLogging("data-export", async (_request) => {
  // 1. Expire old requests (de gamle personlige eksporter genereres ved
  // download; ZIP-eksporterne, både organisation og bruger, ryddes op i
  // processOrgExports nedenfor, så objektet i lageret slettes med)
  const now = new Date();
  await db
    .update(dataExportRequests)
    .set({ status: "expired" })
    .where(
      and(
        notInArray(dataExportRequests.requestType, [...ZIP_EXPORT_TYPES]),
        inArray(dataExportRequests.status, [...ORG_EXPORT_DOWNLOADABLE]),
        lte(dataExportRequests.expiresAt, now),
      ),
    );

  // 2. Organisations-eksporter: oprydning + højst én ny pr. kørsel
  const orgResult = await processOrgExports(db);

  // 3. Find pending personal (GDPR) requests
  const pendingRequests = await db.query.dataExportRequests.findMany({
    where: and(
      eq(dataExportRequests.status, "pending"),
      notInArray(dataExportRequests.requestType, [...ZIP_EXPORT_TYPES]),
    ),
    orderBy: (table, { asc }) => [asc(table.createdAt)],
    limit: MAX_BATCH_SIZE,
  });

  if (pendingRequests.length === 0) {
    return {
      itemsProcessed: orgResult.processed,
      itemsSucceeded: orgResult.succeeded,
      itemsFailed: orgResult.failed,
      metadata: orgResult.errors.length
        ? { errors: orgResult.errors }
        : undefined,
    };
  }

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const request of pendingRequests) {
    try {
      // Set status to processing
      await db
        .update(dataExportRequests)
        .set({ status: "processing" })
        .where(eq(dataExportRequests.id, request.id));

      // Generate export data
      const exportData = await generateUserDataExport(db, request.userId);

      // Calculate approximate size
      const jsonString = JSON.stringify(exportData);
      const fileSizeBytes = new TextEncoder().encode(jsonString).length;

      // Mark as ready
      await db
        .update(dataExportRequests)
        .set({
          status: "ready",
          processedAt: new Date(),
          fileSizeBytes,
        })
        .where(eq(dataExportRequests.id, request.id));

      // Send notification email
      const user = await db.query.users.findFirst({
        where: eq(users.id, request.userId),
        columns: { name: true, email: true },
      });

      const downloadToken = revealToken(request.downloadTokenEncrypted);
      if (user && downloadToken) {
        const appUrl = getAppUrl();
        const downloadUrl = `${appUrl}/api/data-export/${downloadToken}`;

        try {
          await sendDataExportReady({
            to: user.email,
            recipientName: user.name,
            downloadUrl,
            expiresAt: request.expiresAt.toISOString(),
            format: request.format,
            userId: request.userId,
          });
        } catch (emailErr) {
          // Don't fail the export if email fails
          console.error(
            `Failed to send data export email for request ${request.id}:`,
            emailErr,
          );
        }
      }

      processed++;
    } catch (err) {
      console.error(
        `Failed to process data export request ${request.id}:`,
        err,
      );

      await db
        .update(dataExportRequests)
        .set({
          status: "failed",
          errorMessage: (err as Error).message,
        })
        .where(eq(dataExportRequests.id, request.id));

      failed++;
      errors.push(`Request ${request.id}: ${(err as Error).message}`);
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/data-export",
      type: "cron",
    });
  }

  errors.push(...orgResult.errors);
  return {
    itemsProcessed: pendingRequests.length + orgResult.processed,
    itemsSucceeded: processed + orgResult.succeeded,
    itemsFailed: failed + orgResult.failed,
    metadata: errors.length > 0 ? { errors } : undefined,
  };
});
