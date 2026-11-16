import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import {
  type Client as AIClient,
  type Project as AIProject,
  aiPrioritization,
  categorizeTask,
  estimateTaskTime,
  isAIEnabled,
  isAIEnabledForUser,
  parseEmailToTask,
  parseTextToTask,
  scorePrioritization,
} from "@/lib/ai";
import { parseTimeEntryWithAI } from "@/lib/ai/time-entry-parser";
import { db } from "@/lib/db";
import { aiProcessingLogs, clients, projects, tasks } from "@/lib/db/schema";
import { notCancelledTask } from "@/lib/kanban/lanes-server";
import { parseFreetextEntry } from "@/lib/time/freetext-parser";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";
import { protectedProcedure, router } from "../trpc";
import { getAccessibleClientIds } from "./clientAccess";

export const aiRouter = router({
  // Check if AI is enabled
  isEnabled: protectedProcedure.query(() => {
    return { enabled: isAIEnabled() };
  }),

  // "Skriv hvad du lavede" (#681): AI-fallback kun med brugerens egen nøgle.
  // Den fælles server-nøgle (isAIEnabled) bruges bevidst ikke her.
  timeEntryFallbackStatus: protectedProcedure.query(async ({ ctx }) => {
    return { enabled: await isAIEnabledForUser(ctx.session.user.id) };
  }),

  parseTimeEntry: protectedProcedure
    .input(
      z.object({
        text: z.string().trim().min(1).max(500),
        today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      await rateLimiter.checkOrThrow(
        userRateLimitKey(userId, "ai.parseTimeEntry"),
        "ai",
      );

      if (!(await isAIEnabledForUser(userId))) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: await tr("serverErrors", "ai.noOwnKey"),
        });
      }

      // Samme scoping som clients.list/projects.list: org (eller bruger) +
      // medlemmets klientadgang, kun aktive klienter og projekter.
      const accessibleIds = ctx.orgId
        ? await getAccessibleClientIds(ctx.db, userId, ctx.orgId)
        : null;
      const clientRows =
        accessibleIds !== null && accessibleIds.length === 0
          ? []
          : await ctx.db.query.clients.findMany({
              where: and(
                ctx.orgId
                  ? eq(clients.organizationId, ctx.orgId)
                  : eq(clients.userId, userId),
                eq(clients.isArchived, false),
                accessibleIds !== null
                  ? inArray(clients.id, accessibleIds)
                  : undefined,
              ),
              columns: { id: true, name: true, company: true },
              // Samme sortering og loft som clients.list, så serverens
              // deterministiske gentjek ser samme navne som UI'et.
              orderBy: [asc(sql`lower(${clients.name})`)],
              limit: 500,
            });
      const projectRows = await ctx.db.query.projects.findMany({
        where: and(
          ctx.orgId
            ? eq(projects.organizationId, ctx.orgId)
            : eq(projects.userId, userId),
          or(
            isNull(projects.status),
            notInArray(projects.status, ["archived", "completed"]),
          ),
        ),
        columns: { id: true, name: true, clientId: true },
        orderBy: [asc(sql`lower(${projects.name})`)],
        limit: 500,
      });
      const visibleProjects =
        accessibleIds === null
          ? projectRows
          : projectRows.filter(
              (p) => p.clientId === null || accessibleIds.includes(p.clientId),
            );

      // Fallback kun når den deterministiske parser ikke slog til
      const deterministic = parseFreetextEntry(input.text, {
        today: input.today,
        clients: clientRows,
        projects: visibleProjects,
      });
      if (deterministic.missing.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "ai.fillableWithoutAi"),
        });
      }

      const startTime = Date.now();
      try {
        const { suggestion, model } = await parseTimeEntryWithAI({
          userId,
          text: input.text,
          today: input.today,
          clients: clientRows,
          projects: visibleProjects,
        });

        await db.insert(aiProcessingLogs).values({
          userId,
          sourceType: "time_entry",
          operation: "parse_time_entry",
          model,
          inputData: {
            textLength: input.text.length,
            missing: deterministic.missing,
          },
          outputData: suggestion,
          status: "success",
          processingTimeMs: Date.now() - startTime,
        });

        return { suggestion, model };
      } catch (error) {
        await db.insert(aiProcessingLogs).values({
          userId,
          sourceType: "time_entry",
          operation: "parse_time_entry",
          model: "byok",
          inputData: { textLength: input.text.length },
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
          processingTimeMs: Date.now() - startTime,
        });
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: await tr("serverErrors", "ai.providerFailed"),
        });
      }
    }),

  // Parse natural language text into task data
  parseText: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1).max(5000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Rate limiting
      const rateLimitKey = userRateLimitKey(
        ctx.session.user.id,
        "ai.parseText",
      );
      await rateLimiter.checkOrThrow(rateLimitKey, "ai");

      const startTime = Date.now();

      try {
        const result = await parseTextToTask(input.text, ctx.session.user.id);

        // Log AI processing
        await db.insert(aiProcessingLogs).values({
          userId: ctx.session.user.id,
          sourceType: "task",
          operation: "parse_text",
          model: "gpt-4o-mini",
          inputData: { text: input.text.slice(0, 500) },
          outputData: result,
          confidence: String(result.confidence),
          status: "success",
          processingTimeMs: Date.now() - startTime,
        });

        return result;
      } catch (error) {
        // Log error
        await db.insert(aiProcessingLogs).values({
          userId: ctx.session.user.id,
          sourceType: "task",
          operation: "parse_text",
          model: "gpt-4o-mini",
          inputData: { text: input.text.slice(0, 500) },
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
          processingTimeMs: Date.now() - startTime,
        });

        throw error;
      }
    }),

  // Parse email into task data
  parseEmail: protectedProcedure
    .input(
      z.object({
        subject: z.string(),
        body: z.string(),
        from: z.string(),
        receivedAt: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Rate limiting
      const rateLimitKey = userRateLimitKey(
        ctx.session.user.id,
        "ai.parseEmail",
      );
      await rateLimiter.checkOrThrow(rateLimitKey, "ai");

      const startTime = Date.now();

      try {
        const result = await parseEmailToTask(input);

        // Log AI processing
        await db.insert(aiProcessingLogs).values({
          userId: ctx.session.user.id,
          sourceType: "email",
          operation: "parse_email",
          model: "gpt-4o-mini",
          inputData: {
            subject: input.subject,
            from: input.from,
            bodyLength: input.body.length,
          },
          outputData: result,
          confidence: String(result.confidence),
          status: "success",
          processingTimeMs: Date.now() - startTime,
        });

        return result;
      } catch (error) {
        await db.insert(aiProcessingLogs).values({
          userId: ctx.session.user.id,
          sourceType: "email",
          operation: "parse_email",
          model: "gpt-4o-mini",
          inputData: { subject: input.subject, from: input.from },
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
          processingTimeMs: Date.now() - startTime,
        });

        throw error;
      }
    }),

  // Categorize task (suggest project/client)
  categorize: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional().nullable(),
        sender: z.string().optional().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Rate limiting
      const rateLimitKey = userRateLimitKey(
        ctx.session.user.id,
        "ai.categorize",
      );
      await rateLimiter.checkOrThrow(rateLimitKey, "ai");

      const startTime = Date.now();

      // Get user's projects and clients
      const userProjects = await db.query.projects.findMany({
        where: eq(projects.userId, ctx.session.user.id),
        with: {
          client: true,
        },
      });

      const userClients = await db.query.clients.findMany({
        where: and(
          eq(clients.userId, ctx.session.user.id),
          eq(clients.isArchived, false),
        ),
      });

      // Format for AI
      const aiProjects: AIProject[] = userProjects.map((p) => {
        const client = Array.isArray(p.client) ? p.client[0] : p.client;
        return {
          id: p.id,
          name: p.name,
          clientId: p.clientId,
          clientName: client?.name,
          description: p.description,
        };
      });

      const aiClients: AIClient[] = userClients.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        domain: c.email ? c.email.split("@")[1] : null,
      }));

      try {
        const result = await categorizeTask(input, aiProjects, aiClients);

        // Log AI processing
        await db.insert(aiProcessingLogs).values({
          userId: ctx.session.user.id,
          sourceType: "task",
          operation: "categorize",
          model: "gpt-4o-mini",
          inputData: { title: input.title },
          outputData: result,
          confidence: String(
            Math.max(result.projectConfidence, result.clientConfidence),
          ),
          status: "success",
          processingTimeMs: Date.now() - startTime,
        });

        return result;
      } catch (error) {
        await db.insert(aiProcessingLogs).values({
          userId: ctx.session.user.id,
          sourceType: "task",
          operation: "categorize",
          model: "gpt-4o-mini",
          inputData: { title: input.title },
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
          processingTimeMs: Date.now() - startTime,
        });

        throw error;
      }
    }),

  // Get prioritization suggestions
  prioritize: protectedProcedure
    .input(
      z.object({
        period: z.enum(["day", "week"]).default("day"),
        availableHours: z.number().min(1).max(24).default(8),
        useAI: z.boolean().default(true),
      }),
    )
    .query(async ({ input, ctx }) => {
      // Rate limiting - more restrictive for expensive prioritization
      const rateLimitKey = userRateLimitKey(
        ctx.session.user.id,
        "ai.prioritize",
      );
      await rateLimiter.checkOrThrow(rateLimitKey, "aiPrioritize");

      const startTime = Date.now();

      // Get user's active tasks
      const userTasks = await db.query.tasks.findMany({
        where: and(
          eq(tasks.userId, ctx.session.user.id),
          ne(tasks.status, "done"),
        ),
        with: {
          project: true,
        },
        orderBy: (tasks, { desc }) => [desc(tasks.createdAt)],
      });

      // Format for prioritization
      const tasksForPrioritization = userTasks.map((t) => {
        const project = Array.isArray(t.project) ? t.project[0] : t.project;
        return {
          id: t.id,
          title: t.title,
          description: t.description,
          priority: t.priority as "low" | "medium" | "high" | "urgent",
          deadline: t.deadline,
          estimatedMinutes: t.estimatedMinutes,
          projectName: project?.name,
          status: t.status,
        };
      });

      try {
        const result =
          input.useAI && isAIEnabled()
            ? await aiPrioritization(
                tasksForPrioritization,
                input.availableHours,
                input.period,
              )
            : scorePrioritization(
                tasksForPrioritization,
                input.availableHours * 60,
              );

        // Log AI processing if AI was used
        if (input.useAI && isAIEnabled()) {
          await db.insert(aiProcessingLogs).values({
            userId: ctx.session.user.id,
            sourceType: "task",
            operation: "prioritize",
            model: "gpt-4o-mini",
            inputData: { taskCount: userTasks.length, period: input.period },
            outputData: {
              focusCount: result.focusTasks.length,
              warningCount: result.warnings.length,
            },
            status: "success",
            processingTimeMs: Date.now() - startTime,
          });
        }

        return result;
      } catch (_error) {
        // Fallback to score-based prioritization
        return scorePrioritization(
          tasksForPrioritization,
          input.availableHours * 60,
        );
      }
    }),

  // Estimate time for a task
  estimateTime: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional().nullable(),
        projectId: z.string().uuid().optional().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Rate limiting
      const rateLimitKey = userRateLimitKey(
        ctx.session.user.id,
        "ai.estimateTime",
      );
      await rateLimiter.checkOrThrow(rateLimitKey, "ai");

      const startTime = Date.now();

      // Get project type if available
      let projectType: string | null = null;
      if (input.projectId) {
        const project = await db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            eq(projects.userId, ctx.session.user.id),
          ),
        });
        projectType = project?.name || null;
      }

      // Get historical average for similar tasks
      const similarTasks = await db.query.tasks.findMany({
        where: and(
          eq(tasks.userId, ctx.session.user.id),
          eq(tasks.status, "done"),
          notCancelledTask(),
        ),
        orderBy: (tasks, { desc }) => [desc(tasks.completedAt)],
        limit: 50,
      });

      // Calculate average actual time
      const tasksWithActual = similarTasks.filter(
        (t) => t.actualMinutes && t.actualMinutes > 0,
      );
      const historicalAverage =
        tasksWithActual.length > 0
          ? Math.round(
              tasksWithActual.reduce(
                (sum, t) => sum + (t.actualMinutes || 0),
                0,
              ) / tasksWithActual.length,
            )
          : null;

      try {
        const result = await estimateTaskTime({
          title: input.title,
          description: input.description,
          projectType,
          historicalAverage,
        });

        // Log AI processing
        await db.insert(aiProcessingLogs).values({
          userId: ctx.session.user.id,
          sourceType: "task",
          operation: "estimate_time",
          model: "gpt-4o-mini",
          inputData: { title: input.title },
          outputData: result,
          confidence: String(result.confidence),
          status: "success",
          processingTimeMs: Date.now() - startTime,
        });

        return result;
      } catch (error) {
        await db.insert(aiProcessingLogs).values({
          userId: ctx.session.user.id,
          sourceType: "task",
          operation: "estimate_time",
          model: "gpt-4o-mini",
          inputData: { title: input.title },
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
          processingTimeMs: Date.now() - startTime,
        });

        throw error;
      }
    }),

  // Get AI processing stats for user
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const logs = await db.query.aiProcessingLogs.findMany({
      where: eq(aiProcessingLogs.userId, ctx.session.user.id),
      orderBy: (logs, { desc }) => [desc(logs.createdAt)],
      limit: 100,
    });

    const totalCalls = logs.length;
    const successfulCalls = logs.filter((l) => l.status === "success").length;
    const logsWithConfidence = logs.filter((l) => l.confidence);
    const averageConfidence =
      logsWithConfidence.length > 0
        ? logsWithConfidence.reduce(
            (sum, l) => sum + parseFloat(l.confidence || "0"),
            0,
          ) / logsWithConfidence.length
        : 0;
    const averageProcessingTime =
      logs.length > 0
        ? logs.reduce((sum, l) => sum + (l.processingTimeMs || 0), 0) /
          logs.length
        : 0;

    // Group by operation
    const operationBreakdown = logs.reduce(
      (acc, log) => {
        acc[log.operation] = (acc[log.operation] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalCalls,
      successfulCalls,
      successRate: totalCalls > 0 ? successfulCalls / totalCalls : 0,
      averageConfidence,
      averageProcessingTime: Math.round(averageProcessingTime),
      operationBreakdown,
      aiEnabled: isAIEnabled(),
    };
  }),
});
