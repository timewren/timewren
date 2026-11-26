import type { NextRequest } from "next/server";
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

import { taskRestSortFields } from "@/lib/tasks/task-pages";

const VALID_STATUSES = ["backlog", "todo", "in_progress", "done"] as const;
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type TaskStatus = (typeof VALID_STATUSES)[number];
type TaskPriority = (typeof VALID_PRIORITIES)[number];

// GET /api/v1/tasks — list tasks
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "tasks", "read");
  if (scopeErr) return scopeErr;

  try {
    const params = request.nextUrl.searchParams;
    const projectId = params.get("projectId");
    const clientId = params.get("clientId");
    const rawStatus = params.get("status");
    const rawPriority = params.get("priority");

    if (rawStatus && !VALID_STATUSES.includes(rawStatus as TaskStatus)) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      );
    }
    if (
      rawPriority &&
      !VALID_PRIORITIES.includes(rawPriority as TaskPriority)
    ) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}`,
      );
    }
    const status = rawStatus as TaskStatus | null;
    const priority = rawPriority as TaskPriority | null;

    const pagination = parsePagination(params);
    if ("error" in pagination) return pagination.error;
    const { page, limit } = pagination;
    const { sort, order } = parseSorting(params, [...taskRestSortFields]);

    const { rows, total } = await auth.context.caller.tasks.list({
      ...(projectId ? { projectId } : {}),
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      restPage: {
        page: Math.min(page, Number.MAX_SAFE_INTEGER),
        limit,
        sort: sort as (typeof taskRestSortFields)[number],
        order,
      },
    });
    return withRateLimitHeaders(
      paginatedResponse(rows, page, limit, total ?? 0),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

// POST /api/v1/tasks — create a task
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "tasks", "write");
  if (scopeErr) return scopeErr;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }

    const b = body as Record<string, unknown>;

    if (typeof b.title !== "string" || !b.title) {
      return errorResponse(400, "BAD_REQUEST", "title is required");
    }
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

    const result = await auth.context.caller.tasks.create({
      title: b.title,
      description: b.description as string | undefined,
      projectId: b.projectId as string | undefined,
      clientId: b.clientId as string | undefined,
      status: b.status as TaskStatus | undefined,
      priority: b.priority as TaskPriority | undefined,
      deadline: b.deadline ? new Date(b.deadline as string) : undefined,
      parentTaskId: b.parentTaskId as string | undefined,
      estimatedMinutes: b.estimatedMinutes as number | undefined,
      sourceType: b.sourceType as
        | "manual"
        | "email"
        | "calendar"
        | "extension"
        | undefined,
      sourceId: b.sourceId as string | undefined,
      sourceUrl: b.sourceUrl as string | undefined,
      position: b.position as number | undefined,
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
