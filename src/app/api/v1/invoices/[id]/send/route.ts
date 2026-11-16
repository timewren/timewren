import type { NextRequest } from "next/server";
import {
  authenticateApiKey,
  corsPreflightResponse,
  handleTrpcError,
  requireScope,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";

// POST /api/v1/invoices/[id]/send — send the invoice email to the client
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "invoices", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;

    const result = await auth.context.caller.invoices.sendEmail({ id });
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
