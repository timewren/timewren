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
 * GET /api/v1/timer — Get current timer status
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "time", "read");
  if (scopeErr) return scopeErr;

  try {
    const state = await auth.context.caller.timerSync.getState();
    return withRateLimitHeaders(successResponse(state), auth.context.rateLimit);
  } catch (error) {
    return handleTrpcError(error);
  }
}

/**
 * POST /api/v1/timer — Start or sync timer
 * Body: { isRunning, projectId, clientId, description, ... }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "time", "write");
  if (scopeErr) return scopeErr;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const b = body as Record<string, unknown>;

    const result = await auth.context.caller.timerSync.sync({
      isRunning: (b.isRunning as boolean) ?? true,
      startTime: (b.startTime as number | null) ?? Date.now(),
      sessionStartTime: (b.sessionStartTime as number | null) ?? null,
      elapsedSeconds: (b.elapsedSeconds as number) ?? 0,
      baseSeconds: (b.baseSeconds as number) ?? 0,
      projectId: (b.projectId as string | null) ?? null,
      clientId: (b.clientId as string | null) ?? null,
      taskId: (b.taskId as string | null) ?? null,
      description: (b.description as string) ?? "",
      // tRPC enum only accepts "web" | "extension" — default to "web" for
      // general API callers, allow "extension" when explicitly set.
      source: (b.source as string) === "extension" ? "extension" : "web",
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
 * DELETE /api/v1/timer — Stop and clear the timer
 */
export async function DELETE(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "time", "write");
  if (scopeErr) return scopeErr;

  try {
    const result = await auth.context.caller.timerSync.clear({
      source: "web",
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
