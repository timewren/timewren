import type { NextRequest } from "next/server";
import {
  authenticateApiKey,
  corsPreflightResponse,
  handleTrpcError,
  requireScope,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";

/**
 * DELETE /api/v1/rate-changes/{id} — annullér en planlagt satsændring.
 * Allerede gennemførte ændringer kan ikke annulleres (409).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  try {
    const { id } = await params;
    // Scope følger ændringens mål: klient → clients:write, projekt →
    // projects:write
    const change = await auth.context.caller.scheduledRates.get({ id });
    const scopeErr = requireScope(
      auth.context,
      change.projectId ? "projects" : "clients",
      "write",
    );
    if (scopeErr) return scopeErr;

    const result = await auth.context.caller.scheduledRates.cancel({ id });
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
