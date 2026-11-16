import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cronJobLogs } from "@/lib/db/schema";
import { captureRouteError } from "@/lib/utils/sentry";
import { startCronRun } from "./run-guard";

interface CronRunResult {
  itemsProcessed?: number;
  itemsSucceeded?: number;
  itemsFailed?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Wraps a cron route handler with:
 * - Bearer CRON_SECRET auth check
 * - cron_job_logs row (started → success|error|partial)
 * - overlap-guard: en kørsel springes over, mens forrige kørsel af samme job er i gang
 * - Sentry-event når handleren kaster
 *
 * Usage:
 *   export const GET = withCronLogging("import", async (request) => {
 *     // existing body — must return either a CronRunResult (for JSON success)
 *     // or throw an Error (will be logged as 'error')
 *     return { itemsProcessed: 10, itemsSucceeded: 9, itemsFailed: 1 };
 *   });
 */
export function withCronLogging(
  jobName: string,
  handler: (request: Request) => Promise<CronRunResult | Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { error: "Cron not configured" },
        { status: 500 },
      );
    }
    const authHeader = request.headers.get("authorization");
    const expected = `Bearer ${cronSecret}`;
    if (
      !authHeader ||
      authHeader.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startedAt = new Date();
    const logRowId = await startCronRun(jobName, startedAt);
    if (!logRowId) {
      // Forrige kørsel er stadig i gang: 200, så curl -f ikke melder fejl.
      console.warn(`[Cron] ${jobName} skipped: previous run still running`);
      return NextResponse.json({ success: true, jobName, skipped: true });
    }

    try {
      const result = await handler(request);

      // If handler returned a Response object directly, still log success
      // with no item counts
      if (result instanceof Response) {
        const completedAt = new Date();
        await db
          .update(cronJobLogs)
          .set({
            status: "success",
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
          })
          .where(eq(cronJobLogs.id, logRowId));
        return result;
      }

      // Handler returned a CronRunResult
      const { itemsProcessed, itemsSucceeded, itemsFailed, metadata } = result;
      const completedAt = new Date();
      const hasPartialFailure =
        typeof itemsFailed === "number" && itemsFailed > 0;
      await db
        .update(cronJobLogs)
        .set({
          status: hasPartialFailure ? "partial" : "success",
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          itemsProcessed: itemsProcessed ?? 0,
          itemsSucceeded: itemsSucceeded ?? 0,
          itemsFailed: itemsFailed ?? 0,
          metadata: metadata ?? null,
        })
        .where(eq(cronJobLogs.id, logRowId));

      return NextResponse.json({
        success: true,
        jobName,
        itemsProcessed: itemsProcessed ?? 0,
        itemsSucceeded: itemsSucceeded ?? 0,
        itemsFailed: itemsFailed ?? 0,
      });
    } catch (error) {
      // cron_job_logs alene giver ingen alarm, så en cron der begynder at
      // fejle, opdages først når nogen kigger i admin-monitoringen.
      captureRouteError(error, {
        route: `/api/cron/${jobName}`,
        type: "cron",
        extra: { jobName },
      });
      const completedAt = new Date();
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      try {
        await db
          .update(cronJobLogs)
          .set({
            status: "error",
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            errorMessage: errorMessage.slice(0, 8000),
          })
          .where(eq(cronJobLogs.id, logRowId));
      } catch (dbErr) {
        console.error(`[${jobName}] Failed to log cron error:`, dbErr);
      }
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
