import type { NextRequest } from "next/server";
import {
  authenticateApiKey,
  corsPreflightResponse,
  handleTrpcError,
  requireScope,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";

/**
 * GET /api/v1/rate-history — Get rate change history
 * Query params: clientId, projectId
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "reports", "read");
  if (scopeErr) return scopeErr;

  try {
    const params = request.nextUrl.searchParams;
    const clientId = params.get("clientId") || undefined;
    const projectId = params.get("projectId") || undefined;

    const history = await auth.context.caller.rateHistory.getHistory({
      clientId,
      projectId,
    });

    return withRateLimitHeaders(
      successResponse(history),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export function OPTIONS() {
  return corsPreflightResponse();
}
