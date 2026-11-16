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
 * GET /api/v1/rate-changes — planlagte satsændringer for en klient/et projekt
 * Query params: clientId | projectId (præcis én), includeInactive=true
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  // Samme scope som /rate-history
  const scopeErr = requireScope(auth.context, "reports", "read");
  if (scopeErr) return scopeErr;

  const params = request.nextUrl.searchParams;
  const clientId = params.get("clientId") || undefined;
  const projectId = params.get("projectId") || undefined;
  if (!!clientId === !!projectId) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "Provide exactly one of clientId or projectId",
    );
  }

  try {
    const changes = await auth.context.caller.scheduledRates.list({
      clientId,
      projectId,
      includeInactive: params.get("includeInactive") === "true",
    });
    return withRateLimitHeaders(
      successResponse(changes),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

/**
 * POST /api/v1/rate-changes — planlæg en ny timepris fra en dato
 * Body: { clientId | projectId, newRate, effectiveDate: "YYYY-MM-DD" }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }
  if (typeof body !== "object" || body === null) {
    return errorResponse(400, "BAD_REQUEST", "Request body must be an object");
  }

  const { clientId, projectId, newRate, effectiveDate } = body as Record<
    string,
    unknown
  >;
  const hasClient = typeof clientId === "string" && clientId !== "";
  const hasProject = typeof projectId === "string" && projectId !== "";
  if (hasClient === hasProject) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "Provide exactly one of clientId or projectId",
    );
  }
  if (typeof newRate !== "string" && typeof newRate !== "number") {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "newRate is required (decimal string or number)",
    );
  }
  if (typeof effectiveDate !== "string") {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "effectiveDate is required (YYYY-MM-DD)",
    );
  }

  // Ændringen skriver klientens/projektets timepris
  const scopeErr = requireScope(
    auth.context,
    hasProject ? "projects" : "clients",
    "write",
  );
  if (scopeErr) return scopeErr;

  try {
    const result = await auth.context.caller.scheduledRates.create({
      clientId: hasClient ? (clientId as string) : undefined,
      projectId: hasProject ? (projectId as string) : undefined,
      newRate,
      effectiveDate,
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
