import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import {
  clients,
  generatedTimeEntries,
  prepaidPackages,
  projects,
  recurringTemplateClients,
  recurringTimeTemplates,
  timeEntries,
} from "@/lib/db/schema";
import { copenhagenToday, entryDateFromStr } from "@/lib/time/copenhagen";
import { resolveDefaultBillable } from "@/lib/time/default-billable";
import { calculateNextDue } from "@/lib/time/recurring-next-due";
import {
  moduleReadProcedure,
  moduleWriteNoSubProcedure,
  protectedProcedure,
  router,
} from "../trpc";
import { getRateForTimeEntry } from "./time";

const recurringTemplateInput = z.object({
  name: z
    .string()
    .min(2, { error: () => st("zod.nameMin2") })
    .max(255),
  clientId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  description: z
    .string()
    .min(1, { error: () => st("zod.descriptionRequired") })
    .max(500),
  hours: z
    .string()
    .min(1, { error: () => st("zod.hoursRequired") })
    .max(20),
  isPrepaid: z.boolean().default(false),
  prepaidPackageId: z.string().uuid().optional(),
  templateType: z.enum(["time_entry", "task", "both"]).default("time_entry"),
  clientIds: z
    .array(
      z.object({
        clientId: z.string().uuid(),
        projectId: z.string().uuid().nullable().optional(),
      }),
    )
    .optional(),
  frequency: z.enum(["daily", "weekly", "monthly"]).optional().nullable(),
  dayOfWeek: z.number().min(0).max(6).optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  startDate: z.string().max(30).optional(),
  endDate: z.string().max(30).optional(),
  isActive: z.boolean().default(true),
});

const updateTemplateInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(255).optional(),
  clientId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  description: z.string().min(1).max(500).optional(),
  hours: z.string().max(20).optional(),
  isPrepaid: z.boolean().optional(),
  prepaidPackageId: z.string().uuid().optional().nullable(),
  frequency: z.enum(["daily", "weekly", "monthly"]).optional().nullable(),
  dayOfWeek: z.number().min(0).max(6).optional().nullable(),
  dayOfMonth: z.number().min(1).max(31).optional().nullable(),
  startDate: z.string().max(30).optional().nullable(),
  endDate: z.string().max(30).optional().nullable(),
  isActive: z.boolean().optional(),
  templateType: z.enum(["time_entry", "task", "both"]).optional(),
  clientIds: z
    .array(
      z.object({
        clientId: z.string().uuid(),
        projectId: z.string().uuid().nullable().optional(),
      }),
    )
    .optional(),
});

/**
 * Verificér at hver klient/projekt i en skabelons clientIds-liste tilhører
 * kalderens org/bruger. De skalare clientId/projectId-felter valideres allerede
 * i create/update, men listen blev indsat råt — og list() joiner
 * templateClients med fulde client- og project-rækker, så en fremmed id
 * kunne læses tilbage gennem ens egen skabelon.
 */
async function assertTemplateClientsOwned(
  db: typeof import("@/lib/db").db,
  userId: string,
  orgId: string | null,
  entries: { clientId: string; projectId?: string | null }[] | undefined,
): Promise<void> {
  if (!entries || entries.length === 0) return;

  // Én forespørgsel pr. entitet i stedet for to pr. række: en skabelon med 30
  // klienter gav 60 rundture. Ejerskabsfiltret er uændret — kun formen.
  const clientIds = [...new Set(entries.map((e) => e.clientId))];
  const projectIds = [
    ...new Set(
      entries
        .map((e) => e.projectId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const ownedClients = await db.query.clients.findMany({
    where: and(
      inArray(clients.id, clientIds),
      orgId ? eq(clients.organizationId, orgId) : eq(clients.userId, userId),
    ),
    columns: { id: true },
  });
  if (ownedClients.length !== clientIds.length) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "common.clientNotFound"),
    });
  }

  if (projectIds.length > 0) {
    const ownedProjects = await db.query.projects.findMany({
      where: and(
        inArray(projects.id, projectIds),
        orgId
          ? eq(projects.organizationId, orgId)
          : eq(projects.userId, userId),
      ),
      columns: { id: true },
    });
    if (ownedProjects.length !== projectIds.length) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "common.projectNotFound"),
      });
    }
  }
}

export const recurringRouter = router({
  // Get all templates for the current user
  list: moduleReadProcedure("templates").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const scopeFilter = eq(recurringTimeTemplates.userId, userId);

    const templates = await ctx.db.query.recurringTimeTemplates.findMany({
      where: scopeFilter,
      orderBy: [desc(recurringTimeTemplates.createdAt)],
      with: {
        client: true,
        project: {
          with: {
            client: true,
          },
        },
        prepaidPackage: true,
        templateClients: {
          with: {
            client: true,
            project: true,
          },
        },
      },
    });

    return templates;
  }),

  // Get templates by project
  getByProject: moduleReadProcedure("templates")
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const scopeFilter = eq(recurringTimeTemplates.userId, userId);
      const templates = await ctx.db.query.recurringTimeTemplates.findMany({
        where: and(
          scopeFilter,
          eq(recurringTimeTemplates.projectId, input.projectId),
        ),
        orderBy: [desc(recurringTimeTemplates.createdAt)],
      });

      return templates;
    }),

  // Get a single template by ID
  getById: moduleReadProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const scopeFilter = eq(recurringTimeTemplates.userId, userId);
      const template = await ctx.db.query.recurringTimeTemplates.findFirst({
        where: and(eq(recurringTimeTemplates.id, input.id), scopeFilter),
        with: {
          client: true,
          project: {
            with: {
              client: true,
            },
          },
          prepaidPackage: true,
          templateClients: true,
        },
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      return template;
    }),

  // Get pending templates (recurring templates that are due for generation)
  getPending: moduleReadProcedure("templates").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = new Date();
    const scopeFilter = eq(recurringTimeTemplates.userId, userId);

    const pending = await ctx.db.query.recurringTimeTemplates.findMany({
      where: and(
        scopeFilter,
        eq(recurringTimeTemplates.isActive, true),
        eq(recurringTimeTemplates.isPaused, false),
        isNotNull(recurringTimeTemplates.frequency),
        lte(recurringTimeTemplates.nextDue, now),
      ),
      with: {
        client: true,
        project: {
          with: {
            client: true,
          },
        },
      },
    });

    return pending;
  }),

  // List all active templates (for QuickTimeEntryModal)
  listActive: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const scopeFilter = eq(recurringTimeTemplates.userId, userId);

    const templates = await ctx.db.query.recurringTimeTemplates.findMany({
      where: and(scopeFilter, eq(recurringTimeTemplates.isActive, true)),
      orderBy: [desc(recurringTimeTemplates.createdAt)],
      with: {
        client: true,
        project: {
          with: {
            client: true,
          },
        },
      },
    });

    return templates;
  }),

  // Create a new template
  create: moduleWriteNoSubProcedure("templates")
    .input(recurringTemplateInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await assertTemplateClientsOwned(
        ctx.db,
        userId,
        ctx.orgId,
        input.clientIds,
      );

      let resolvedClientId = input.clientId || null;
      let billableRate: string | null = null;

      // Verify project belongs to user if provided
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
        });

        if (!project) {
          throw new Error(await tr("serverErrors", "common.projectNotFound"));
        }

        billableRate = project.hourlyRate;
        // Derive clientId from project if not explicitly set
        if (!resolvedClientId && project.clientId) {
          resolvedClientId = project.clientId;
        }
      }

      // Verify client belongs to user if provided
      if (resolvedClientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, resolvedClientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
        });

        if (!client) {
          throw new Error(await tr("serverErrors", "common.clientNotFound"));
        }
      }

      // Verify prepaidPackageId belongs to user if provided
      if (input.prepaidPackageId) {
        const pkg = await ctx.db.query.prepaidPackages.findFirst({
          where: and(
            eq(prepaidPackages.id, input.prepaidPackageId),
            ctx.orgId
              ? eq(prepaidPackages.organizationId, ctx.orgId)
              : eq(prepaidPackages.userId, userId),
          ),
          columns: { id: true },
        });
        if (!pkg) {
          throw new Error(await tr("serverErrors", "common.prepaidNotFound"));
        }
      }

      // Validate recurring fields
      if (input.frequency && !input.startDate) {
        throw new Error(
          await tr("serverErrors", "recurring.startDateRequired"),
        );
      }

      let nextDue: Date | null = null;
      let startDate: Date | null = null;

      if (input.frequency && input.startDate) {
        startDate = new Date(input.startDate);
        nextDue = calculateNextDue(
          input.frequency,
          startDate,
          input.dayOfWeek,
          input.dayOfMonth,
        );
      }

      const [template] = await ctx.db
        .insert(recurringTimeTemplates)
        .values({
          name: input.name,
          clientId: resolvedClientId,
          projectId: input.projectId || null,
          userId,
          organizationId: ctx.orgId,
          prepaidPackageId: input.prepaidPackageId || null,
          description: input.description,
          hours: input.hours,
          billableRate,
          isPrepaid: input.isPrepaid,
          templateType: input.templateType,
          frequency: input.frequency || null,
          dayOfWeek: input.dayOfWeek ?? null,
          dayOfMonth: input.dayOfMonth ?? null,
          startDate,
          endDate: input.endDate ? new Date(input.endDate) : null,
          isActive: input.isActive,
          nextDue,
        })
        .returning();

      if (input.clientIds && input.clientIds.length > 0) {
        await ctx.db.insert(recurringTemplateClients).values(
          input.clientIds.map((c) => ({
            templateId: template.id,
            clientId: c.clientId,
            projectId: c.projectId ?? null,
          })),
        );
      }

      return template;
    }),

  // Update a template
  update: moduleWriteNoSubProcedure("templates")
    .input(updateTemplateInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify template belongs to user
      const template = await ctx.db.query.recurringTimeTemplates.findFirst({
        where: and(
          eq(recurringTimeTemplates.id, input.id),
          eq(recurringTimeTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      await assertTemplateClientsOwned(
        ctx.db,
        userId,
        ctx.orgId,
        input.clientIds,
      );

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.name) updateData.name = input.name;
      if (input.templateType !== undefined)
        updateData.templateType = input.templateType;
      if (input.description) updateData.description = input.description;
      if (input.hours) updateData.hours = input.hours;
      if (input.isPrepaid !== undefined) updateData.isPrepaid = input.isPrepaid;
      if (input.prepaidPackageId !== undefined) {
        // Verify prepaid package belongs to user
        if (input.prepaidPackageId) {
          const pkg = await ctx.db.query.prepaidPackages.findFirst({
            where: and(
              eq(prepaidPackages.id, input.prepaidPackageId),
              ctx.orgId
                ? eq(prepaidPackages.organizationId, ctx.orgId)
                : eq(prepaidPackages.userId, userId),
            ),
            columns: { id: true },
          });
          if (!pkg) {
            throw new Error(await tr("serverErrors", "common.prepaidNotFound"));
          }
        }
        updateData.prepaidPackageId = input.prepaidPackageId;
      }
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      // Handle clientId — verify ownership before assigning (otherwise the
      // template could reference a cross-tenant client, leaked via joins).
      if (input.clientId !== undefined) {
        if (input.clientId) {
          const client = await ctx.db.query.clients.findFirst({
            where: and(
              eq(clients.id, input.clientId),
              ctx.orgId
                ? eq(clients.organizationId, ctx.orgId)
                : eq(clients.userId, userId),
            ),
            columns: { id: true },
          });
          if (!client) {
            throw new Error(await tr("serverErrors", "common.clientNotFound"));
          }
        }
        updateData.clientId = input.clientId;
      }

      // Handle projectId — also verify ownership
      if (input.projectId !== undefined) {
        if (input.projectId) {
          const project = await ctx.db.query.projects.findFirst({
            where: and(
              eq(projects.id, input.projectId),
              ctx.orgId
                ? eq(projects.organizationId, ctx.orgId)
                : eq(projects.userId, userId),
            ),
          });
          if (!project) {
            throw new Error(await tr("serverErrors", "common.projectNotFound"));
          }
          updateData.projectId = input.projectId;
          // Derive clientId from project if not explicitly set
          if (input.clientId === undefined && project.clientId) {
            updateData.clientId = project.clientId;
          }
        } else {
          updateData.projectId = null;
        }
      }

      // Handle frequency changes
      if (input.frequency !== undefined) {
        updateData.frequency = input.frequency;
        // If frequency is cleared, reset all recurrence fields
        if (input.frequency === null) {
          updateData.startDate = null;
          updateData.nextDue = null;
          updateData.dayOfWeek = null;
          updateData.dayOfMonth = null;
        }
      }

      if (input.dayOfWeek !== undefined) updateData.dayOfWeek = input.dayOfWeek;
      if (input.dayOfMonth !== undefined)
        updateData.dayOfMonth = input.dayOfMonth;
      if (input.startDate !== undefined)
        updateData.startDate = input.startDate
          ? new Date(input.startDate)
          : null;
      if (input.endDate !== undefined)
        updateData.endDate = input.endDate ? new Date(input.endDate) : null;

      // Recalculate nextDue if frequency is set and relevant fields changed
      const newFrequency =
        input.frequency !== undefined ? input.frequency : template.frequency;
      if (
        newFrequency &&
        (input.frequency !== undefined ||
          input.startDate !== undefined ||
          input.dayOfWeek !== undefined ||
          input.dayOfMonth !== undefined)
      ) {
        const startDate = input.startDate
          ? new Date(input.startDate)
          : template.startDate;
        if (startDate) {
          const dayOfWeek =
            input.dayOfWeek !== undefined
              ? input.dayOfWeek
              : template.dayOfWeek;
          const dayOfMonth =
            input.dayOfMonth !== undefined
              ? input.dayOfMonth
              : template.dayOfMonth;

          updateData.nextDue = calculateNextDue(
            newFrequency,
            startDate,
            dayOfWeek,
            dayOfMonth,
          );
        }
      }

      const [updatedTemplate] = await ctx.db
        .update(recurringTimeTemplates)
        .set(updateData)
        .where(eq(recurringTimeTemplates.id, input.id))
        .returning();

      if (input.clientIds !== undefined) {
        await ctx.db
          .delete(recurringTemplateClients)
          .where(eq(recurringTemplateClients.templateId, input.id));
        if (input.clientIds.length > 0) {
          await ctx.db.insert(recurringTemplateClients).values(
            input.clientIds.map((c) => ({
              templateId: input.id,
              clientId: c.clientId,
              projectId: c.projectId ?? null,
            })),
          );
        }
      }

      return updatedTemplate;
    }),

  // Delete a template
  delete: moduleWriteNoSubProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify template belongs to user
      const template = await ctx.db.query.recurringTimeTemplates.findFirst({
        where: and(
          eq(recurringTimeTemplates.id, input.id),
          eq(recurringTimeTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      await ctx.db
        .delete(recurringTimeTemplates)
        .where(eq(recurringTimeTemplates.id, input.id));

      return { success: true };
    }),

  // Duplicate a template (including multi-client assignments)
  duplicate: moduleWriteNoSubProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const scopeFilter = eq(recurringTimeTemplates.userId, userId);

      const original = await ctx.db.query.recurringTimeTemplates.findFirst({
        where: and(eq(recurringTimeTemplates.id, input.id), scopeFilter),
        with: {
          templateClients: true,
        },
      });

      if (!original) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      const [newTemplate] = await ctx.db
        .insert(recurringTimeTemplates)
        .values({
          name: `${original.name} (kopi)`,
          clientId: original.clientId,
          projectId: original.projectId,
          userId,
          organizationId: ctx.orgId,
          prepaidPackageId: original.prepaidPackageId,
          description: original.description,
          hours: original.hours,
          billableRate: original.billableRate,
          isPrepaid: original.isPrepaid,
          templateType: original.templateType,
          frequency: original.frequency,
          dayOfWeek: original.dayOfWeek,
          dayOfMonth: original.dayOfMonth,
          startDate: original.startDate,
          endDate: original.endDate,
          isActive: false,
        })
        .returning();

      if (original.templateClients && original.templateClients.length > 0) {
        await ctx.db.insert(recurringTemplateClients).values(
          original.templateClients.map((tc) => ({
            templateId: newTemplate.id,
            clientId: tc.clientId,
            projectId: tc.projectId,
          })),
        );
      }

      return newTemplate;
    }),

  // Generate time entry from template
  generate: protectedProcedure
    .input(
      z.object({ templateId: z.string().uuid(), date: z.string().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get template
      const template = await ctx.db.query.recurringTimeTemplates.findFirst({
        where: and(
          eq(recurringTimeTemplates.id, input.templateId),
          eq(recurringTimeTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      // Uden dato: dagens danske dato (UTC-midnat-konventionen), #649
      const entryDate = input.date
        ? new Date(input.date)
        : entryDateFromStr(copenhagenToday());

      // Determine clientId: template.clientId, or derive from project
      let clientId = template.clientId;
      if (!clientId && template.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: eq(projects.id, template.projectId),
        });
        clientId = project?.clientId || null;
      }

      // Calculate current billable rate using rate hierarchy
      const currentRate = await getRateForTimeEntry(
        ctx.db,
        userId,
        template.projectId,
        clientId,
        ctx.orgId,
        input.date ?? entryDate,
      );

      const timeEntry = await ctx.db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(timeEntries)
          .values({
            projectId: template.projectId,
            userId,
            organizationId: ctx.orgId,
            clientId,
            prepaidPackageId: template.prepaidPackageId,
            recurringTemplateId: template.id,
            description: template.description,
            hours: template.hours,
            date: entryDate,
            billableRate: currentRate,
            isBillable: await resolveDefaultBillable(tx, {
              projectId: template.projectId,
              clientId,
            }),
            isBilled: false,
            isPrepaid: template.isPrepaid,
            isFromTemplate: true,
            source: "recurring",
          })
          .returning();

        await tx.insert(generatedTimeEntries).values({
          recurringTemplateId: template.id,
          timeEntryId: entry.id,
          scheduledDate: entryDate,
          isCompleted: true,
        });

        if (template.frequency) {
          const nextDue = calculateNextDue(
            template.frequency,
            entryDate,
            template.dayOfWeek,
            template.dayOfMonth,
          );

          await tx
            .update(recurringTimeTemplates)
            .set({ lastGenerated: new Date(), nextDue })
            .where(eq(recurringTimeTemplates.id, template.id));
        } else {
          await tx
            .update(recurringTimeTemplates)
            .set({ lastGenerated: new Date() })
            .where(eq(recurringTimeTemplates.id, template.id));
        }

        return entry;
      });

      return timeEntry;
    }),

  // Toggle active status
  toggleActive: moduleWriteNoSubProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const template = await ctx.db.query.recurringTimeTemplates.findFirst({
        where: and(
          eq(recurringTimeTemplates.id, input.id),
          eq(recurringTimeTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      const [updated] = await ctx.db
        .update(recurringTimeTemplates)
        .set({ isActive: !template.isActive })
        .where(eq(recurringTimeTemplates.id, input.id))
        .returning();

      return updated;
    }),

  // Pause a template temporarily (only for recurring)
  pause: moduleWriteNoSubProcedure("templates")
    .input(
      z.object({
        id: z.string().uuid(),
        pausedUntil: z.string().optional(),
        reason: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const template = await ctx.db.query.recurringTimeTemplates.findFirst({
        where: and(
          eq(recurringTimeTemplates.id, input.id),
          eq(recurringTimeTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      if (!template.frequency) {
        throw new Error(await tr("serverErrors", "recurring.cannotPause"));
      }

      const [updated] = await ctx.db
        .update(recurringTimeTemplates)
        .set({
          isPaused: true,
          pausedUntil: input.pausedUntil ? new Date(input.pausedUntil) : null,
          pauseReason: input.reason || null,
          updatedAt: new Date(),
        })
        .where(eq(recurringTimeTemplates.id, input.id))
        .returning();

      return updated;
    }),

  // Resume a paused template (only for recurring)
  resume: moduleWriteNoSubProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const template = await ctx.db.query.recurringTimeTemplates.findFirst({
        where: and(
          eq(recurringTimeTemplates.id, input.id),
          eq(recurringTimeTemplates.userId, userId),
        ),
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      if (!template.frequency) {
        throw new Error(await tr("serverErrors", "recurring.cannotResume"));
      }

      // Recalculate next due date from today
      const nextDue = calculateNextDue(
        template.frequency,
        new Date(),
        template.dayOfWeek,
        template.dayOfMonth,
      );

      const [updated] = await ctx.db
        .update(recurringTimeTemplates)
        .set({
          isPaused: false,
          pausedUntil: null,
          pauseReason: null,
          nextDue,
          updatedAt: new Date(),
        })
        .where(eq(recurringTimeTemplates.id, input.id))
        .returning();

      return updated;
    }),
});
