import type { NextRequest } from "next/server";
import { tr } from "@/i18n/server-text";
import {
  authenticateApiKey,
  corsPreflightResponse,
  errorResponse,
  handleTrpcError,
  requireScope,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "webhooks", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;

    // Dedicated rate limit for webhook test (per user + webhook id)
    const testKey = userRateLimitKey(auth.context.userId, `webhook-test:${id}`);
    const testLimit = await rateLimiter.check(testKey, "webhookTest");
    if (!testLimit.allowed) {
      return errorResponse(
        429,
        "TOO_MANY_REQUESTS",
        await tr("serverErrors", "api.webhookTest.tooMany"),
      );
    }

    const result = await auth.context.caller.webhooks.test({ id });
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
