import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { db } from "@/lib/db";
import {
  activityLogs,
  clients,
  members,
  projects,
  taskAttachments,
  taskStatuses,
  tasks,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import {
  completedAtChange,
  isCompletedTask,
  type LaneCategory,
  legacyStatusForLane,
  resolveTaskLaneId,
} from "@/lib/kanban/lane-category";
import {
  countOwnedTasks,
  listBoardLanes,
  notCancelledTask,
  saveTaskOrder,
} from "@/lib/kanban/lanes-server";
import { pushToUser } from "@/lib/notifications/push";
import {
  assertTaskBulkResolutionHash,
  buildTaskBulkResolutionPreview,
} from "@/lib/tasks/bulk-resolution";
import { parseEstimate } from "@/lib/tasks/time-progress";
import { toTimeTaskPayload } from "@/lib/tasks/time-task-payload";
import {
  copenhagenDayEndExclusive,
  copenhagenToday,
  copenhagenTodayAnchor,
} from "@/lib/time/copenhagen";
import { deleteTaskImageByUrl, taskImageKeyFromUrl } from "@/lib/upload/s3";
import { emitWebhookEvent } from "@/lib/webhooks/events";
import { moduleReadProcedure, moduleWriteProcedure, router } from "../trpc";

/**
 * Verify that optional projectId / clientId / parentTaskId references all
 * belong to the current user. Prevents cross-tenant data leakage via tasks
 * that join their project/client/parentTask relations (see tasks.getById).
 */
export async function assertTaskReferencesOwned(
  userId: string,
  refs: {
    projectId?: string | null;
    clientId?: string | null;
    parentTaskId?: string | null;
  },
  orgId?: string | null,
): Promise<void> {
  if (refs.projectId) {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, refs.projectId),
        orgId
          ? eq(projects.organizationId, orgId)
          : eq(projects.userId, userId),
      ),
      columns: { id: true },
    });
    if (!project) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "common.projectNotFound"),
      });
    }
  }
  if (refs.clientId) {
    const client = await db.query.clients.findFirst({
      where: and(
        eq(clients.id, refs.clientId),
        orgId ? eq(clients.organizationId, orgId) : eq(clients.userId, userId),
      ),
      columns: { id: true },
    });
    if (!client) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "common.clientNotFound"),
      });
    }
  }
  if (refs.parentTaskId) {
    const parent = await db.query.tasks.findFirst({
      where: and(
        eq(tasks.id, refs.parentTaskId),
        orgId ? eq(tasks.organizationId, orgId) : eq(tasks.userId, userId),
      ),
      columns: { id: true, parentTaskId: true },
    });
    if (!parent) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "tasks.parentNotFound"),
      });
    }
    // Only one level of nesting. Without this a 3-deep chain (A→B→C) would
    // orphan C when A is deleted: delete() removes only direct children, and
    // tasks.parent_task_id has no FK to cascade the rest.
    if (parent.parentTaskId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "tasks.subtaskNoSubtasks"),
      });
    }
  }
}

// Validation schemas - updated for Kanban workflow
const taskStatusEnum = z.enum(["backlog", "todo", "in_progress", "done"]);
const taskPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);
const sourceTypeEnum = z.enum(["manual", "email", "calendar", "extension"]);

const createTaskSchema = z.object({
  title: z
    .string()
    .min(1, { error: () => st("zod.titleRequired") })
    .max(255),
  description: z.string().max(10000).optional(),
  projectId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  status: taskStatusEnum.default("backlog"),
  // When provided, the new row is placed into this lane (Kanban custom
  // lanes). Legacy `status` is still written so unmigrated code paths
  // keep working during the transition.
  statusId: z.string().uuid().optional().nullable(),
  priority: taskPriorityEnum.default("medium"),
  deadline: z.date().optional().nullable(),
  // New fields
  parentTaskId: z.string().uuid().optional().nullable(),
  estimatedMinutes: z.number().int().positive().optional().nullable(),
  sourceType: sourceTypeEnum.default("manual"),
  sourceId: z.string().max(255).optional().nullable(),
  sourceUrl: z.string().url().max(2000).optional().nullable(),
  position: z.number().int().optional(),
});

const updateTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(10000).nullable().optional(),
  notes: z.string().max(100000).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  deadline: z.date().nullable().optional(),
  // New fields
  parentTaskId: z.string().uuid().nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  actualMinutes: z.number().int().positive().nullable().optional(),
  position: z.number().int().optional(),
  // AI suggestion acceptance
  acceptAiProject: z.boolean().optional(),
  acceptAiClient: z.boolean().optional(),
  acceptAiPriority: z.boolean().optional(),
  acceptAiDeadline: z.boolean().optional(),
});

// Quick add schema for natural language input
const quickAddSchema = z.object({
  text: z
    .string()
    .min(1, { error: () => st("zod.textRequired") })
    .max(1000),
  projectId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
});

// Reorder schema for Kanban drag-and-drop
const reorderSchema = z.object({
  taskId: z.string().uuid(),
  newStatus: taskStatusEnum,
  newPosition: z.number().int().min(0),
});

// Bulk operations schema
const bulkUpdateSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1),
  updates: z.object({
    status: taskStatusEnum.optional(),
    priority: taskPriorityEnum.optional(),
    projectId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().nullable().optional(),
  }),
});

const bulkResolutionSelectionSchema = z.object({
  id: z.string().uuid(),
  expectedStatus: z.enum(["backlog", "todo", "in_progress"]),
});

const bulkResolutionSchema = z.object({
  tasks: z.array(bulkResolutionSelectionSchema).min(1).max(250),
  resolution: z.enum(["irrelevant", "resolved"]),
});

const applyBulkResolutionSchema = bulkResolutionSchema.extend({
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
});

const bulkResolutionColumns = {
  id: tasks.id,
  title: tasks.title,
  status: tasks.status,
  statusId: tasks.statusId,
  sourceType: tasks.sourceType,
  emailRelevanceFeedback: tasks.emailRelevanceFeedback,
  completedAt: tasks.completedAt,
  updatedAt: tasks.updatedAt,
};

// Helper function to get next occurrence of a weekday
function getNextWeekday(weekday: number): Date {
  const today = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)
  const currentDay = today.getDay();
  const daysUntil = (weekday - currentDay + 7) % 7 || 7;
  const result = new Date(today);
  result.setDate(result.getDate() + daysUntil);
  return result;
}

// Simple text parsing without AI
function simpleParseText(text: string): {
  title: string;
  deadline: Date | null;
  priority: "low" | "medium" | "high" | "urgent";
  estimatedMinutes: number | null;
} {
  let title = text;
  let deadline: Date | null = null;
  let priority: "low" | "medium" | "high" | "urgent" = "medium";
  let estimatedMinutes: number | null = null;

  // Estimat ("~4t", "30 min") — samme parser som klientens quick-add (#212)
  const estimate = parseEstimate(title);
  if (estimate) {
    estimatedMinutes = estimate.minutes;
    title = estimate.rest;
  }

  // Simple deadline extraction (Danish)
  const deadlinePatterns = [
    { pattern: /i morgen/i, days: 1 },
    { pattern: /i overmorgen/i, days: 2 },
    { pattern: /om (\d+) dag(e)?/i, daysMatch: 1 },
    { pattern: /inden fredag/i, weekday: 5 },
    { pattern: /inden mandag/i, weekday: 1 },
    { pattern: /inden tirsdag/i, weekday: 2 },
    { pattern: /inden onsdag/i, weekday: 3 },
    { pattern: /inden torsdag/i, weekday: 4 },
    { pattern: /inden lørdag/i, weekday: 6 },
    { pattern: /inden søndag/i, weekday: 0 },
  ];

  for (const { pattern, days, daysMatch, weekday } of deadlinePatterns) {
    const match = title.match(pattern);
    if (match) {
      if (days) {
        deadline = new Date();
        deadline.setDate(deadline.getDate() + days);
      } else if (daysMatch !== undefined && match[daysMatch]) {
        deadline = new Date();
        deadline.setDate(deadline.getDate() + parseInt(match[daysMatch], 10));
      } else if (weekday !== undefined) {
        deadline = getNextWeekday(weekday);
      }
      // Remove deadline text from title
      title = title.replace(pattern, "").trim();
      break;
    }
  }

  // Simple priority extraction
  if (/urgent|kritisk/i.test(title)) {
    priority = "urgent";
    title = title.replace(/urgent|kritisk/gi, "").trim();
  } else if (/haster|asap|vigtig/i.test(title)) {
    priority = "high";
    title = title.replace(/haster|asap|vigtig/gi, "").trim();
  } else if (/lavprioriteret|når du har tid/i.test(title)) {
    priority = "low";
    title = title.replace(/lavprioriteret|når du har tid/gi, "").trim();
  }

  return { title, deadline, priority, estimatedMinutes };
}

/**
 * Registreret tid (minutter) pr. opgave for alle opgaver der matcher `where`
 * — ét GROUP BY over time_entries i stedet for et opslag pr. opgave (#212).
 * Summerer posteringerne direkte frem for `tasks.actualMinutes`, fordi den
 * denormaliserede kolonne kun vedligeholdes af en del af oprettelsesstierne
 * (timer, API, import, kalender …). Samme regnestykke som sidepanelets "Tid".
 */
async function trackedMinutesByTask(
  where: SQL | undefined,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      taskId: timeEntries.taskId,
      hours: sql<string>`COALESCE(SUM(${timeEntries.hours}), 0)`,
    })
    .from(timeEntries)
    .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
    .where(where)
    .groupBy(timeEntries.taskId);
  const result = new Map<string, number>();
  for (const row of rows) {
    if (row.taskId) result.set(row.taskId, Math.round(Number(row.hours) * 60));
  }
  return result;
}

/**
 * Opgaver grupperet efter tavlens kolonner. Delt af Kanban-tavlen
 * (`listByStatus`, kræver opgave-adgang) og opgavevalget i
 * tidsregistreringen (`listForTime`, kræver kun tids-adgang, #1116).
 */
async function listTasksGroupedByStatus(
  userId: string,
  orgId: string | null,
  input?: {
    projectId?: string;
    clientId?: string;
    filterProjectId?: string;
  },
) {
  const conditions = [
    orgId ? eq(tasks.organizationId, orgId) : eq(tasks.userId, userId),
    isNull(tasks.parentTaskId),
  ];

  if (input?.projectId) {
    conditions.push(eq(tasks.projectId, input.projectId));
  } else if (input?.filterProjectId) {
    conditions.push(eq(tasks.projectId, input.filterProjectId));
  }
  if (input?.clientId) {
    conditions.push(eq(tasks.clientId, input.clientId));
  }

  const [rawTasks, trackedByTask] = await Promise.all([
    db.query.tasks.findMany({
      where: and(...conditions),
      with: {
        project: {
          columns: {
            id: true,
            name: true,
          },
          with: {
            client: {
              columns: {
                id: true,
                name: true,
                color: true,
              },
            },
          },
        },
        client: {
          columns: {
            id: true,
            name: true,
            color: true,
          },
        },
        subtasks: {
          columns: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
      orderBy: [asc(tasks.position), desc(tasks.createdAt)],
    }),
    trackedMinutesByTask(and(...conditions)),
  ]);
  const allTasks = rawTasks.map((t) => ({
    ...t,
    client: t.client ?? t.project?.client ?? null,
    trackedMinutes: trackedByTask.get(t.id) ?? 0,
  }));

  // Grupér efter tavlens kolonner. resolveTaskLaneId placerer også
  // opgaver uden statusId, opgaver hvis status er ændret et andet sted
  // (desktop, API, listen) og opgaver med en kolonne fra et andet board,
  // så ingen opgave falder ud af tavlen.
  const userLanes = await listBoardLanes(db, {
    userId,
    orgId,
    projectId: input?.projectId ?? null,
  });

  const grouped: Record<string, typeof allTasks> = {};
  for (const row of allTasks) {
    const key = resolveTaskLaneId(row, userLanes) ?? row.status;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(row);
  }

  // Auto-archive: remove done tasks older than 14 days from archive lanes
  const archiveLaneIds = new Set(
    userLanes.filter((l) => l.isArchive).map((l) => l.id),
  );
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  for (const laneId of archiveLaneIds) {
    if (grouped[laneId]) {
      grouped[laneId] = grouped[laneId].filter(
        (task) =>
          !task.completedAt || new Date(task.completedAt) > fourteenDaysAgo,
      );
    }
  }

  return grouped;
}

export const tasksRouter = router({
  // List all tasks for current user (with Kanban support)
  list: moduleReadProcedure("tasks")
    .input(
      z
        .object({
          status: taskStatusEnum.optional(),
          priority: taskPriorityEnum.optional(),
          projectId: z.string().uuid().optional(),
          clientId: z.string().uuid().optional(),
          parentTaskId: z.string().uuid().optional().nullable(),
          includeSubtasks: z.boolean().optional().default(false),
          orderBy: z
            .enum(["position", "deadline", "createdAt", "priority"])
            .optional()
            .default("position"),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Build where conditions
      const conditions = [
        ctx.orgId
          ? eq(tasks.organizationId, ctx.orgId)
          : eq(tasks.userId, userId),
      ];

      if (input?.status) {
        conditions.push(eq(tasks.status, input.status));
      }
      if (input?.priority) {
        conditions.push(eq(tasks.priority, input.priority));
      }
      if (input?.projectId) {
        conditions.push(eq(tasks.projectId, input.projectId));
      }
      if (input?.clientId) {
        conditions.push(eq(tasks.clientId, input.clientId));
      }

      // Filter by parent (null for top-level tasks)
      if (input?.parentTaskId !== undefined) {
        if (input.parentTaskId === null) {
          conditions.push(isNull(tasks.parentTaskId));
        } else {
          conditions.push(eq(tasks.parentTaskId, input.parentTaskId));
        }
      } else if (!input?.includeSubtasks) {
        // Default: only show top-level tasks
        conditions.push(isNull(tasks.parentTaskId));
      }

      // Determine order
      const orderByClause =
        input?.orderBy === "deadline"
          ? [asc(tasks.deadline), asc(tasks.position)]
          : input?.orderBy === "createdAt"
            ? [desc(tasks.createdAt)]
            : input?.orderBy === "priority"
              ? [desc(tasks.priority), asc(tasks.position)]
              : [asc(tasks.position), desc(tasks.createdAt)];

      const [allTasks, trackedByTask] = await Promise.all([
        db.query.tasks.findMany({
          where: and(...conditions),
          with: {
            project: {
              columns: {
                id: true,
                name: true,
              },
              with: {
                client: {
                  columns: {
                    id: true,
                    name: true,
                    color: true,
                  },
                },
              },
            },
            client: {
              columns: {
                id: true,
                name: true,
                color: true,
              },
            },
            subtasks: {
              columns: {
                id: true,
                title: true,
                status: true,
              },
            },
          },
          orderBy: orderByClause,
        }),
        trackedMinutesByTask(and(...conditions)),
      ]);

      return allTasks.map((t) => ({
        ...t,
        client: t.client ?? t.project?.client ?? null,
        trackedMinutes: trackedByTask.get(t.id) ?? 0,
      }));
    }),

  // List tasks grouped by status (for Kanban board)
  listByStatus: moduleReadProcedure("tasks")
    .input(
      z
        .object({
          projectId: z.string().uuid().optional(),
          clientId: z.string().uuid().optional(),
          // Projektets opgaver i de generelle lanes — boardet på projektsiden
          // (#213). `projectId` skifter derimod til projekt-scopede lanes.
          filterProjectId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      listTasksGroupedByStatus(ctx.session.user.id, ctx.orgId, input),
    ),

  // Opgavevalget i tidsregistreringen (timer, ny/hurtig/rediger post,
  // kalender). Kræver kun adgang til tid, så en rolle med "none" på
  // opgaver stadig kan knytte tiden til en opgave (#1116). Svaret er
  // skåret ned til det, valget viser (toTimeTaskPayload).
  listForTime: moduleReadProcedure("time").query(async ({ ctx }) =>
    toTimeTaskPayload(
      await listTasksGroupedByStatus(ctx.session.user.id, ctx.orgId),
    ),
  ),

  // Get single task by ID
  getById: moduleReadProcedure("tasks")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const task = await db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, input.id),
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, userId),
        ),
        with: {
          project: true,
          client: true,
          subtasks: {
            with: {
              project: {
                columns: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: [asc(tasks.position)],
          },
          parentTask: {
            columns: {
              id: true,
              title: true,
            },
          },
          aiSuggestedProjectRef: {
            columns: {
              id: true,
              name: true,
            },
          },
          aiSuggestedClientRef: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!task) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.taskNotFound"),
        });
      }

      return task;
    }),

  // Den tilknyttede opgave, når timeren gemmes: kun titel og status, så
  // gem-dialogen kan vise opgaven uden adgang til opgavemodulet (#1116).
  // "Markér som færdig" (tasks.markDone) kræver stadig skriveadgang til
  // opgaver og tilbydes kun til roller, der har den.
  getForTime: moduleReadProcedure("time")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const task = await db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, input.id),
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, ctx.session.user.id),
        ),
        columns: { id: true, title: true, status: true },
      });

      if (!task) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.taskNotFound"),
        });
      }

      return task;
    }),

  // Create new task
  create: moduleWriteProcedure("tasks")
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify referenced project/client/parentTask all belong to user —
      // otherwise tasks.getById would leak cross-tenant relation data.
      await assertTaskReferencesOwned(
        userId,
        {
          projectId: input.projectId,
          clientId: input.clientId,
          parentTaskId: input.parentTaskId,
        },
        ctx.orgId,
      );

      // If a statusId (Kanban lane UUID) is supplied, verify the lane belongs
      // to the same org (or user, solo) to prevent cross-tenant lane placement.
      // Org-scoped: a teammate's lane is a valid target within the same org.
      let status: string = input.status;
      let laneCategory: LaneCategory | undefined;
      if (input.statusId) {
        const laneOwnership = ctx.orgId
          ? eq(taskStatuses.organizationId, ctx.orgId)
          : eq(taskStatuses.userId, userId);
        const [lane] = await db
          .select({
            id: taskStatuses.id,
            projectId: taskStatuses.projectId,
            name: taskStatuses.name,
            category: taskStatuses.category,
          })
          .from(taskStatuses)
          .where(and(eq(taskStatuses.id, input.statusId), laneOwnership))
          .limit(1);
        if (!lane) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "tasks.laneNotFound"),
          });
        }
        // A project lane only holds that project's tasks. General lanes hold
        // every task — also project tasks, which the general board shows (and
        // the project page's board adds inline, #213) — so they are not gated.
        if (
          lane.projectId !== null &&
          lane.projectId !== (input.projectId ?? null)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "tasks.laneOtherBoard"),
          });
        }
        // Kolonnens kategori bestemmer status (en opgave oprettet i "I gang"
        // er i gang, ikke backlog).
        status = legacyStatusForLane(lane, input.status);
        laneCategory = lane.category;
      }

      // Get next position for status column
      let position = input.position;
      if (position === undefined) {
        const maxPositionResult = await db
          .select({ maxPos: sql<number>`COALESCE(MAX(position), 0)` })
          .from(tasks)
          .where(and(eq(tasks.userId, userId), eq(tasks.status, status)));
        position = (maxPositionResult[0]?.maxPos ?? 0) + 1;
      }

      const [newTask] = await db
        .insert(tasks)
        .values({
          title: input.title,
          description: input.description,
          projectId: input.projectId,
          clientId: input.clientId,
          status,
          statusId: input.statusId ?? null,
          completedAt: isCompletedTask(status, laneCategory)
            ? new Date()
            : null,
          priority: input.priority,
          deadline: input.deadline ? new Date(input.deadline) : null,
          parentTaskId: input.parentTaskId,
          estimatedMinutes: input.estimatedMinutes,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceUrl: input.sourceUrl,
          position,
          userId,
          organizationId: ctx.orgId,
        })
        .returning();

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "task.created",
        eventId: newTask.id,
        data: { task: newTask },
        clientId: newTask.clientId,
        projectId: newTask.projectId,
      });

      return newTask;
    }),

  // Quick add with natural language (to be enhanced with AI later)
  quickAdd: moduleWriteProcedure("tasks")
    .input(quickAddSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify referenced project/client belong to user
      await assertTaskReferencesOwned(
        userId,
        {
          projectId: input.projectId,
          clientId: input.clientId,
        },
        ctx.orgId,
      );

      // Try AI parsing first, fall back to simple parsing
      let title = input.text;
      let description: string | null = null;
      let deadline: Date | null = null;
      let priority: "low" | "medium" | "high" | "urgent" = "medium";
      let estimatedMinutes: number | null = null;
      let aiConfidence: number | null = null;
      let sourceType: "manual" | "ai" = "manual";

      try {
        // Dynamically import AI module to avoid issues if not configured
        const { parseTextToTask, isAIEnabled } = await import("@/lib/ai");

        if (isAIEnabled()) {
          const parsed = await parseTextToTask(input.text);

          title = parsed.title;
          description = parsed.description;
          priority = parsed.priority;
          estimatedMinutes = parsed.estimatedMinutes;
          aiConfidence = parsed.confidence;
          sourceType = "ai";

          if (parsed.deadline) {
            deadline = new Date(parsed.deadline);
          }
        } else {
          // Fallback to simple parsing
          ({ title, deadline, priority, estimatedMinutes } = simpleParseText(
            input.text,
          ));
        }
      } catch (error) {
        // AI parsing failed, use simple parsing
        console.error("AI parsing failed, using simple parsing:", error);
        ({ title, deadline, priority, estimatedMinutes } = simpleParseText(
          input.text,
        ));
      }

      // Get next position
      const maxPositionResult = await db
        .select({ maxPos: sql<number>`COALESCE(MAX(position), 0)` })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.status, "backlog")));
      const position = (maxPositionResult[0]?.maxPos ?? 0) + 1;

      const [newTask] = await db
        .insert(tasks)
        .values({
          title: title.trim(),
          description,
          projectId: input.projectId,
          clientId: input.clientId,
          deadline,
          priority,
          estimatedMinutes,
          aiConfidence: aiConfidence ? String(aiConfidence) : null,
          status: "backlog",
          position,
          sourceType,
          userId,
          organizationId: ctx.orgId,
        })
        .returning();

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "task.created",
        eventId: newTask.id,
        data: { task: newTask },
        clientId: newTask.clientId,
        projectId: newTask.projectId,
      });

      return newTask;
    }),

  // Update existing task
  update: moduleWriteProcedure("tasks")
    .input(updateTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const {
        id,
        acceptAiProject,
        acceptAiClient,
        acceptAiPriority,
        acceptAiDeadline,
        ...updateData
      } = input;

      // Verify ownership
      const ownershipFilter = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);
      const existingTask = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, id), ownershipFilter),
      });

      if (!existingTask) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.taskNotFound"),
        });
      }

      // Verify any new project/client/parentTask references belong to user
      await assertTaskReferencesOwned(
        userId,
        {
          projectId: updateData.projectId,
          clientId: updateData.clientId,
          parentTaskId: updateData.parentTaskId,
        },
        ctx.orgId,
      );

      // Prepare update data
      const dataToUpdate: Record<string, unknown> = {
        ...updateData,
        updatedAt: new Date(),
      };

      // Handle deadline conversion
      if (input.deadline !== undefined) {
        dataToUpdate.deadline = input.deadline
          ? new Date(input.deadline)
          : null;
      }

      // Handle AI suggestion acceptance
      if (acceptAiProject && existingTask.aiSuggestedProject) {
        dataToUpdate.projectId = existingTask.aiSuggestedProject;
        dataToUpdate.aiSuggestedProject = null;
      }
      if (acceptAiClient && existingTask.aiSuggestedClient) {
        dataToUpdate.clientId = existingTask.aiSuggestedClient;
        dataToUpdate.aiSuggestedClient = null;
      }
      if (acceptAiPriority && existingTask.aiSuggestedPriority) {
        dataToUpdate.priority = existingTask.aiSuggestedPriority;
        dataToUpdate.aiSuggestedPriority = null;
      }
      if (acceptAiDeadline && existingTask.aiSuggestedDeadline) {
        dataToUpdate.deadline = existingTask.aiSuggestedDeadline;
        dataToUpdate.aiSuggestedDeadline = null;
      }

      // Handle status change - set completedAt
      if (input.status === "done" && existingTask.status !== "done") {
        dataToUpdate.completedAt = new Date();
      } else if (
        input.status &&
        input.status !== "done" &&
        existingTask.status === "done"
      ) {
        dataToUpdate.completedAt = null;
      }

      const [updatedTask] = await db
        .update(tasks)
        .set(dataToUpdate)
        .where(eq(tasks.id, id))
        .returning();

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType:
          input.status === "done" && existingTask.status !== "done"
            ? "task.completed"
            : "task.updated",
        eventId: updatedTask.id,
        data: { task: updatedTask },
        clientId: updatedTask.clientId,
        projectId: updatedTask.projectId,
      });

      return updatedTask;
    }),

  // Move task to a Kanban lane (data-driven taskStatuses) and, with
  // `orderedTaskIds`, save the lane's manual card order in the same go.
  // The lane's category sets the legacy `status` (+ completedAt), so
  // reports, filters and the desktop app see the move.
  move: moduleWriteProcedure("tasks")
    .input(
      z.object({
        taskId: z.string().uuid(),
        statusId: z.string().uuid(),
        // Kolonnens kort i ny rækkefølge (inkl. taskId). Udelades den,
        // bevares positionerne.
        orderedTaskIds: z.array(z.string().uuid()).max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Ownership: the target lane must belong to the same org (or user, solo)
      // as the task. Org-scoped so a task can move into a teammate's lane.
      const laneOwnership = ctx.orgId
        ? eq(taskStatuses.organizationId, ctx.orgId)
        : eq(taskStatuses.userId, userId);
      const [lane] = await db
        .select({
          id: taskStatuses.id,
          scope: taskStatuses.scope,
          projectId: taskStatuses.projectId,
          name: taskStatuses.name,
          category: taskStatuses.category,
        })
        .from(taskStatuses)
        .where(and(eq(taskStatuses.id, input.statusId), laneOwnership))
        .limit(1);
      if (!lane) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "tasks.laneNotFound"),
        });
      }

      // Verify task ownership.
      const ownershipFilter = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);
      const existingTask = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, input.taskId), ownershipFilter),
      });
      if (!existingTask) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.taskNotFound"),
        });
      }

      // A project lane only holds that project's tasks (as in create).
      // General lanes hold every task: the general board shows project
      // tasks too, also those whose statusId still points at a project lane
      // from the old per-project boards.
      if (
        lane.projectId !== null &&
        lane.projectId !== existingTask.projectId
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "tasks.moveSameBoard"),
        });
      }

      const orderedTaskIds = input.orderedTaskIds;
      if (orderedTaskIds) {
        const unique = new Set(orderedTaskIds);
        if (
          unique.size !== orderedTaskIds.length ||
          !unique.has(input.taskId)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "tasks.invalidOrder"),
          });
        }
        if (
          (await countOwnedTasks(db, orderedTaskIds, ownershipFilter)) !==
          orderedTaskIds.length
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "tasks.taskNotFound"),
          });
        }
      }

      const newStatus = legacyStatusForLane(lane, existingTask.status);
      // Afsluttet og annulleret har begge den gamle status "done";
      // kolonnens kategori skiller dem, så en annullering hverken får
      // completedAt eller udsender task.completed.
      const [previousLane] = existingTask.statusId
        ? await db
            .select({ category: taskStatuses.category })
            .from(taskStatuses)
            .where(eq(taskStatuses.id, existingTask.statusId))
            .limit(1)
        : [];
      const wasCompleted = isCompletedTask(
        existingTask.status,
        previousLane?.category,
      );
      const willBeCompleted = isCompletedTask(newStatus, lane.category);
      const now = new Date();
      const updatedTask = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(tasks)
          .set({
            statusId: input.statusId,
            status: newStatus,
            ...completedAtChange(wasCompleted, willBeCompleted, now),
            updatedAt: now,
          })
          .where(and(eq(tasks.id, input.taskId), ownershipFilter))
          .returning();
        if (orderedTaskIds) {
          await saveTaskOrder(tx, orderedTaskIds, ownershipFilter);
        }
        return row;
      });

      if (willBeCompleted && !wasCompleted) {
        emitWebhookEvent({
          userId,
          orgId: ctx.orgId,
          eventType: "task.completed",
          eventId: updatedTask.id,
          data: { task: updatedTask },
          clientId: updatedTask.clientId,
          projectId: updatedTask.projectId,
        });
      }

      return { ok: true, status: newStatus };
    }),

  // Reorder task (for Kanban drag-and-drop)
  reorder: moduleWriteProcedure("tasks")
    .input(reorderSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const ownershipFilter = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);
      const existingTask = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, input.taskId), ownershipFilter),
      });

      if (!existingTask) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.taskNotFound"),
        });
      }

      const oldStatus = existingTask.status;
      const oldPosition = existingTask.position ?? 0;
      const newStatus = input.newStatus;
      const newPosition = input.newPosition;

      // Start transaction-like operations
      if (oldStatus === newStatus) {
        // Same column - just reorder
        if (oldPosition < newPosition) {
          // Moving down - shift items up
          await db
            .update(tasks)
            .set({ position: sql`position - 1` })
            .where(
              and(
                eq(tasks.userId, userId),
                eq(tasks.status, newStatus),
                sql`position > ${oldPosition}`,
                sql`position <= ${newPosition}`,
              ),
            );
        } else if (oldPosition > newPosition) {
          // Moving up - shift items down
          await db
            .update(tasks)
            .set({ position: sql`position + 1` })
            .where(
              and(
                eq(tasks.userId, userId),
                eq(tasks.status, newStatus),
                sql`position >= ${newPosition}`,
                sql`position < ${oldPosition}`,
              ),
            );
        }
      } else {
        // Different column - remove from old, insert into new
        // Shift old column up
        await db
          .update(tasks)
          .set({ position: sql`position - 1` })
          .where(
            and(
              eq(tasks.userId, userId),
              eq(tasks.status, oldStatus),
              sql`position > ${oldPosition}`,
            ),
          );

        // Shift new column down
        await db
          .update(tasks)
          .set({ position: sql`position + 1` })
          .where(
            and(
              eq(tasks.userId, userId),
              eq(tasks.status, newStatus),
              sql`position >= ${newPosition}`,
            ),
          );
      }

      // Update the task itself
      const updateData: Record<string, unknown> = {
        status: newStatus,
        position: newPosition,
        updatedAt: new Date(),
      };

      // Set completedAt when moving to done
      if (newStatus === "done" && oldStatus !== "done") {
        updateData.completedAt = new Date();
      } else if (newStatus !== "done" && oldStatus === "done") {
        updateData.completedAt = null;
      }

      const [updatedTask] = await db
        .update(tasks)
        .set(updateData)
        .where(eq(tasks.id, input.taskId))
        .returning();

      if (newStatus === "done" && oldStatus !== "done") {
        emitWebhookEvent({
          userId,
          orgId: ctx.orgId,
          eventType: "task.completed",
          eventId: updatedTask.id,
          data: { task: updatedTask },
          clientId: updatedTask.clientId,
          projectId: updatedTask.projectId,
        });
      }

      return updatedTask;
    }),

  // Preview a tightly scoped backlog reset. This deliberately bypasses the
  // email feedback learning flow: it neither creates filters nor trains the
  // classification cache.
  previewBulkResolution: moduleWriteProcedure("tasks")
    .input(bulkResolutionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownership = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);
      const taskIds = input.tasks.map((task) => task.id);

      const rows = await ctx.db
        .select(bulkResolutionColumns)
        .from(tasks)
        .where(and(ownership, inArray(tasks.id, taskIds)))
        .orderBy(asc(tasks.id));

      try {
        return buildTaskBulkResolutionPreview({
          requested: input.tasks,
          rows,
          resolution: input.resolution,
        });
      } catch (error) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            error instanceof Error
              ? error.message
              : await tr("serverErrors", "tasks.dryRunFailed"),
        });
      }
    }),

  // Apply exactly the previewed rows. SELECT FOR UPDATE keeps the snapshot
  // stable until updates and audit rows have committed in the same transaction.
  applyBulkResolution: moduleWriteProcedure("tasks")
    .input(applyBulkResolutionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const taskIds = input.tasks.map((task) => task.id);

      return ctx.db.transaction(async (tx) => {
        const ownership = ctx.orgId
          ? eq(tasks.organizationId, ctx.orgId)
          : eq(tasks.userId, userId);
        const rows = await tx
          .select(bulkResolutionColumns)
          .from(tasks)
          .where(and(ownership, inArray(tasks.id, taskIds)))
          .orderBy(asc(tasks.id))
          .for("update");

        let preview: ReturnType<typeof buildTaskBulkResolutionPreview>;
        try {
          preview = buildTaskBulkResolutionPreview({
            requested: input.tasks,
            rows,
            resolution: input.resolution,
          });
          assertTaskBulkResolutionHash(preview, input.expectedHash);
        } catch (error) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              error instanceof Error
                ? error.message
                : await tr("serverErrors", "tasks.bulkFailed"),
          });
        }

        const now = new Date();
        const updateData =
          input.resolution === "irrelevant"
            ? {
                status: "done",
                completedAt: now,
                emailRelevanceFeedback: "irrelevant",
                feedbackProvidedAt: now,
                updatedAt: now,
              }
            : {
                status: "done",
                completedAt: now,
                updatedAt: now,
              };

        const updatedRows = await tx
          .update(tasks)
          .set(updateData)
          .where(and(ownership, inArray(tasks.id, taskIds)))
          .returning({ id: tasks.id });

        if (updatedRows.length !== preview.count) {
          throw new TRPCError({
            code: "CONFLICT",
            message: await tr("serverErrors", "tasks.bulkRolledBack"),
          });
        }

        await tx.insert(activityLogs).values(
          preview.items.map((item) => ({
            userId,
            organizationId: ctx.orgId ?? null,
            entityType: "task",
            entityId: item.id,
            action: "bulk_resolution",
            entityName: item.title,
            changes: {
              status: {
                from: item.before.status,
                to: item.after.status,
              },
              emailRelevanceFeedback: {
                from: item.before.emailRelevanceFeedback,
                to: item.after.emailRelevanceFeedback,
              },
            },
            metadata: {
              resolution: input.resolution,
              dryRunHash: preview.hash,
            },
          })),
        );

        return {
          success: true,
          count: preview.count,
          hash: preview.hash,
          items: preview.items,
        };
      });
    }),

  // Bulk update tasks
  bulkUpdate: moduleWriteProcedure("tasks")
    .input(bulkUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Samme reference-validering som create/quickAdd/update. Uden den kunne
      // en bulk-opdatering pege tasks på en fremmed klient/projekt, som
      // bagefter blev læst tilbage via getById's client/project-join.
      await assertTaskReferencesOwned(userId, input.updates, ctx.orgId);

      const updateData: Record<string, unknown> = {
        ...input.updates,
        updatedAt: new Date(),
      };

      // Handle status change
      if (input.updates.status === "done") {
        updateData.completedAt = new Date();
      } else if (input.updates.status) {
        // Moving to any non-done status clears completedAt
        updateData.completedAt = null;
      }

      // Org-aware so bulk edits cover org-shared tasks, consistent with the
      // single-task update/move/delete procedures (not just the caller's own).
      const bulkOwnership = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);
      await db
        .update(tasks)
        .set(updateData)
        .where(and(bulkOwnership, inArray(tasks.id, input.taskIds)));

      return { success: true, count: input.taskIds.length };
    }),

  // Bulk delete tasks
  bulkDelete: moduleWriteProcedure("tasks")
    .input(z.object({ taskIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Org-aware ownership, consistent with the single-task delete procedure.
      const bulkOwnership = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);

      // Delete subtasks first
      await db
        .delete(tasks)
        .where(and(bulkOwnership, inArray(tasks.parentTaskId, input.taskIds)));

      // Delete the tasks themselves
      await db
        .delete(tasks)
        .where(and(bulkOwnership, inArray(tasks.id, input.taskIds)));

      return { success: true, count: input.taskIds.length };
    }),

  // Mark task as done (shortcut)
  markDone: moduleWriteProcedure("tasks")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const ownershipFilter = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);
      const existingTask = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, input.id), ownershipFilter),
      });

      if (!existingTask) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.taskNotFound"),
        });
      }

      const [updatedTask] = await db
        .update(tasks)
        .set({
          status: "done",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, input.id), ownershipFilter))
        .returning();

      if (existingTask.status !== "done") {
        emitWebhookEvent({
          userId,
          orgId: ctx.orgId,
          eventType: "task.completed",
          eventId: updatedTask.id,
          data: { task: updatedTask },
          clientId: updatedTask.clientId,
          projectId: updatedTask.projectId,
        });
      }

      return updatedTask;
    }),

  // Assign a task to a team member (null = unassign)
  setAssignee: moduleWriteProcedure("tasks")
    .input(
      z.object({
        id: z.string().uuid(),
        assignedToUserId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownershipFilter = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);

      const existingTask = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, input.id), ownershipFilter),
        columns: { id: true },
      });
      if (!existingTask) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.taskNotFound"),
        });
      }

      // Assignment is a team-only feature: require an active org, and the
      // assignee must be a member of it. (null always allowed = unassign.)
      if (input.assignedToUserId) {
        if (!ctx.orgId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "tasks.assignNeedsOrg"),
          });
        }
        const member = await db.query.members.findFirst({
          where: and(
            eq(members.organizationId, ctx.orgId),
            eq(members.userId, input.assignedToUserId),
          ),
          columns: { id: true },
        });
        if (!member) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "tasks.assigneeNotMember"),
          });
        }
      }

      const [updated] = await db
        .update(tasks)
        .set({
          assignedToUserId: input.assignedToUserId,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, input.id), ownershipFilter))
        .returning();

      // Notify the assignee (but not when assigning to yourself). Best-effort —
      // pushToUser never throws, so a failed push can't break the assignment.
      if (
        input.assignedToUserId &&
        input.assignedToUserId !== userId &&
        updated
      ) {
        const assigner = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { name: true },
        });
        const pushLocale = await getRecipientLocale({
          userId: input.assignedToUserId,
        });
        await pushToUser(input.assignedToUserId, {
          title: await tr(
            "serverErrors",
            "tasks.assignedPushTitle",
            undefined,
            pushLocale,
          ),
          body: await tr(
            "serverErrors",
            "tasks.assignedPushBody",
            {
              name:
                assigner?.name ??
                (await tr(
                  "serverErrors",
                  "tasks.aColleague",
                  undefined,
                  pushLocale,
                )),
              task: updated.title,
            },
            pushLocale,
          ),
          url: `/dashboard/tasks/${updated.id}`,
          tag: `task-assigned-${updated.id}`,
          data: { taskId: updated.id, type: "task_assigned" },
        });
      }

      return updated;
    }),

  // Reopen task (move back to todo)
  reopen: moduleWriteProcedure("tasks")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const ownershipFilter = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);
      const existingTask = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, input.id), ownershipFilter),
      });

      if (!existingTask) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.taskNotFound"),
        });
      }

      const [updatedTask] = await db
        .update(tasks)
        .set({
          status: "todo",
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, input.id), ownershipFilter))
        .returning();

      return updatedTask;
    }),

  // Delete task
  delete: moduleWriteProcedure("tasks")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const ownershipFilter = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);
      const existingTask = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, input.id), ownershipFilter),
      });

      if (!existingTask) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.taskNotFound"),
        });
      }

      // Delete subtasks first (cascade should handle this, but be explicit)
      await db.delete(tasks).where(eq(tasks.parentTaskId, input.id));
      await db.delete(tasks).where(eq(tasks.id, input.id));

      return { success: true };
    }),

  // Get task stats (updated for Kanban statuses)
  getStats: moduleReadProcedure("tasks").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // PERF: Aggregate in SQL. Previously loaded every parent task for the
    // user and iterated the array 7 times in JavaScript.
    const baseWhere = and(
      ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId),
      isNull(tasks.parentTaskId),
    );
    const now = new Date().toISOString();

    const [statusRows, extras] = await Promise.all([
      db
        .select({
          status: tasks.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(tasks)
        .where(baseWhere)
        .groupBy(tasks.status),
      db
        .select({
          overdue: sql<number>`COUNT(*) FILTER (WHERE ${tasks.deadline} IS NOT NULL AND ${tasks.deadline} < ${now} AND ${tasks.status} != 'done')::int`,
          withDeadline: sql<number>`COUNT(*) FILTER (WHERE ${tasks.deadline} IS NOT NULL)::int`,
          highPriority: sql<number>`COUNT(*) FILTER (WHERE ${tasks.priority} IN ('high','urgent') AND ${tasks.status} != 'done')::int`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'done' AND NOT ${notCancelledTask()})::int`,
        })
        .from(tasks)
        .where(baseWhere),
    ]);

    const statusCount = (status: string) =>
      statusRows.find((r) => r.status === status)?.count ?? 0;

    const total = statusRows.reduce((sum, r) => sum + r.count, 0);
    const extra = extras[0] ?? {
      overdue: 0,
      withDeadline: 0,
      highPriority: 0,
      cancelled: 0,
    };

    return {
      total,
      backlog: statusCount("backlog"),
      todo: statusCount("todo"),
      inProgress: statusCount("in_progress"),
      // Annullerede har også status "done", men er ikke afsluttede.
      done: statusCount("done") - extra.cancelled,
      cancelled: extra.cancelled,
      overdue: extra.overdue,
      withDeadline: extra.withDeadline,
      highPriority: extra.highPriority,
    };
  }),

  // Get upcoming tasks (deadline within 7 days)
  getUpcoming: moduleReadProcedure("tasks").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // PERF: Push deadline window + status filter into SQL instead of loading
    // every parent task and filtering in JS.
    return db.query.tasks.findMany({
      where: and(
        ctx.orgId
          ? eq(tasks.organizationId, ctx.orgId)
          : eq(tasks.userId, userId),
        isNull(tasks.parentTaskId),
        sql`${tasks.deadline} IS NOT NULL`,
        gte(tasks.deadline, now),
        lte(tasks.deadline, in7Days),
        ne(tasks.status, "done"),
      ),
      with: {
        project: { columns: { id: true, name: true } },
        client: { columns: { id: true, name: true } },
      },
      orderBy: [asc(tasks.deadline)],
    });
  }),

  // Get overdue tasks
  getOverdue: moduleReadProcedure("tasks").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = new Date();

    // PERF: Push overdue filter into SQL.
    return db.query.tasks.findMany({
      where: and(
        ctx.orgId
          ? eq(tasks.organizationId, ctx.orgId)
          : eq(tasks.userId, userId),
        isNull(tasks.parentTaskId),
        sql`${tasks.deadline} IS NOT NULL`,
        lt(tasks.deadline, now),
        ne(tasks.status, "done"),
      ),
      with: {
        project: { columns: { id: true, name: true } },
        client: { columns: { id: true, name: true } },
      },
      orderBy: [asc(tasks.deadline)],
    });
  }),

  // Get today's focus (AI-prioritized tasks for the day)
  getTodaysFocus: moduleReadProcedure("tasks").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = new Date();
    // Slutningen af den danske dag uanset processens TZ (#649)
    const endOfDay = new Date(
      copenhagenDayEndExclusive(copenhagenToday(now)).getTime() - 1,
    );

    const allTasks = await db.query.tasks.findMany({
      where: and(
        ctx.orgId
          ? eq(tasks.organizationId, ctx.orgId)
          : eq(tasks.userId, userId),
        isNull(tasks.parentTaskId),
        ne(tasks.status, "done"),
      ),
      with: {
        project: {
          columns: {
            id: true,
            name: true,
          },
        },
        client: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
      limit: 50,
    });

    const scoredTasks = allTasks
      .map((t) => {
        let score = 0;

        // Priority scoring
        if (t.priority === "urgent") score += 100;
        else if (t.priority === "high") score += 50;
        else if (t.priority === "medium") score += 25;

        // Deadline scoring
        if (t.deadline) {
          const deadline = new Date(t.deadline);
          if (deadline <= endOfDay)
            score += 80; // Due today
          else if (deadline <= new Date(now.getTime() + 24 * 60 * 60 * 1000))
            score += 40; // Due tomorrow
          else if (deadline < now) score += 200; // Overdue!
        }

        // Status scoring - in_progress tasks get priority
        if (t.status === "in_progress") score += 30;
        else if (t.status === "todo") score += 10;

        return { ...t, _score: score };
      })
      .sort((a, b) => b._score - a._score)
      .slice(0, 5); // Top 5 tasks

    return scoredTasks;
  }),

  // Create subtask
  createSubtask: moduleWriteProcedure("tasks")
    .input(
      z.object({
        parentTaskId: z.string().uuid(),
        title: z.string().min(1).max(255),
        description: z.string().max(10000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify parent task ownership — også i den aktive org, ellers kopieres
      // en anden orgs projekt og kunde ind i denne org's underopgave.
      const parentTask = await db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, input.parentTaskId),
          eq(tasks.userId, userId),
          ctx.orgId ? eq(tasks.organizationId, ctx.orgId) : undefined,
        ),
      });

      if (!parentTask) {
        throw new Error(await tr("serverErrors", "tasks.mainTaskNotFound"));
      }

      // Get next position
      const maxPositionResult = await db
        .select({ maxPos: sql<number>`COALESCE(MAX(position), 0)` })
        .from(tasks)
        .where(eq(tasks.parentTaskId, input.parentTaskId));
      const position = (maxPositionResult[0]?.maxPos ?? 0) + 1;

      const [newSubtask] = await db
        .insert(tasks)
        .values({
          title: input.title,
          description: input.description,
          parentTaskId: input.parentTaskId,
          projectId: parentTask.projectId,
          clientId: parentTask.clientId,
          status: "backlog",
          priority: parentTask.priority,
          position,
          sourceType: "manual",
          userId,
          organizationId: ctx.orgId,
        })
        .returning();

      return newSubtask;
    }),

  // --- Task Attachments (image upload) ---

  addAttachment: moduleWriteProcedure("tasks")
    .input(
      z.object({
        taskId: z.string().uuid(),
        fileName: z.string(),
        contentType: z.string(),
        sizeBytes: z.number().int().nonnegative(),
        // Kun app-URL'en fra /api/upload/task-image. En fri streng ville
        // lade klienten pege på andre objekter (læsning via filruten,
        // sletning via deleteAttachment) eller omdirigere /api/attachments.
        storageUrl: z
          .string()
          .refine((url) => taskImageKeyFromUrl(url) !== null, {
            error: () => st("zod.invalidImageUrl"),
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, input.taskId),
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, ctx.session.user.id),
        ),
        columns: { id: true },
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });

      const [attachment] = await ctx.db
        .insert(taskAttachments)
        .values({
          taskId: input.taskId,
          userId: ctx.session.user.id,
          filename: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          storageUrl: input.storageUrl,
        })
        .returning();

      return attachment;
    }),

  deleteAttachment: moduleWriteProcedure("tasks")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const attachment = await ctx.db.query.taskAttachments.findFirst({
        where: and(
          eq(taskAttachments.id, input.id),
          eq(taskAttachments.userId, ctx.session.user.id),
        ),
      });
      if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });

      if (attachment.storageUrl) {
        try {
          await deleteTaskImageByUrl(
            attachment.storageUrl,
            ctx.session.user.id,
          );
        } catch (err) {
          console.error("[Tasks] Kunne ikke slette vedhæftet billede:", err);
        }
      }

      await ctx.db
        .delete(taskAttachments)
        .where(eq(taskAttachments.id, input.id));
      return { success: true };
    }),

  listAttachments: moduleReadProcedure("tasks")
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify task belongs to user/org
      const task = await ctx.db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, input.taskId),
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, ctx.session.user.id),
        ),
        columns: { id: true },
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.query.taskAttachments.findMany({
        where: eq(taskAttachments.taskId, input.taskId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
    }),
});
