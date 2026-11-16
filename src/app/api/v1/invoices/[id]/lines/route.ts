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

/**
 * GET /api/v1/invoices/{id}/lines — List invoice lines
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "invoices", "read");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const lines = await auth.context.caller.invoices.getLines({
      invoiceId: id,
    });
    return withRateLimitHeaders(successResponse(lines), auth.context.rateLimit);
  } catch (error) {
    return handleTrpcError(error);
  }
}

/**
 * POST /api/v1/invoices/{id}/lines — Create an invoice line
 */
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const b = body as Record<string, unknown>;
    const result = await auth.context.caller.invoices.createLine({
      invoiceId: id,
      description: b.description as string,
      quantity: b.quantity as string | undefined,
      unitPrice: b.unitPrice as string,
      amount: b.amount as string,
      timeEntryId: b.timeEntryId as string | undefined,
      sortOrder: b.sortOrder as number | undefined,
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
