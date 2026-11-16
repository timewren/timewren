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

// GET /api/v1/projects — list all projects
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "projects", "read");
  if (scopeErr) return scopeErr;

  try {
    const params = request.nextUrl.searchParams;
    const clientId = params.get("clientId");
    const includeArchived = params.get("includeArchived") === "true";

    const pagination = parsePagination(params);
    if ("error" in pagination) return pagination.error;
    const { page, limit } = pagination;
    const { sort, order } = parseSorting(params, [
      "createdAt",
      "name",
      "status",
    ]);

    let allItems: Record<string, unknown>[];

    if (clientId) {
      const result = await auth.context.caller.projects.getByClient({
        clientId,
      });
      allItems = (
        includeArchived ? result : result.filter((p) => p.status !== "archived")
      ) as Record<string, unknown>[];
    } else {
      const result = await auth.context.caller.projects.list();
      allItems = (
        includeArchived ? result : result.filter((p) => p.status !== "archived")
      ) as Record<string, unknown>[];
    }

    const { data, total } = applyPaginationAndSort(
      allItems,
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

// POST /api/v1/projects — create a project
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "projects", "write");
  if (scopeErr) return scopeErr;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const b = body as Record<string, unknown>;
    if (typeof b.name !== "string" || !b.name) {
      return errorResponse(400, "BAD_REQUEST", "name is required");
    }
    if (typeof b.clientId !== "string" || !b.clientId) {
      return errorResponse(400, "BAD_REQUEST", "clientId is required");
    }
    type ProjectStatus = "active" | "completed" | "on_hold" | "archived";
    const result = await auth.context.caller.projects.create({
      name: b.name,
      description: b.description as string | undefined,
      clientId: b.clientId,
      hourlyRate: b.hourlyRate != null ? String(b.hourlyRate) : undefined,
      fixedPrice: b.fixedPrice != null ? String(b.fixedPrice) : undefined,
      status: b.status as ProjectStatus | undefined,
      startDate: b.startDate as string | undefined,
      endDate: b.endDate as string | undefined,
      urlPatterns: b.urlPatterns as string[] | undefined,
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
