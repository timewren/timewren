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

// GET /api/v1/invoices/[id] — get a single invoice by ID
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
    const result = await auth.context.caller.invoices.getById({ id });
    return withRateLimitHeaders(
      successResponse(result),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

// PATCH /api/v1/invoices/[id] — update an invoice (status, amount, dueDate, paidDate, notes)
export async function PATCH(
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

    if (typeof body !== "object" || body === null) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Request body must be an object",
      );
    }

    const { status, amount, dueDate, paidDate, notes, billyInvoiceId } =
      body as Record<string, unknown>;

    const result = await auth.context.caller.invoices.update({
      id,
      status:
        typeof status === "string"
          ? (status as "draft" | "sent" | "paid" | "overdue")
          : undefined,
      amount: typeof amount === "string" ? amount : undefined,
      dueDate: typeof dueDate === "string" ? dueDate : undefined,
      paidDate: typeof paidDate === "string" ? paidDate : undefined,
      notes: typeof notes === "string" ? notes : undefined,
      // Kobling til en faktura oprettet direkte i Billy; null fjerner den
      billyInvoiceId:
        typeof billyInvoiceId === "string" || billyInvoiceId === null
          ? billyInvoiceId
          : undefined,
    });
    return withRateLimitHeaders(
      successResponse(result),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

// DELETE /api/v1/invoices/[id] — soft delete (sets status to "deleted")
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "invoices", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const result = await auth.context.caller.invoices.delete({ id });
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
