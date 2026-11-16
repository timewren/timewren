import type { NextRequest } from "next/server";
import {
  authenticateApiKey,
  corsPreflightResponse,
  errorResponse,
  handleTrpcError,
  MAX_PAGE_SIZE,
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
    const searchParams = request.nextUrl.searchParams;
    // Samme politik som de øvrige listeruter: en for stor limit afvises frem
    // for at blive kappet tavst, så klienten ved at der mangler rækker.
    const limit = Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50;
    if (limit > MAX_PAGE_SIZE) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        `limit must be ${MAX_PAGE_SIZE} or less.`,
      );
    }

    const deliveries = await auth.context.caller.webhooks.getDeliveries({
      webhookId: id,
      limit,
    });

    return withRateLimitHeaders(
      successResponse(deliveries),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export function OPTIONS() {
  return corsPreflightResponse();
}
