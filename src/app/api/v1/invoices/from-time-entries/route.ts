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

/**
 * POST /api/v1/invoices/from-time-entries
 *
 * Generate a draft invoice (with an itemized specification + computed total)
 * from time entries for a client. If `timeEntryIds` is omitted, all unbilled
 * billable entries for the client are used automatically. The selected entries
 * are marked as billed and linked to the new invoice.
 *
 * Pass `?dryRun=true` (or `{ "dryRun": true }`) to preview the line items and
 * total WITHOUT creating the invoice or marking anything billed — useful for an
 * agent to show the result before committing.
 *
 * Body: { clientId, timeEntryIds?, notes?, dueDate?, dryRun? }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "invoices", "write");
  if (scopeErr) return scopeErr;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }
    if (typeof body !== "object" || body === null) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Request body must be an object",
      );
    }
    const b = body as Record<string, unknown>;

    const clientId = b.clientId;
    if (typeof clientId !== "string" || !clientId) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "clientId is required. Use GET /api/v1/clients to list client IDs.",
      );
    }
    const notes = typeof b.notes === "string" ? b.notes : undefined;
    const dueDate = typeof b.dueDate === "string" ? b.dueDate : undefined;
    const dryRun =
      b.dryRun === true ||
      request.nextUrl.searchParams.get("dryRun") === "true";

    const explicitIds =
      Array.isArray(b.timeEntryIds) && b.timeEntryIds.length > 0
        ? b.timeEntryIds.filter((x): x is string => typeof x === "string")
        : null;

    // Pull this client's entries, then select either the explicit IDs or all
    // unbilled billable ones.
    const listResult = await auth.context.caller.time.list({ clientId });
    const allEntries = (
      Array.isArray(listResult)
        ? listResult
        : Array.isArray(
              (listResult as { entries?: unknown[] } | undefined)?.entries,
            )
          ? (listResult as { entries: unknown[] }).entries
          : []
    ) as Array<{
      id: string;
      description: string | null;
      hours: string | null;
      roundedHours?: string | null;
      billableRate: string | null;
      date: string | Date;
      isBillable: boolean;
      isBilled: boolean;
    }>;

    const selected = explicitIds
      ? allEntries.filter((e) => explicitIds.includes(e.id))
      : allEntries.filter((e) => e.isBillable && !e.isBilled);

    if (selected.length === 0) {
      return errorResponse(
        400,
        "NO_BILLABLE_ENTRIES",
        explicitIds
          ? "None of the given timeEntryIds match billable entries for this client."
          : "No unbilled billable time entries found for this client. Use GET /api/v1/reports/unbilled to see which clients have billable time, or check that the entries are marked billable and have a rate.",
      );
    }

    // Dry run: compute the preview without creating anything.
    if (dryRun) {
      let totalAmount = 0;
      const lineItems = selected.map((e) => {
        const hours = Number(e.roundedHours ?? e.hours ?? 0) || 0;
        const rate = e.billableRate ? Number(e.billableRate) : 0;
        const amount = hours * rate;
        totalAmount += amount;
        return {
          timeEntryId: e.id,
          date: (typeof e.date === "string"
            ? e.date
            : new Date(e.date).toISOString()
          ).slice(0, 10),
          description: e.description || "Tidsregistrering",
          hours: hours.toFixed(2),
          rate: rate.toFixed(2),
          amount: amount.toFixed(2),
        };
      });
      return withRateLimitHeaders(
        successResponse({
          dryRun: true,
          clientId,
          entryCount: lineItems.length,
          totalAmount: totalAmount.toFixed(2),
          lineItems,
        }),
        auth.context.rateLimit,
      );
    }

    const result = await auth.context.caller.invoices.generateFromTimeEntries({
      clientId,
      timeEntryIds: selected.map((e) => e.id),
      notes,
      dueDate,
    });

    return withRateLimitHeaders(
      successResponse(result, 201),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export function OPTIONS() {
  return corsPreflightResponse();
}
