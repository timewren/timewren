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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "clients", "read");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const result = await auth.context.caller.clients.getById({ id });
    return withRateLimitHeaders(
      successResponse(result),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "clients", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;

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

    // Merge with the existing client so a partial PATCH does not null out
    // fields the caller didn't send. clients.update is a full replace (every
    // unset field becomes null), so we overlay only the provided keys on top
    // of the current record. An explicit `null` in the body still clears a
    // field; an absent key preserves it.
    const existing = (await auth.context.caller.clients.getById({
      id,
    })) as Record<string, unknown>;
    const b = body as Record<string, unknown>;
    const MERGE_FIELDS = [
      "name",
      "email",
      "phone",
      "company",
      "address",
      "city",
      "postalCode",
      "country",
      "cvrNumber",
      "billyId",
      "notes",
      "defaultHourlyRate",
      "color",
      "roundingEnabled",
      "roundingMinutes",
      "roundingMethod",
      "approvalWorkflow",
      "defaultBillable",
    ] as const;
    const merged: Record<string, unknown> = {};
    for (const field of MERGE_FIELDS) {
      if (field in b) merged[field] = b[field];
      else if (existing?.[field] != null) merged[field] = existing[field];
    }

    const result = await auth.context.caller.clients.update({
      id,
      data: merged as Parameters<
        typeof auth.context.caller.clients.update
      >[0]["data"],
    });
    return withRateLimitHeaders(
      successResponse(result),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "clients", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const result = await auth.context.caller.clients.archive({ id });
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
