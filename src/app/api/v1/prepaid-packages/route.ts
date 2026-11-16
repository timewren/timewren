import type { NextRequest } from "next/server";
import {
  applyPaginationAndSort,
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

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "prepaid", "read");
  if (scopeErr) return scopeErr;

  try {
    const params = request.nextUrl.searchParams;
    const clientId = params.get("clientId") ?? undefined;
    const activeOnly = params.get("activeOnly") === "true";
    const includeArchived = params.get("includeArchived") === "true";

    const pagination = parsePagination(params);
    if ("error" in pagination) return pagination.error;
    const { page, limit } = pagination;
    const { sort, order } = parseSorting(params, [
      "createdAt",
      "name",
      "totalHours",
    ]);

    const allItems = await auth.context.caller.prepaid.list({
      clientId,
      activeOnly,
      includeArchived,
    });
    const items = Array.isArray(allItems) ? allItems : [];
    const { data, total } = applyPaginationAndSort(
      items as Record<string, unknown>[],
      page,
      limit,
      sort,
      order,
    );
    return withRateLimitHeaders(
      paginatedResponse(data, page, limit, total),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "prepaid", "write");
  if (scopeErr) return scopeErr;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const result = await auth.context.caller.prepaid.create(
      body as Parameters<typeof auth.context.caller.prepaid.create>[0],
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
