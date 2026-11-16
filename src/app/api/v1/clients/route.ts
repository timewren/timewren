import type { NextRequest } from "next/server";
import { pageOffset } from "@/lib/api/list-query";
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

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "clients", "read");
  if (scopeErr) return scopeErr;

  try {
    const params = request.nextUrl.searchParams;
    const includeArchived = params.get("includeArchived") === "true";

    const pagination = parsePagination(params);
    if ("error" in pagination) return pagination.error;
    const { page, limit } = pagination;
    const { sort, order } = parseSorting(params, [
      "createdAt",
      "name",
      "company",
      "email",
    ]);

    // Søgning, sortering og paginering sker i databasen (#573). `clients.list`
    // har et fast loft på 500, så svaret stoppede tavst ved kunde nummer 500.
    const result = await auth.context.caller.clients.listPage({
      includeArchived,
      q: params.get("q") || undefined,
      limit,
      offset: pageOffset(page, limit),
      sortBy: sort as "createdAt" | "name" | "company" | "email",
      sortOrder: order,
    });

    return withRateLimitHeaders(
      paginatedResponse(result.clients, page, limit, result.total),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "clients", "write");
  if (scopeErr) return scopeErr;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const result = await auth.context.caller.clients.create(
      body as Parameters<typeof auth.context.caller.clients.create>[0],
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
