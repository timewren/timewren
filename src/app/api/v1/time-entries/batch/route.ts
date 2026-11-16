import type { NextRequest } from "next/server";
import {
  authenticateApiKey,
  corsPreflightResponse,
  errorResponse,
  handleTrpcError,
  requireScope,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";

const MAX_BATCH_SIZE = 500;

/**
 * POST /api/v1/time-entries/batch — Batch operations on time entries
 *
 * Operations:
 * - import: Bulk import time entries
 * - delete: Bulk delete time entries by IDs
 * - markBilled: Bulk mark time entries as billed/unbilled
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "time", "write");
  if (scopeErr) return scopeErr;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const b = body as Record<string, unknown>;
    const operation = b.operation as string;

    switch (operation) {
      case "import": {
        const entries = b.entries as unknown;
        if (!Array.isArray(entries)) {
          return errorResponse(400, "BAD_REQUEST", "entries must be an array");
        }
        if (entries.length === 0) {
          return errorResponse(400, "BAD_REQUEST", "entries array is empty");
        }
        if (entries.length > MAX_BATCH_SIZE) {
          return errorResponse(
            400,
            "BAD_REQUEST",
            `Cannot import more than ${MAX_BATCH_SIZE} entries at once`,
          );
        }
        const result = await auth.context.caller.time.bulkImport({
          entries: entries as Array<{
            date: string;
            hours: number;
            description: string;
            projectName?: string;
            clientName?: string;
          }>,
          defaultProjectId: b.defaultProjectId as string | undefined,
          skipDuplicates: (b.skipDuplicates as boolean) ?? true,
        });
        return withRateLimitHeaders(
          successResponse(result, 201),
          auth.context.rateLimit,
        );
      }

      case "delete": {
        const ids = b.ids as string[];
        if (!Array.isArray(ids) || ids.length === 0) {
          return errorResponse(
            400,
            "BAD_REQUEST",
            "ids array is required for delete operation",
          );
        }
        if (ids.length > MAX_BATCH_SIZE) {
          return errorResponse(
            400,
            "BAD_REQUEST",
            `Cannot process more than ${MAX_BATCH_SIZE} items at once`,
          );
        }
        const result = await auth.context.caller.time.bulkDelete({ ids });
        return withRateLimitHeaders(
          successResponse(result),
          auth.context.rateLimit,
        );
      }

      case "markBilled": {
        const ids = b.ids as string[];
        if (!Array.isArray(ids) || ids.length === 0) {
          return errorResponse(
            400,
            "BAD_REQUEST",
            "ids array is required for markBilled operation",
          );
        }
        if (ids.length > MAX_BATCH_SIZE) {
          return errorResponse(
            400,
            "BAD_REQUEST",
            `Cannot process more than ${MAX_BATCH_SIZE} items at once`,
          );
        }
        const result = await auth.context.caller.time.bulkMarkBilled({
          ids,
          isBilled: (b.isBilled as boolean) ?? true,
        });
        return withRateLimitHeaders(
          successResponse(result),
          auth.context.rateLimit,
        );
      }

      default:
        return errorResponse(
          400,
          "BAD_REQUEST",
          `Unknown operation: ${operation}. Valid operations: import, delete, markBilled`,
        );
    }
  } catch (error) {
    return handleTrpcError(error);
  }
}

export function OPTIONS() {
  return corsPreflightResponse();
}
