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

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "webhooks", "read");
  if (scopeErr) return scopeErr;

  try {
    const webhooks = await auth.context.caller.webhooks.list();
    return withRateLimitHeaders(
      successResponse(webhooks),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "webhooks", "write");
  if (scopeErr) return scopeErr;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const b = body as Record<string, unknown>;
    const result = await auth.context.caller.webhooks.create({
      name: b.name as string,
      url: b.url as string,
      events: b.events as string[],
      clientId: b.clientId as string | undefined,
      projectId: b.projectId as string | undefined,
      retryCount: b.retryCount as number | undefined,
      timeoutMs: b.timeoutMs as number | undefined,
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
