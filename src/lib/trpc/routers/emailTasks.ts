import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
} from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { updateClassificationCache } from "@/lib/ai/email-classifier";
import {
  clients,
  emailFilterRules,
  emailThreads,
  taskAttachments,
  tasks,
} from "@/lib/db/schema";
import { Errors } from "../errors";
import { protectedProcedure, router } from "../trpc";

export const emailTasksRouter = router({
  getRecentEmailTasks: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(5) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.tasks.findMany({
        where: and(
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, ctx.session.user.id),
          eq(tasks.sourceType, "email"),
        ),
        orderBy: desc(tasks.createdAt),
        limit: input.limit,
        with: {
          client: true,
          project: true,
        },
      });
    }),
  getThreadForTask: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.emailThreads.findMany({
        where: and(
          eq(emailThreads.taskId, input.taskId),
          eq(emailThreads.userId, ctx.session.user.id),
        ),
        orderBy: asc(emailThreads.receivedDate),
      });
    }),

  getTasksNeedingReview: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.query.tasks.findMany({
        where: and(
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, ctx.session.user.id),
          eq(tasks.sourceType, "email"),
          or(lt(tasks.aiConfidence, "0.70"), isNull(tasks.clientId)),
        ),
        orderBy: desc(tasks.createdAt),
        limit: input.limit,
      });
    }),

  getAttachments: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.taskAttachments.findMany({
        where: and(
          eq(taskAttachments.taskId, input.taskId),
          eq(taskAttachments.userId, ctx.session.user.id),
        ),
        columns: {
          id: true,
          filename: true,
          contentType: true,
          sizeBytes: true,
          createdAt: true,
        },
      });
    }),

  updateCustomerMatch: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        clientId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Kunden skrives på opgaven og tråden, så den skal tilhøre kalderens
      // org/bruger (ellers kan en fremmed kunde læses via opgavens relation).
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, ctx.session.user.id),
        ),
        columns: { id: true },
      });
      if (!client) throw Errors.clientNotFound();

      await ctx.db
        .update(tasks)
        .set({
          clientId: input.clientId,
          aiSuggestedClient: input.clientId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, input.taskId),
            ctx.orgId
              ? eq(tasks.organizationId, ctx.orgId)
              : eq(tasks.userId, ctx.session.user.id),
          ),
        );

      await ctx.db
        .update(emailThreads)
        .set({
          matchedClientId: input.clientId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(emailThreads.taskId, input.taskId),
            eq(emailThreads.userId, ctx.session.user.id),
          ),
        );

      return { success: true };
    }),

  markRelevanceFeedback: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        feedback: z.enum(["relevant", "irrelevant"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(tasks)
        .set({
          emailRelevanceFeedback: input.feedback,
          feedbackProvidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, input.taskId),
            ctx.orgId
              ? eq(tasks.organizationId, ctx.orgId)
              : eq(tasks.userId, ctx.session.user.id),
          ),
        );

      // Propagate feedback to classification cache
      if (input.feedback === "irrelevant") {
        const thread = await ctx.db.query.emailThreads.findFirst({
          where: and(
            eq(emailThreads.taskId, input.taskId),
            eq(emailThreads.userId, ctx.session.user.id),
          ),
          columns: { fromEmail: true },
        });

        if (thread?.fromEmail) {
          const domain = thread.fromEmail.split("@")[1];
          if (domain) {
            await updateClassificationCache(
              ctx.session.user.id,
              domain,
              false,
              0.9,
            );
          }

          // Flag similar recent backlog tasks from same sender (7-day window)
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const similarTasks = await ctx.db.query.emailThreads.findMany({
            where: and(
              eq(emailThreads.userId, ctx.session.user.id),
              eq(emailThreads.fromEmail, thread.fromEmail),
              ne(emailThreads.taskId, input.taskId),
              gte(emailThreads.receivedDate, sevenDaysAgo),
            ),
            columns: { taskId: true },
          });

          const taskIds = similarTasks
            .map((t) => t.taskId)
            .filter((id): id is string => id !== null);

          if (taskIds.length > 0) {
            await ctx.db
              .update(tasks)
              .set({
                emailRelevanceFeedback: "irrelevant",
                feedbackProvidedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  inArray(tasks.id, taskIds),
                  eq(tasks.userId, ctx.session.user.id),
                  eq(tasks.status, "backlog"),
                  eq(tasks.sourceType, "email"),
                ),
              );
          }
        }
      }

      return { success: true };
    }),

  // ---- Email Filter Rules (Learning) ----

  markAsNotRelevant: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        filterActions: z.array(
          z.object({
            ruleType: z.enum([
              "sender_email",
              "sender_domain",
              "subject_contains",
            ]),
            pattern: z.string().min(1).max(255),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the task belongs to the user and is from email
      const task = await ctx.db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, input.taskId),
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, ctx.session.user.id),
          eq(tasks.sourceType, "email"),
        ),
        columns: { id: true, sourceId: true, title: true },
      });

      if (!task) {
        return {
          success: false,
          error: await tr("serverErrors", "emailTasks.taskNotFound"),
        };
      }

      // Get the email thread for source info
      const thread = await ctx.db.query.emailThreads.findFirst({
        where: and(
          eq(emailThreads.taskId, input.taskId),
          eq(emailThreads.userId, ctx.session.user.id),
        ),
        columns: { fromEmail: true, subject: true },
      });

      // Create filter rules
      let rulesCreated = 0;
      for (const action of input.filterActions) {
        await ctx.db
          .insert(emailFilterRules)
          .values({
            userId: ctx.session.user.id,
            ruleType: action.ruleType,
            pattern: action.pattern.toLowerCase(),
            sourceTaskId: input.taskId,
            sourceEmailSubject: thread?.subject || task.title,
            sourceEmailFrom: thread?.fromEmail || null,
          })
          .onConflictDoNothing();
        rulesCreated++;
      }

      // Mark task as done and flag it
      await ctx.db
        .update(tasks)
        .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, input.taskId));

      return { success: true, rulesCreated };
    }),

  getFilterRules: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.emailFilterRules.findMany({
      where: eq(emailFilterRules.userId, ctx.session.user.id),
      orderBy: desc(emailFilterRules.createdAt),
    });
  }),

  deleteFilterRule: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(emailFilterRules)
        .where(
          and(
            eq(emailFilterRules.id, input.ruleId),
            eq(emailFilterRules.userId, ctx.session.user.id),
          ),
        );
      return { success: true };
    }),

  toggleFilterRule: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(emailFilterRules)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(
          and(
            eq(emailFilterRules.id, input.ruleId),
            eq(emailFilterRules.userId, ctx.session.user.id),
          ),
        );
      return { success: true };
    }),

  addManualRule: protectedProcedure
    .input(
      z.object({
        ruleType: z.enum(["sender_email", "sender_domain", "subject_contains"]),
        pattern: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(emailFilterRules)
        .values({
          userId: ctx.session.user.id,
          ruleType: input.ruleType,
          pattern: input.pattern.toLowerCase(),
        })
        .onConflictDoNothing();
      return { success: true };
    }),

  // Suggest filter rules based on a task (for the UI)
  suggestFilters: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const thread = await ctx.db.query.emailThreads.findFirst({
        where: and(
          eq(emailThreads.taskId, input.taskId),
          eq(emailThreads.userId, ctx.session.user.id),
        ),
        columns: { fromEmail: true, subject: true },
      });

      if (!thread) return [];

      const suggestions: {
        ruleType: "sender_email" | "sender_domain" | "subject_contains";
        pattern: string;
        label: string;
      }[] = [];

      // Suggest blocking sender email
      if (thread.fromEmail) {
        suggestions.push({
          ruleType: "sender_email",
          pattern: thread.fromEmail.toLowerCase(),
          label: `Bloker alle emails fra ${thread.fromEmail}`,
        });

        // Suggest blocking sender domain
        const domain = thread.fromEmail.split("@")[1];
        if (
          domain &&
          ![
            "gmail.com",
            "hotmail.com",
            "outlook.com",
            "yahoo.com",
            "icloud.com",
          ].includes(domain)
        ) {
          suggestions.push({
            ruleType: "sender_domain",
            pattern: domain.toLowerCase(),
            label: `Bloker alle emails fra @${domain}`,
          });
        }
      }

      // Suggest subject-based filter if there's a recognizable pattern
      if (thread.subject) {
        // Extract bracketed prefix like [Wordfence Alert] or [SiteName]
        const bracketMatch = thread.subject.match(/^\[([^\]]+)\]/);
        if (bracketMatch) {
          suggestions.push({
            ruleType: "subject_contains",
            pattern: `[${bracketMatch[1]}]`.toLowerCase(),
            label: await tr("serverErrors", "emailTasks.blockBracket", {
              tag: bracketMatch[1],
            }),
          });
        }

        // Extract "Alert" or "Monitoring" type subjects
        const alertMatch = thread.subject.match(
          /(alert|monitoring|digest|rapport|report|update[sd]?)\b/i,
        );
        if (alertMatch) {
          const keyword = alertMatch[1].toLowerCase();
          suggestions.push({
            ruleType: "subject_contains",
            pattern: keyword,
            label: await tr("serverErrors", "emailTasks.blockKeyword", {
              keyword,
            }),
          });
        }
      }

      return suggestions;
    }),
});
