import type { NextRequest, NextResponse } from "next/server";
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
 * Verify that the line belongs to the invoice named in the URL.
 * Returns null on success, or a NextResponse error on mismatch/not found.
 *
 * The tRPC procedures already verify the *user* owns both resources, so this
 * is a correctness/REST-contract check (the client could otherwise mutate
 * line X via invoice Y's URL and get a successful response).
 */
async function assertLineBelongsToInvoice(
  auth: {
    context: {
      caller: {
        invoices: {
          getById: (i: { id: string }) => Promise<{ id: string }>;
          getLines: (i: {
            invoiceId: string;
          }) => Promise<Array<{ id: string }>>;
        };
      };
    };
  },
  invoiceId: string,
  lineId: string,
): Promise<NextResponse | null> {
  try {
    // getLines already scopes to the caller's user via the tRPC procedure;
    // if the invoice doesn't belong to the user this throws NOT_FOUND.
    const lines = await auth.context.caller.invoices.getLines({
      invoiceId,
    });
    if (!lines.some((l) => l.id === lineId)) {
      return errorResponse(
        404,
        "NOT_FOUND",
        "Invoice line not found on this invoice",
      );
    }
    return null;
  } catch (error) {
    return handleTrpcError(error);
  }
}

/**
 * PATCH /api/v1/invoices/{id}/lines/{lineId} — Update an invoice line
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "invoices", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id, lineId } = await params;

    const mismatch = await assertLineBelongsToInvoice(auth, id, lineId);
    if (mismatch) return withRateLimitHeaders(mismatch, auth.context.rateLimit);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const b = body as Record<string, unknown>;
    const result = await auth.context.caller.invoices.updateLine({
      id: lineId,
      description: b.description as string | undefined,
      quantity: b.quantity as string | undefined,
      unitPrice: b.unitPrice as string | undefined,
      amount: b.amount as string | undefined,
      sortOrder: b.sortOrder as number | undefined,
    });

    return withRateLimitHeaders(
      successResponse(result),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

/**
 * DELETE /api/v1/invoices/{id}/lines/{lineId} — Delete an invoice line
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "invoices", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id, lineId } = await params;

    const mismatch = await assertLineBelongsToInvoice(auth, id, lineId);
    if (mismatch) return withRateLimitHeaders(mismatch, auth.context.rateLimit);

    const result = await auth.context.caller.invoices.deleteLine({
      id: lineId,
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
