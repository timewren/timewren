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
import { mergePrepaidPatch } from "@/lib/api/resource-patch";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "prepaid", "read");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const result = await auth.context.caller.prepaid.getById({ id });
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

  const scopeErr = requireScope(auth.context, "prepaid", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Request body must be an object",
      );
    }

    // prepaid.update er en fuld erstatning — udeladt udløb, beskrivelse og
    // klip-størrelse blev ryddet. Flet med det gemte klippekort (#718).
    const existing = (await auth.context.caller.prepaid.getById({
      id,
    })) as Record<string, unknown>;
    const data = mergePrepaidPatch(existing, body as Record<string, unknown>);

    const result = await auth.context.caller.prepaid.update({
      id,
      data: data as Parameters<
        typeof auth.context.caller.prepaid.update
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

  const scopeErr = requireScope(auth.context, "prepaid", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    // Archive the prepaid package (soft delete)
    const result = await auth.context.caller.prepaid.archive({ id });
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
