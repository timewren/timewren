import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import {
  clients,
  emailPreferences,
  projects,
  projectTags,
  rateHistory,
  recurringTimeTemplates,
  tags,
  taskStatuses,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { recordDeletionTombstones } from "@/lib/desktop-sync-tombstones";
import { sendFirstProjectEmail } from "@/lib/email/engagement";
import { PROJECT_DEFAULT_LANES } from "@/lib/kanban/default-lanes";
import {
  PERIOD_KEYS,
  type PeriodKey,
  periodEndUtc,
  periodStartUtc,
  previousPeriodRangeUtc,
} from "@/lib/periods";
import {
  monthBoundsCopenhagen,
  monthBoundsCopenhagenOffset,
  monthKeyCopenhagen,
  monthlyBudgetStatus,
} from "@/lib/projects/budget";
import {
  loadMonthlyUsage,
  monthlyUsageScope,
} from "@/lib/projects/monthly-usage";
import { loadRemainingPlannedHours } from "@/lib/resource-plan/load";
import { emitWebhookEvent } from "@/lib/webhooks/events";
import { Errors } from "../errors";
import {
  moduleReadProcedure,
  moduleWriteProcedure,
  protectedProcedure,
  router,
  subscribedProcedure,
} from "../trpc";
import { assertClientAccess, getAccessibleClientIds } from "./clientAccess";

const projectInput = z
  .object({
    name: z
      .string()
      .min(2, { error: () => st("zod.nameMin2") })
      .max(255),
    description: z.string().max(5000).optional(),
    // null/udeladt = internt projekt uden kunde (enterprise, #467)
    clientId: z
      .string()
      .uuid({ error: () => st("zod.selectClient") })
      .nullable()
      .optional(),
    hourlyRate: z.string().max(20).optional(),
    fixedPrice: z.string().max(20).optional(),
    // Timebudget pr. kalendermåned (nulstilles automatisk pr. påbegyndt måned)
    monthlyBudgetHours: z.string().max(20).optional(),
    // Samlet timebudget for projektet (valgfrit)
    budgetHours: z.string().max(20).optional(),
    status: z.enum(["active", "completed", "on_hold", "archived"]).optional(),
    startDate: z.string().max(30).optional(),
    endDate: z.string().max(30).optional(),
    // URL patterns for browser extension auto-detection
    urlPatterns: z.array(z.string().max(2000)).max(20).optional(),
    roundingEnabled: z.boolean().nullable().optional(),
    roundingMinutes: z
      .union([
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(30),
        z.literal(60),
      ])
      .nullable()
      .optional(),
    roundingMethod: z.enum(["up", "nearest", "down"]).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.roundingEnabled === true &&
      (data.roundingMinutes == null || data.roundingMethod == null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: st("clients.roundingRequired"),
        path: ["roundingEnabled"],
      });
    }
  });

/**
 * Permanent sletning nulstiller tidsposternes projekt. Fakturerede poster er
 * låst (#702), så et projekt med fakturerede timer kan kun arkiveres.
 */
async function assertNoBilledProjectEntries(
  db: typeof import("@/lib/db").db,
  projectIds: string[],
) {
  if (projectIds.length === 0) return;
  const [billed] = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(
        inArray(timeEntries.projectId, projectIds),
        or(eq(timeEntries.isBilled, true), isNotNull(timeEntries.invoiceId)),
      ),
    )
    .limit(1);
  if (billed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "projects.hasBilledEntries"),
    });
  }
}

export const projectsRouter = router({
  // Get all projects for the current user
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const scopeFilter = ctx.orgId
      ? eq(projects.organizationId, ctx.orgId)
      : eq(projects.userId, userId);

    const allProjects = await ctx.db.query.projects.findMany({
      where: scopeFilter,
      orderBy: [asc(sql`lower(${projects.name})`)],
      with: {
        client: true,
      },
    });

    // Respect per-member client access: a restricted member only sees projects
    // for clients they can access (mirrors clients/prepaid/time list scoping).
    const accessibleIds = ctx.orgId
      ? await getAccessibleClientIds(ctx.db, ctx.session.user.id, ctx.orgId)
      : null;
    const visibleProjects =
      accessibleIds === null
        ? allProjects
        : allProjects.filter(
            (p) => p.clientId === null || accessibleIds.includes(p.clientId),
          );

    return visibleProjects.sort((a, b) => a.name.localeCompare(b.name, "da"));
  }),

  // Get all projects with their stats (hours, revenue, progress)
  listWithStats: moduleReadProcedure("projects")
    .input(
      z
        .object({
          /** Periode for kolonnen "timer i perioden" (default: indeværende måned) */
          period: z.enum(PERIOD_KEYS).default("month"),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const period: PeriodKey = input?.period ?? "month";
      // UTC-grænser: time_entries.date har UTC-semantik (som månedsbudgettet
      // nedenfor), og prod-containeren kører uden TZ sat.
      const periodFrom = periodStartUtc(period);
      const periodTo = periodEndUtc(period);
      const prevRange = previousPeriodRangeUtc(period);
      // postgres.js rejects raw Date objects in sql`` template params.
      // Drizzle comparison helpers encode Dates, but FILTER needs raw SQL here.
      const periodFromSql = periodFrom?.toISOString() ?? null;
      const periodToSql = periodTo?.toISOString() ?? null;
      const prevFromSql = prevRange?.from.toISOString() ?? null;
      const prevToSql = prevRange?.to.toISOString() ?? null;
      const scopeFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);

      const allProjectsRaw = await ctx.db.query.projects.findMany({
        where: scopeFilter,
        orderBy: [asc(sql`lower(${projects.name})`)],
        with: {
          client: true,
        },
      });
      // Respect per-member client access (see list).
      const accessibleIds = ctx.orgId
        ? await getAccessibleClientIds(ctx.db, ctx.session.user.id, ctx.orgId)
        : null;
      const allProjects =
        accessibleIds === null
          ? allProjectsRaw
          : allProjectsRaw.filter(
              (p) => p.clientId === null || accessibleIds.includes(p.clientId),
            );
      allProjects.sort((a, b) => a.name.localeCompare(b.name, "da"));

      // PERF: Aggregate stats per project in SQL instead of loading every time
      // entry for this user. Previously pulled entire time_entries table into
      // memory just to sum hours per project.
      const projectIds = allProjects.map((p) => p.id);
      const timeScopeFilter = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);
      const statsRows = projectIds.length
        ? await ctx.db
            .select({
              projectId: timeEntries.projectId,
              totalHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
              entriesCount: sql<number>`COUNT(*)::int`,
              // Timer i den valgte periode og i den forrige (til trend-pilen).
              // FILTER holder det i én scanning i stedet for tre queries.
              // Øvre grænse med: en fremdateret registrering må ikke tælle
              // med i "denne måned" (samme regel som månedsbudgettet).
              periodHours:
                periodFromSql && periodToSql
                  ? sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)) FILTER (WHERE ${timeEntries.date} >= ${periodFromSql} AND ${timeEntries.date} < ${periodToSql}), 0)`
                  : sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
              previousPeriodHours:
                prevFromSql && prevToSql
                  ? sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)) FILTER (WHERE ${timeEntries.date} >= ${prevFromSql} AND ${timeEntries.date} < ${prevToSql}), 0)`
                  : sql<string>`0`,
            })
            .from(timeEntries)
            .where(
              and(timeScopeFilter, inArray(timeEntries.projectId, projectIds)),
            )
            .groupBy(timeEntries.projectId)
        : [];

      const statsByProject = new Map<
        string,
        {
          totalHours: number;
          entriesCount: number;
          periodHours: number;
          previousPeriodHours: number;
        }
      >();
      for (const row of statsRows) {
        if (row.projectId) {
          statsByProject.set(row.projectId, {
            totalHours: parseFloat(row.totalHours as unknown as string),
            entriesCount: row.entriesCount,
            periodHours: parseFloat(row.periodHours as unknown as string),
            previousPeriodHours: parseFloat(
              row.previousPeriodHours as unknown as string,
            ),
          });
        }
      }

      // Tags pr. projekt — bruges til afdelings-filtrering ("SEO", "Ads", ...)
      const tagRows = projectIds.length
        ? await ctx.db
            .select({
              projectId: projectTags.projectId,
              id: tags.id,
              name: tags.name,
              color: tags.color,
            })
            .from(projectTags)
            .innerJoin(tags, eq(tags.id, projectTags.tagId))
            .where(inArray(projectTags.projectId, projectIds))
        : [];
      const tagsByProject = new Map<
        string,
        Array<{ id: string; name: string; color: string | null }>
      >();
      for (const row of tagRows) {
        const list = tagsByProject.get(row.projectId) ?? [];
        list.push({ id: row.id, name: row.name, color: row.color });
        tagsByProject.set(row.projectId, list);
      }

      // Current-month usage for projects with a monthly hours budget. Usage is
      // computed on read (SUM for the calendar month), so the budget "resets"
      // automatically on the 1st without any cron/snapshot.
      const monthlyBudgetIds = allProjects
        .filter((p) => p.monthlyBudgetHours)
        .map((p) => p.id);
      // Månedsgrænser i dansk tid og samme scope-prædikat som budget-cronen
      // og rapporten (#592) — ellers viser de tre steder forskellige tal for
      // det samme projekt.
      const monthlyUsedByProject = await loadMonthlyUsage(ctx.db, {
        projectIds: monthlyBudgetIds,
        scope: monthlyUsageScope(ctx.orgId ?? null, userId),
      });

      // Calculate stats for each project
      const projectsWithStats = allProjects.map((project) => {
        const agg = statsByProject.get(project.id);
        const totalHours = agg?.totalHours ?? 0;
        const entriesCount = agg?.entriesCount ?? 0;
        const periodHours = agg?.periodHours ?? 0;
        const previousPeriodHours = agg?.previousPeriodHours ?? 0;

        // Calculate revenue
        let revenue = 0;
        if (project.fixedPrice) {
          revenue = parseFloat(project.fixedPrice);
        } else if (project.hourlyRate) {
          revenue = totalHours * parseFloat(project.hourlyRate);
        }

        // Calculate budget progress: eksplicit timebudget vinder over det
        // udledte (fastpris / timepris)
        let budgetPercentage: number | null = null;
        let estimatedBudgetHours: number | null = null;
        let healthStatus: "green" | "yellow" | "red" | null = null;

        const explicitBudget = project.budgetHours
          ? parseFloat(project.budgetHours)
          : 0;
        if (explicitBudget > 0) {
          estimatedBudgetHours = explicitBudget;
        } else if (project.fixedPrice && project.hourlyRate) {
          estimatedBudgetHours =
            parseFloat(project.fixedPrice) / parseFloat(project.hourlyRate);
        }
        if (estimatedBudgetHours !== null) {
          budgetPercentage =
            estimatedBudgetHours > 0
              ? (totalHours / estimatedBudgetHours) * 100
              : 0;

          // Determine health
          if (budgetPercentage < 75) {
            healthStatus = "green";
          } else if (budgetPercentage < 90) {
            healthStatus = "yellow";
          } else {
            healthStatus = "red";
          }
        }

        // Monthly hours budget status (null when no budget is set)
        let monthly: {
          budgetHours: number;
          usedHours: number;
          percentage: number;
          healthStatus: "green" | "yellow" | "red";
        } | null = null;
        if (project.monthlyBudgetHours) {
          const budgetHours = parseFloat(project.monthlyBudgetHours);
          if (budgetHours > 0) {
            const usedHours = monthlyUsedByProject.get(project.id) ?? 0;
            const status = monthlyBudgetStatus(budgetHours, usedHours);
            monthly = {
              budgetHours,
              usedHours: Math.round(usedHours * 10) / 10,
              percentage: status.percentage,
              healthStatus: status.healthStatus,
            };
          }
        }

        return {
          ...project,
          tags: tagsByProject.get(project.id) ?? [],
          stats: {
            totalHours: Math.round(totalHours * 10) / 10,
            periodHours: Math.round(periodHours * 10) / 10,
            previousPeriodHours: Math.round(previousPeriodHours * 10) / 10,
            revenue: Math.round(revenue),
            entriesCount,
            budgetPercentage:
              budgetPercentage !== null ? Math.round(budgetPercentage) : null,
            estimatedBudgetHours:
              estimatedBudgetHours !== null
                ? Math.round(estimatedBudgetHours * 10) / 10
                : null,
            healthStatus,
            monthly,
          },
        };
      });

      return { period, projects: projectsWithStats };
    }),

  // Get projects by client
  getByClient: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertClientAccess(ctx.db, userId, ctx.orgId, input.clientId);

      const clientProjects = await ctx.db.query.projects.findMany({
        where: and(
          ctx.orgId
            ? eq(projects.organizationId, ctx.orgId)
            : eq(projects.userId, userId),
          eq(projects.clientId, input.clientId),
        ),
        orderBy: [asc(sql`lower(${projects.name})`)],
      });

      return clientProjects.sort((a, b) => a.name.localeCompare(b.name, "da"));
    }),

  // Get a single project by ID
  getById: moduleReadProcedure("projects")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.id),
          ctx.orgId
            ? eq(projects.organizationId, ctx.orgId)
            : eq(projects.userId, userId),
        ),
        with: {
          client: true,
          tags: {
            with: { tag: true },
          },
        },
      });

      if (!project) {
        throw Errors.projectNotFound();
      }
      // A client-restricted member can't open a project for a client they
      // can't access, even by guessing its id.
      await assertClientAccess(ctx.db, userId, ctx.orgId, project.clientId);

      return {
        ...project,
        tags: (project.tags ?? []).map((pt) => ({
          id: pt.tag.id,
          name: pt.tag.name,
          color: pt.tag.color,
        })),
      };
    }),

  // Create a new project
  create: subscribedProcedure
    .input(projectInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify client belongs to user/org (internt projekt = ingen kunde)
      let clientName: string | null = null;
      if (input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
        });

        if (!client) {
          throw Errors.clientNotFound();
        }
        clientName = client.name;
      }

      // Check if this is the user's first project (before creating)
      const existingProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.userId, userId),
        limit: 1,
      });
      const isFirstProject = existingProjects.length === 0;

      // Create the project and seed the 3 default project-scope Kanban
      // lanes atomically — if lane seeding fails, the project insert
      // rolls back.
      const newProject = await ctx.db.transaction(async (tx) => {
        const [project] = await tx
          .insert(projects)
          .values({
            userId,
            organizationId: ctx.orgId,
            clientId: input.clientId ?? null,
            name: input.name,
            description: input.description || null,
            hourlyRate: input.hourlyRate || null,
            fixedPrice: input.fixedPrice || null,
            monthlyBudgetHours: input.monthlyBudgetHours || null,
            budgetHours: input.budgetHours || null,
            status: input.status || "active",
            startDate: input.startDate ? new Date(input.startDate) : null,
            endDate: input.endDate ? new Date(input.endDate) : null,
            urlPatterns: input.urlPatterns || [],
            roundingEnabled: input.roundingEnabled,
            roundingMinutes: input.roundingMinutes,
            roundingMethod: input.roundingMethod,
          })
          .returning();

        await tx.insert(taskStatuses).values(
          PROJECT_DEFAULT_LANES.map((lane) => ({
            userId: ctx.session.user.id,
            scope: "project" as const,
            projectId: project.id,
            name: lane.name,
            color: lane.color,
            order: lane.order,
            isArchive: lane.isArchive,
            category: lane.category,
          })),
        );

        return project;
      });

      // Send first project milestone email
      if (isFirstProject) {
        try {
          const user = await ctx.db.query.users.findFirst({
            where: eq(users.id, userId),
          });
          const prefs = await ctx.db.query.emailPreferences.findFirst({
            where: eq(emailPreferences.userId, userId),
          });

          // Only send if user has onboarding milestones enabled (default: true)
          if (user && prefs?.onboardingMilestones !== false) {
            await sendFirstProjectEmail({
              to: user.email,
              userName: user.name || "der",
              projectName: newProject.name,
              clientName: clientName ?? "Intern",
              userId,
            });
          }
        } catch (error) {
          // Don't fail the create operation if email fails
          console.error("Failed to send first project email:", error);
        }
      }

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "project.created",
        eventId: newProject.id,
        data: { project: newProject },
        clientId: newProject.clientId,
        projectId: newProject.id,
      });

      return newProject;
    }),

  // Update a project
  update: subscribedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: projectInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify project belongs to user/org
      const ownershipFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);
      const existingProject = await ctx.db.query.projects.findFirst({
        where: and(eq(projects.id, input.id), ownershipFilter),
      });

      if (!existingProject) {
        throw Errors.projectNotFound();
      }

      // Verify new client belongs to user/org if client is being changed
      if (input.data.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.data.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
        });

        if (!client) {
          throw Errors.clientNotFound();
        }
      }

      // Check if hourly rate changed
      if (
        input.data.hourlyRate &&
        input.data.hourlyRate !== existingProject.hourlyRate
      ) {
        // Log rate change to history
        await ctx.db.insert(rateHistory).values({
          userId,
          organizationId: ctx.orgId,
          clientId: input.data.clientId ?? null,
          projectId: input.id,
          oldRate: existingProject.hourlyRate,
          newRate: input.data.hourlyRate,
          rateType: "project",
          effectiveDate: new Date(),
        });
      }

      const [updatedProject] = await ctx.db
        .update(projects)
        .set({
          clientId: input.data.clientId ?? null,
          name: input.data.name,
          description: input.data.description || null,
          hourlyRate: input.data.hourlyRate || null,
          fixedPrice: input.data.fixedPrice || null,
          monthlyBudgetHours: input.data.monthlyBudgetHours || null,
          budgetHours: input.data.budgetHours || null,
          status: input.data.status || "active",
          startDate: input.data.startDate
            ? new Date(input.data.startDate)
            : null,
          endDate: input.data.endDate ? new Date(input.data.endDate) : null,
          urlPatterns: input.data.urlPatterns,
          roundingEnabled: input.data.roundingEnabled,
          roundingMinutes: input.data.roundingMinutes,
          roundingMethod: input.data.roundingMethod,
          updatedAt: new Date(),
        })
        .where(and(eq(projects.id, input.id), ownershipFilter))
        .returning();

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "project.updated",
        eventId: updatedProject.id,
        data: { project: updatedProject },
        clientId: updatedProject.clientId,
        projectId: updatedProject.id,
      });

      return updatedProject;
    }),

  // Monthly hours budget: current month usage + history of previous months.
  // Usage is computed on read (SUM per calendar month), so the budget resets
  // automatically on the 1st of each month without cron/snapshots.
  monthlyBudget: moduleReadProcedure("projects")
    .input(
      z.object({
        projectId: z.string().uuid(),
        months: z.number().int().min(1).max(24).default(12),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownershipFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);

      const project = await ctx.db.query.projects.findFirst({
        where: and(eq(projects.id, input.projectId), ownershipFilter),
        columns: { id: true, clientId: true, monthlyBudgetHours: true },
      });
      if (!project) {
        throw Errors.projectNotFound();
      }
      // Client-restricted members must not read budget data for a client they
      // can't access, even by guessing the projectId (mirrors getById).
      await assertClientAccess(ctx.db, userId, ctx.orgId, project.clientId);

      const budgetHours = project.monthlyBudgetHours
        ? parseFloat(project.monthlyBudgetHours)
        : null;

      const now = new Date();
      // Månedsgrænser i dansk tid (#592) — samme kilde som projects.list,
      // rapporten og budget-cronen.
      const current = monthBoundsCopenhagen(now);
      const rangeStart = monthBoundsCopenhagenOffset(
        now,
        -(input.months - 1),
      ).start;
      // Øvre grænse: uden den blev poster i en fremtidig måned bucket'et til
      // en månedsnøgle der ikke findes i `months` og forsvandt tavst. Nu
      // afgrænses de eksplicit — samme regel som `projects.list`.
      const rangeEnd = current.next;

      const timeScopeFilter = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);

      // `time_entries.date` er timestamp uden tidszone med UTC-semantik, så
      // den skal tolkes som UTC og vises i dansk tid før måneden trunkeres.
      const cphMonth = sql`date_trunc('month', ${timeEntries.date} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Copenhagen')`;

      const rows = await ctx.db
        .select({
          month: sql<string>`to_char(${cphMonth}, 'YYYY-MM')`,
          hours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
        })
        .from(timeEntries)
        .where(
          and(
            timeScopeFilter,
            eq(timeEntries.projectId, input.projectId),
            gte(timeEntries.date, rangeStart),
            lt(timeEntries.date, rangeEnd),
          ),
        )
        .groupBy(cphMonth)
        .orderBy(cphMonth);

      const hoursByMonth = new Map(
        rows.map((r) => [
          r.month,
          Math.round(parseFloat(r.hours as unknown as string) * 100) / 100,
        ]),
      );

      // Fill every month in the range (newest first) so the UI can render a
      // complete history including empty months.
      const months: {
        month: string;
        hours: number;
        percentage: number | null;
        healthStatus: "green" | "yellow" | "red" | null;
      }[] = [];
      for (let i = 0; i < input.months; i++) {
        const key = monthKeyCopenhagen(
          monthBoundsCopenhagenOffset(now, -i).start,
        );
        const hours = hoursByMonth.get(key) ?? 0;
        const hasBudget = !!budgetHours && budgetHours > 0;
        const status = hasBudget
          ? monthlyBudgetStatus(budgetHours as number, hours)
          : null;
        months.push({
          month: key,
          hours,
          percentage: status?.percentage ?? null,
          healthStatus: status?.healthStatus ?? null,
        });
      }

      return { budgetHours, months };
    }),

  // Archive a project (soft delete)
  delete: moduleWriteProcedure("projects")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify project belongs to user/org
      const ownershipFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);
      const existingProject = await ctx.db.query.projects.findFirst({
        where: and(eq(projects.id, input.id), ownershipFilter),
      });

      if (!existingProject) {
        throw Errors.projectNotFound();
      }

      // Soft delete by setting status to archived
      await ctx.db
        .update(projects)
        .set({
          status: "archived",
          updatedAt: new Date(),
        })
        .where(eq(projects.id, input.id));

      return { success: true };
    }),

  permanentDelete: moduleWriteProcedure("projects")
    .input(
      z.object({
        id: z.string().uuid(),
        confirmName: z
          .string()
          .min(1, { error: () => st("zod.confirmProjectName") }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const ownershipFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);
      const project = await ctx.db.query.projects.findFirst({
        where: and(eq(projects.id, input.id), ownershipFilter),
      });

      if (!project) {
        throw Errors.projectNotFound();
      }

      if (input.confirmName !== project.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "projects.nameMismatch"),
        });
      }

      await assertNoBilledProjectEntries(ctx.db, [input.id]);

      await ctx.db.transaction(async (tx) => {
        // Nullify references that default to RESTRICT
        await tx
          .update(timeEntries)
          .set({ projectId: null })
          .where(eq(timeEntries.projectId, input.id));
        await tx.delete(rateHistory).where(eq(rateHistory.projectId, input.id));
        await tx
          .delete(recurringTimeTemplates)
          .where(eq(recurringTimeTemplates.projectId, input.id));
        // The rest (tasks, timerTemplates, timerStates, calendarEvents,
        // taskStatuses, projectTags, memberRates, webhooks) have
        // onDelete: set null or cascade in the schema
        await tx.delete(projects).where(eq(projects.id, input.id));
      });

      // Rækken er væk, så skrivebordsenheden skal rydde den lokalt (se
      // desktop-sync-tombstones). Ejeren af rækken skriver nøglen.
      // Uden for transaktionen: en fejlet tombstone-insert må ikke kunne rulle
      // sletningen tilbage, mens mutationen svarer success.
      await recordDeletionTombstones(ctx.db, {
        entityType: "project",
        rows: [project],
      });

      return { success: true };
    }),

  // Update project status only
  updateStatus: subscribedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["active", "completed", "on_hold", "archived"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify project belongs to user/org
      const ownershipFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);
      const existingProject = await ctx.db.query.projects.findFirst({
        where: and(eq(projects.id, input.id), ownershipFilter),
      });

      if (!existingProject) {
        throw Errors.projectNotFound();
      }

      const [updatedProject] = await ctx.db
        .update(projects)
        .set({
          status: input.status,
          updatedAt: new Date(),
        })
        .where(and(eq(projects.id, input.id), ownershipFilter))
        .returning();

      if (existingProject.status !== input.status) {
        emitWebhookEvent({
          userId,
          orgId: ctx.orgId,
          eventType: "project.status_changed",
          eventId: updatedProject.id,
          data: {
            project: updatedProject,
            previousStatus: existingProject.status,
            newStatus: input.status,
          },
          clientId: updatedProject.clientId,
          projectId: updatedProject.id,
        });
      }

      return updatedProject;
    }),

  // Get project count
  count: moduleReadProcedure("projects").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [result] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(
        and(
          ctx.orgId
            ? eq(projects.organizationId, ctx.orgId)
            : eq(projects.userId, userId),
          eq(projects.status, "active"),
        ),
      );

    return result?.count ?? 0;
  }),

  // Get project stats (hours and revenue)
  getStats: moduleReadProcedure("projects")
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify project belongs to user/org
      const ownershipFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);
      const project = await ctx.db.query.projects.findFirst({
        where: and(eq(projects.id, input.projectId), ownershipFilter),
      });

      if (!project) {
        throw Errors.projectNotFound();
      }

      const timeScopeFilter = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);
      // "Denne måned" med samme UTC-grænser som projektlisten og
      // månedsbudgettet, så de tre tal ikke kan være uenige. ISO-strenge i
      // FILTER-udtrykket — rå Date-objekter fejler i postgres.js (#562).
      const monthFromSql = periodStartUtc("month")?.toISOString() ?? null;
      const monthToSql = periodEndUtc("month")?.toISOString() ?? null;
      const [stats] = await ctx.db
        .select({
          totalHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
          monthHours:
            monthFromSql && monthToSql
              ? sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)) FILTER (WHERE ${timeEntries.date} >= ${monthFromSql} AND ${timeEntries.date} < ${monthToSql}), 0)`
              : sql<string>`0`,
          entriesCount: sql<number>`count(*)::int`,
        })
        .from(timeEntries)
        .where(
          and(eq(timeEntries.projectId, input.projectId), timeScopeFilter),
        );

      const totalHours = parseFloat(stats?.totalHours ?? "0");

      let revenue = 0;
      if (project.fixedPrice) {
        revenue = parseFloat(project.fixedPrice);
      } else if (project.hourlyRate) {
        revenue = totalHours * parseFloat(project.hourlyRate);
      }

      // Timebudget: eksplicit budget_hours, ellers udledt af fastpris/timepris
      let budgetHours: number | null = null;
      if (project.budgetHours && parseFloat(project.budgetHours) > 0) {
        budgetHours = parseFloat(project.budgetHours);
      } else if (project.fixedPrice && project.hourlyRate) {
        const derived =
          parseFloat(project.fixedPrice) / parseFloat(project.hourlyRate);
        if (derived > 0) budgetHours = derived;
      }
      // Ressourceplan (#508): planlagt fremover vises oven på det brugte
      const plannedHours =
        budgetHours !== null && ctx.orgId
          ? await loadRemainingPlannedHours(ctx.db, ctx.orgId, input.projectId)
          : 0;
      const budget =
        budgetHours !== null
          ? {
              budgetHours: Math.round(budgetHours * 10) / 10,
              usedHours: Math.round(totalHours * 10) / 10,
              remainingHours: Math.round((budgetHours - totalHours) * 10) / 10,
              percentage: Math.round((totalHours / budgetHours) * 100),
              plannedHours: Math.round(plannedHours * 10) / 10,
              isExplicit: !!(
                project.budgetHours && parseFloat(project.budgetHours) > 0
              ),
            }
          : null;

      return {
        totalHours: Math.round(totalHours * 10) / 10,
        revenue: Math.round(revenue),
        monthHours:
          Math.round(parseFloat(stats?.monthHours ?? "0") * 100) / 100,
        entriesCount: stats?.entriesCount ?? 0,
        budget,
      };
    }),

  // Get project health status (budget utilization)
  healthStatus: moduleReadProcedure("projects").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Get all active projects
    const scopeFilter = ctx.orgId
      ? eq(projects.organizationId, ctx.orgId)
      : eq(projects.userId, userId);
    const activeProjects = await ctx.db.query.projects.findMany({
      where: and(scopeFilter, eq(projects.status, "active")),
      with: {
        client: true,
      },
      orderBy: [desc(projects.createdAt)],
    });

    const timeScopeFilter = ctx.orgId
      ? eq(timeEntries.organizationId, ctx.orgId)
      : eq(timeEntries.userId, userId);

    const projectIds = activeProjects.map((p) => p.id);
    const hoursRows = projectIds.length
      ? await ctx.db
          .select({
            projectId: timeEntries.projectId,
            totalHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
          })
          .from(timeEntries)
          .where(
            and(timeScopeFilter, inArray(timeEntries.projectId, projectIds)),
          )
          .groupBy(timeEntries.projectId)
      : [];

    const hoursMap = new Map(
      hoursRows.map((r) => [r.projectId, parseFloat(r.totalHours)]),
    );

    const projectHealthData = activeProjects.map((project) => {
      const hoursUsed = hoursMap.get(project.id) ?? 0;

      let budgetPercentage = 0;
      let estimatedBudget: number | null = null;

      if (project.fixedPrice && project.hourlyRate) {
        estimatedBudget =
          parseFloat(project.fixedPrice) / parseFloat(project.hourlyRate);
        budgetPercentage =
          estimatedBudget > 0 ? (hoursUsed / estimatedBudget) * 100 : 0;
      }

      let healthStatus: "green" | "yellow" | "red";
      if (budgetPercentage < 75) {
        healthStatus = "green";
      } else if (budgetPercentage < 90) {
        healthStatus = "yellow";
      } else {
        healthStatus = "red";
      }

      return {
        id: project.id,
        name: project.name,
        clientName: project.client?.name ?? "Intern",
        hoursUsed: Math.round(hoursUsed * 10) / 10,
        estimatedBudget: estimatedBudget
          ? Math.round(estimatedBudget * 10) / 10
          : null,
        budgetPercentage: Math.round(budgetPercentage),
        healthStatus,
        hasFixedPrice: !!project.fixedPrice,
        fixedPrice: project.fixedPrice ? parseFloat(project.fixedPrice) : null,
        hourlyRate: project.hourlyRate ? parseFloat(project.hourlyRate) : null,
      };
    });

    const statusOrder = { red: 0, yellow: 1, green: 2 };
    projectHealthData.sort(
      (a, b) => statusOrder[a.healthStatus] - statusOrder[b.healthStatus],
    );

    return projectHealthData;
  }),

  // Get budget alerts for projects nearing or exceeding budget
  getBudgetAlerts: moduleReadProcedure("projects").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Get all active fixed-price projects
    const scopeFilter = ctx.orgId
      ? eq(projects.organizationId, ctx.orgId)
      : eq(projects.userId, userId);
    const activeProjects = await ctx.db.query.projects.findMany({
      where: and(scopeFilter, eq(projects.status, "active")),
      with: {
        client: true,
      },
    });

    const budgetProjects = activeProjects.flatMap((p) =>
      p.fixedPrice && p.hourlyRate
        ? [{ ...p, fixedPrice: p.fixedPrice, hourlyRate: p.hourlyRate }]
        : [],
    );

    if (budgetProjects.length === 0) return [];

    const timeScopeFilter = ctx.orgId
      ? eq(timeEntries.organizationId, ctx.orgId)
      : eq(timeEntries.userId, userId);
    const budgetProjectIds = budgetProjects.map((p) => p.id);
    const hoursRows = await ctx.db
      .select({
        projectId: timeEntries.projectId,
        totalHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
      })
      .from(timeEntries)
      .where(
        and(timeScopeFilter, inArray(timeEntries.projectId, budgetProjectIds)),
      )
      .groupBy(timeEntries.projectId);

    const hoursMap = new Map(
      hoursRows.map((r) => [r.projectId, parseFloat(r.totalHours)]),
    );

    const alerts: Array<{
      id: string;
      projectName: string;
      clientName: string;
      hoursUsed: number;
      budgetHours: number;
      budgetPercentage: number;
      fixedPrice: number;
      hourlyRate: number;
      severity: "warning" | "critical" | "exceeded";
    }> = [];

    for (const project of budgetProjects) {
      const hoursUsed = hoursMap.get(project.id) ?? 0;
      const fixedPrice = parseFloat(project.fixedPrice);
      const hourlyRate = parseFloat(project.hourlyRate);
      const budgetHours = fixedPrice / hourlyRate;
      const budgetPercentage =
        budgetHours > 0 ? (hoursUsed / budgetHours) * 100 : 0;

      if (budgetPercentage >= 80) {
        let severity: "warning" | "critical" | "exceeded";
        if (budgetPercentage >= 100) {
          severity = "exceeded";
        } else if (budgetPercentage >= 90) {
          severity = "critical";
        } else {
          severity = "warning";
        }

        alerts.push({
          id: project.id,
          projectName: project.name,
          clientName: project.client?.name ?? "Intern",
          hoursUsed: Math.round(hoursUsed * 10) / 10,
          budgetHours: Math.round(budgetHours * 10) / 10,
          budgetPercentage: Math.round(budgetPercentage),
          fixedPrice,
          hourlyRate,
          severity,
        });
      }
    }

    const severityOrder = { exceeded: 0, critical: 1, warning: 2 };
    alerts.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
    );

    return alerts;
  }),

  bulkArchive: moduleWriteProcedure("projects")
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownershipFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);

      await ctx.db
        .update(projects)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(inArray(projects.id, input.ids), ownershipFilter));

      return { count: input.ids.length };
    }),

  bulkPermanentDelete: moduleWriteProcedure("projects")
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownershipFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);

      // Verify all projects belong to user/org
      const ownedProjects = await ctx.db.query.projects.findMany({
        where: and(inArray(projects.id, input.ids), ownershipFilter),
        // Ejerskabet skal med, så hver slettet række kan få en tombstone
        columns: { id: true, userId: true, organizationId: true },
      });
      const ownedIds = ownedProjects.map((p) => p.id);
      if (ownedIds.length === 0)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "projects.noneFound"),
        });

      await assertNoBilledProjectEntries(ctx.db, ownedIds);

      await ctx.db.transaction(async (tx) => {
        // Nullify time entry references
        await tx
          .update(timeEntries)
          .set({ projectId: null })
          .where(inArray(timeEntries.projectId, ownedIds));
        // Delete rate history
        await tx
          .delete(rateHistory)
          .where(inArray(rateHistory.projectId, ownedIds));
        // Delete recurring templates
        await tx
          .delete(recurringTimeTemplates)
          .where(inArray(recurringTimeTemplates.projectId, ownedIds));
        // Delete the projects
        await tx.delete(projects).where(inArray(projects.id, ownedIds));
      });

      // Uden for transaktionen — en fejlet tombstone-insert må ikke kunne
      // rulle sletningen tilbage (se permanentDelete).
      await recordDeletionTombstones(ctx.db, {
        entityType: "project",
        rows: ownedProjects,
      });

      return { count: ownedIds.length };
    }),
});
