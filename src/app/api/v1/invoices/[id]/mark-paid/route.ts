import type { NextRequest } from "next/server";
import {
  authenticateApiKey,
  corsPreflightResponse,
  handleTrpcError,
  requireScope,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";

// POST /api/v1/invoices/[id]/mark-paid — mark an invoice as paid
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

    // Optional body — caller may supply paidDate
    const body = await request.json().catch(() => ({}));
    const paidDate =
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>).paidDate === "string"
        ? ((body as Record<string, unknown>).paidDate as string)
        : undefined;

    const result = await auth.context.caller.invoices.update({
      id,
      status: "paid",
      paidDate,
    });
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
