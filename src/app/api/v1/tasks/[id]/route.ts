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

const VALID_STATUSES = ["backlog", "todo", "in_progress", "done"] as const;
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type TaskStatus = (typeof VALID_STATUSES)[number];
type TaskPriority = (typeof VALID_PRIORITIES)[number];

// GET /api/v1/tasks/[id] — get a single task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "tasks", "read");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const result = await auth.context.caller.tasks.getById({ id });
    return withRateLimitHeaders(
      successResponse(result),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

// PATCH /api/v1/tasks/[id] — update a task
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "tasks", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const b = body as Record<string, unknown>;

    if (
      b.status !== undefined &&
      !VALID_STATUSES.includes(b.status as TaskStatus)
    ) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      );
    }
    if (
      b.priority !== undefined &&
      !VALID_PRIORITIES.includes(b.priority as TaskPriority)
    ) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}`,
      );
    }

    const result = await auth.context.caller.tasks.update({
      id,
      title: b.title as string | undefined,
      description: b.description as string | undefined,
      projectId: b.projectId as string | undefined,
      clientId: b.clientId as string | undefined,
      status: b.status as TaskStatus | undefined,
      priority: b.priority as TaskPriority | undefined,
      deadline:
        b.deadline !== undefined
          ? b.deadline
            ? new Date(b.deadline as string)
            : null
          : undefined,
      parentTaskId: b.parentTaskId as string | undefined,
      estimatedMinutes: b.estimatedMinutes as number | undefined,
      actualMinutes: b.actualMinutes as number | undefined,
      position: b.position as number | undefined,
    });

    return withRateLimitHeaders(
      successResponse(result),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

// DELETE /api/v1/tasks/[id] — delete a task (hard delete, including subtasks)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "tasks", "write");
  if (scopeErr) return scopeErr;

  try {
    const { id } = await params;
    const result = await auth.context.caller.tasks.delete({ id });
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
