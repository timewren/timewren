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

  const scopeErr = requireScope(auth.context, "webhooks", "read");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const result = await auth.context.caller.webhooks.getById({ id });
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

  const scopeErr = requireScope(auth.context, "webhooks", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const b = body as Record<string, unknown>;
    const result = await auth.context.caller.webhooks.update({
      id,
      name: b.name as string | undefined,
      url: b.url as string | undefined,
      events: b.events as string[] | undefined,
      clientId: b.clientId as string | null | undefined,
      projectId: b.projectId as string | null | undefined,
      isActive: b.isActive as boolean | undefined,
      retryCount: b.retryCount as number | undefined,
      timeoutMs: b.timeoutMs as number | undefined,
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

  const scopeErr = requireScope(auth.context, "webhooks", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const result = await auth.context.caller.webhooks.delete({ id });
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
