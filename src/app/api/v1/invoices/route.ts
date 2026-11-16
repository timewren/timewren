import type { NextRequest } from "next/server";
import {
  INVOICE_SORT_PARAMS,
  pageOffset,
  toInvoiceSortField,
} from "@/lib/api/list-query";
import {
  authenticateApiKey,
  corsPreflightResponse,
  errorResponse,
  handleTrpcError,
  paginatedResponse,
  parsePagination,
  parseSorting,
  requireScope,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";

// GET /api/v1/invoices — list invoices, optionally filtered by clientId or status
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "invoices", "read");
  if (scopeErr) return scopeErr;

  try {
    const params = request.nextUrl.searchParams;
    const clientId = params.get("clientId");
    const status = params.get("status");

    const pagination = parsePagination(params);
    if ("error" in pagination) return pagination.error;
    const { page, limit } = pagination;
    const { sort, order } = parseSorting(params, INVOICE_SORT_PARAMS);

    // Pagineringen sker i databasen (#573). Tidligere blev `invoices.list`
    // kaldt uden limit, ramte procedurens default på 500, og ruten paginerede
    // bagefter i hukommelsen — svaret stoppede ved faktura nummer 500, og
    // `total` sagde 500.
    const result = await auth.context.caller.invoices.listPage({
      clientId: clientId || undefined,
      status: status || undefined,
      limit,
      offset: pageOffset(page, limit),
      sortBy: toInvoiceSortField(sort),
      sortOrder: order,
    });

    return withRateLimitHeaders(
      paginatedResponse(result.invoices, page, limit, result.total),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

// POST /api/v1/invoices — create a new invoice
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "invoices", "write");
  if (scopeErr) return scopeErr;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const result = await auth.context.caller.invoices.create(
      body as Parameters<typeof auth.context.caller.invoices.create>[0],
    );
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
