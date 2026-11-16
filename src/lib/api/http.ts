/**
 * Rene HTTP-hjælpere til det offentlige API: CORS, svarformer, paginering,
 * sortering og oversættelse af tRPC-fejl.
 *
 * Ligger adskilt fra `middleware.ts`, fordi den trækker databasen og hele
 * tRPC-routeren ind. Uden den adskillelse kan selv en ren funktion som
 * `parsePagination` ikke unit-testes.
 *
 * `middleware.ts` re-eksporterer alt herfra, så eksisterende importstier
 * bliver ved med at virke.
 */

import { TRPCError } from "@trpc/server";
import { NextResponse } from "next/server";
import { CLIENT_HEADER } from "@/lib/client-version";
import { clientTooOldCause } from "@/lib/client-version/guard";

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

// ============================================
// CORS
// ============================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": `Content-Type, Authorization, ${CLIENT_HEADER}`,
  "Access-Control-Max-Age": "86400",
};

/**
 * Handle CORS preflight (OPTIONS) requests for /api/v1/ routes.
 */
export function corsPreflightResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Add CORS headers to any response.
 */
export function withCorsHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// ============================================
// Response Helpers
// ============================================

/**
 * Return a successful JSON response with `{ data }` envelope + CORS headers.
 */
export function successResponse<T>(data: T, status = 200): NextResponse {
  const response = NextResponse.json({ data }, { status });
  return withCorsHeaders(response);
}

/**
 * Pagineringsfeltet i et list-svar.
 *
 * `hasMore`/`nextPage` er tilføjet efter de øvrige felter (#573), så en klient
 * kan bladre videre uden selv at regne på `total`. Felterne er rent additive.
 */
export function paginationMeta(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit);
  const hasMore = page < totalPages;
  return {
    page,
    limit,
    total,
    totalPages,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
  };
}

/**
 * Return a paginated JSON response + CORS headers.
 */
export function paginatedResponse<T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
): NextResponse {
  const response = NextResponse.json({
    data,
    pagination: paginationMeta(page, limit, total),
  });
  return withCorsHeaders(response);
}

/**
 * Attach X-RateLimit-* headers to an existing response.
 */
export function withRateLimitHeaders(
  response: NextResponse,
  rateLimit: RateLimitInfo,
): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(rateLimit.limit));
  response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  response.headers.set("X-RateLimit-Reset", String(rateLimit.reset));
  return response;
}

/**
 * Return a JSON error response + CORS headers.
 */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse {
  const body: { error: { code: string; message: string; details?: unknown } } =
    {
      error: { code, message },
    };
  if (details !== undefined) {
    body.error.details = details;
  }
  const response = NextResponse.json(body, { status });
  return withCorsHeaders(response);
}

export function rateLimitResponse(
  resetIn: number,
  limit: number,
  remaining: number,
): NextResponse {
  const resetInSeconds = Math.ceil(resetIn / 1000);
  const resetAt = Math.ceil((Date.now() + resetIn) / 1000);

  const response = errorResponse(
    429,
    "TOO_MANY_REQUESTS",
    `Rate limit exceeded. Retry after ${resetInSeconds} seconds.`,
  );

  response.headers.set("X-RateLimit-Limit", String(limit));
  response.headers.set("X-RateLimit-Remaining", String(remaining));
  response.headers.set("X-RateLimit-Reset", String(resetAt));
  response.headers.set("Retry-After", String(resetInSeconds));

  return response;
}

// ============================================
// Pagination Parsing
// ============================================

/** Største sidestørrelse API'et udleverer. */
export const MAX_PAGE_SIZE = 100;

/**
 * Parse pagination parameters from URL search params.
 *
 * Returns `{ page, limit }` or `{ error }` — samme mønster som
 * `authenticateApiKey`, så ruterne kan skrive:
 *
 *     const pagination = parsePagination(params);
 *     if ("error" in pagination) return pagination.error;
 *
 * En `limit` over loftet afvises i stedet for at blive kappet. Kapningen var
 * tavs, så en klient der bad om 500 fik 100 tilbage og kunne ikke se forskel
 * på "det var alt" og "her er første side" — poster forsvandt uden at nogen
 * opdagede det.
 */
export function parsePagination(
  searchParams: URLSearchParams,
): { page: number; limit: number } | { error: NextResponse } {
  const rawPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const rawLimitParam = searchParams.get("limit");
  const rawLimit = Number.parseInt(rawLimitParam ?? "25", 10);

  const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  if (
    rawLimitParam !== null &&
    !Number.isNaN(rawLimit) &&
    rawLimit > MAX_PAGE_SIZE
  ) {
    return {
      error: errorResponse(
        400,
        "BAD_REQUEST",
        `limit must be ${MAX_PAGE_SIZE} or less. Use the page parameter to fetch more.`,
      ),
    };
  }

  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 25 : rawLimit;

  return { page, limit };
}

/**
 * Parse sort parameters from URL search params.
 * Returns { sort, order } with defaults.
 */
export function parseSorting(
  searchParams: URLSearchParams,
  allowedFields: string[],
  defaultSort = "createdAt",
  defaultOrder: "asc" | "desc" = "desc",
): { sort: string; order: "asc" | "desc" } {
  const rawSort = searchParams.get("sort") || defaultSort;
  const rawOrder = searchParams.get("order") || defaultOrder;

  const sort = allowedFields.includes(rawSort) ? rawSort : defaultSort;
  const order = rawOrder === "asc" ? "asc" : "desc";

  return { sort, order };
}

/**
 * Apply pagination and sorting to an array of results.
 * Use this when the tRPC procedure returns all results and we need to paginate at the REST layer.
 */
export function applyPaginationAndSort<T extends Record<string, unknown>>(
  items: T[],
  page: number,
  limit: number,
  sort: string,
  order: "asc" | "desc",
): { data: T[]; total: number } {
  // Sort
  const sorted = [...items].sort((a, b) => {
    const aVal = a[sort];
    const bVal = b[sort];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    let cmp: number;
    if (aVal instanceof Date && bVal instanceof Date) {
      cmp = aVal.getTime() - bVal.getTime();
    } else if (typeof aVal === "number" && typeof bVal === "number") {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }
    return order === "asc" ? cmp : -cmp;
  });

  // Paginate
  const start = (page - 1) * limit;
  const data = sorted.slice(start, start + limit);

  return { data, total: items.length };
}

// ============================================
// tRPC Error Handling
// ============================================

/**
 * Extract field-level validation errors from a TRPCError whose cause is a
 * ZodError. Returns an array of `{ field, message }` pairs, or undefined if
 * the error is not a Zod validation error.
 */
function extractZodDetails(
  error: TRPCError,
): Array<{ field: string; message: string }> | undefined {
  const cause = error.cause as unknown;
  if (
    !cause ||
    typeof cause !== "object" ||
    !("issues" in cause) ||
    !Array.isArray((cause as { issues: unknown }).issues)
  ) {
    return undefined;
  }
  const issues = (cause as { issues: Array<unknown> }).issues;
  return issues
    .filter(
      (i): i is { path: Array<string | number>; message: string } =>
        typeof i === "object" &&
        i !== null &&
        "path" in i &&
        "message" in i &&
        Array.isArray((i as { path: unknown }).path),
    )
    .map((i) => ({
      field: i.path.join("."),
      message: i.message,
    }));
}

/**
 * Map a tRPC error to an HTTP error NextResponse.
 *
 * Zod validation errors (surfaced as BAD_REQUEST with a ZodError cause) are
 * translated to HTTP 422 with field-level `details`, matching the
 * `ValidationError` response shape documented in the OpenAPI spec.
 */
export function handleTrpcError(error: unknown): NextResponse {
  // For gammel klient: HTTP 426 Upgrade Required med en stabil fejlkode.
  const tooOld = clientTooOldCause(error);
  if (tooOld) {
    return errorResponse(426, tooOld.appCode, tooOld.message, {
      kind: tooOld.kind,
      minimumVersion: tooOld.minimum,
    });
  }
  if (error instanceof TRPCError) {
    const zodDetails = extractZodDetails(error);
    if (zodDetails && zodDetails.length > 0) {
      return errorResponse(
        422,
        "UNPROCESSABLE_CONTENT",
        "Validation failed",
        zodDetails,
      );
    }
    const { status, code } = trpcCodeToHttp(error.code);
    return errorResponse(status, code, error.message);
  }

  // Unknown error — do not leak stack traces
  return errorResponse(
    500,
    "INTERNAL_SERVER_ERROR",
    "An unexpected error occurred",
  );
}

function trpcCodeToHttp(trpcCode: TRPCError["code"]): {
  status: number;
  code: string;
} {
  switch (trpcCode) {
    case "BAD_REQUEST":
    case "PARSE_ERROR":
      return { status: 400, code: "BAD_REQUEST" };
    case "UNAUTHORIZED":
      return { status: 401, code: "UNAUTHORIZED" };
    case "FORBIDDEN":
      return { status: 403, code: "FORBIDDEN" };
    case "NOT_FOUND":
      return { status: 404, code: "NOT_FOUND" };
    case "METHOD_NOT_SUPPORTED":
      return { status: 405, code: "METHOD_NOT_SUPPORTED" };
    case "TIMEOUT":
      return { status: 408, code: "TIMEOUT" };
    case "CONFLICT":
      return { status: 409, code: "CONFLICT" };
    case "PRECONDITION_FAILED":
      return { status: 412, code: "PRECONDITION_FAILED" };
    case "PAYLOAD_TOO_LARGE":
      return { status: 413, code: "PAYLOAD_TOO_LARGE" };
    case "UNPROCESSABLE_CONTENT":
      return { status: 422, code: "UNPROCESSABLE_CONTENT" };
    case "TOO_MANY_REQUESTS":
      return { status: 429, code: "TOO_MANY_REQUESTS" };
    case "CLIENT_CLOSED_REQUEST":
      return { status: 499, code: "CLIENT_CLOSED_REQUEST" };
    default:
      return { status: 500, code: "INTERNAL_SERVER_ERROR" };
  }
}
