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
import { mergeProjectPatch } from "@/lib/api/resource-patch";

// GET /api/v1/projects/[id] — get a single project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "projects", "read");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const result = await auth.context.caller.projects.getById({ id });
    return withRateLimitHeaders(
      successResponse(result),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

// PATCH /api/v1/projects/[id] — update a project
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "projects", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Request body must be an object",
      );
    }

    // projects.update er en fuld erstatning — udeladte felter (kunde, sats,
    // budget, datoer) blev ryddet. Flet med det gemte projekt (#718).
    const existing = (await auth.context.caller.projects.getById({
      id,
    })) as Record<string, unknown>;
    const updateData = mergeProjectPatch(
      existing,
      body as Record<string, unknown>,
    );

    const result = await auth.context.caller.projects.update({
      id,
      data: updateData as Parameters<
        typeof auth.context.caller.projects.update
      >[0]["data"],
    });

    return withRateLimitHeaders(
      successResponse(result),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

// DELETE /api/v1/projects/[id] — archive a project (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "projects", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const result = await auth.context.caller.projects.delete({ id });
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
