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
import { patchTimeEntry } from "@/lib/api/time-entry-patch";

// GET /api/v1/time-entries/[id] — get a single time entry
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "time", "read");
  if (scopeErr) return scopeErr;

  const { id } = await params;

  try {
    const entry = await auth.context.caller.time.getById({ id });
    return withRateLimitHeaders(successResponse(entry), auth.context.rateLimit);
  } catch (error) {
    return handleTrpcError(error);
  }
}

// PATCH /api/v1/time-entries/[id] — update a time entry
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "time", "write");
  if (scopeErr) return scopeErr;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (typeof body !== "object" || body === null) {
    return errorResponse(400, "BAD_REQUEST", "Request body must be an object");
  }

  const patch = body as Record<string, unknown>;
  const { hours, date } = patch;

  if (
    hours !== undefined &&
    (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0)
  ) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "hours must be a positive finite number",
    );
  }
  if (date !== undefined && (typeof date !== "string" || !date)) {
    return errorResponse(400, "BAD_REQUEST", "date must be a non-empty string");
  }

  try {
    // Patchen flettes ind i den gemte post, så en PATCH kun rører det den
    // faktisk sender (se patchTimeEntry).
    const result = await patchTimeEntry(auth.context.caller, id, patch);
    if (!result.ok) {
      return errorResponse(400, "BAD_REQUEST", result.message, [
        { field: result.field, message: result.message },
      ]);
    }
    return withRateLimitHeaders(
      successResponse(result.entry),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

// DELETE /api/v1/time-entries/[id] — delete a time entry
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "time", "write");
  if (scopeErr) return scopeErr;

  const { id } = await params;

  try {
    const result = await auth.context.caller.time.delete({ id });
    return withRateLimitHeaders(
      successResponse(result),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export function OPTIONS() {
  return corsPreflightResponse();
}
