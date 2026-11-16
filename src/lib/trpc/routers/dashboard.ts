import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import {
  clients,
  dashboardPreferences,
  projects,
  timeEntries,
} from "@/lib/db/schema";
import { rankQuickStart } from "@/lib/home/quick-start";
import {
  addDaysToDateStr,
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenToday,
} from "@/lib/time/copenhagen";
import {
  type DashboardLayout,
  DEFAULT_ACTIVE_WIDGETS,
  DEFAULT_DASHBOARD_LAYOUT,
} from "@/types/dashboard";
import { protectedProcedure, router } from "../trpc";

export const dashboardRouter = router({
  // Get user's dashboard preferences
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    try {
      const prefs = await ctx.db.query.dashboardPreferences.findFirst({
        where: eq(dashboardPreferences.userId, userId),
      });

      // Return defaults if no preferences exist
      if (!prefs) {
        return {
          layout: DEFAULT_DASHBOARD_LAYOUT,
          activeWidgets: DEFAULT_ACTIVE_WIDGETS,
          breakpoint: "lg",
          cols: 4,
        };
      }

      return {
        layout: prefs.layout as DashboardLayout[],
        activeWidgets: prefs.activeWidgets,
        breakpoint: prefs.breakpoint || "lg",
        cols: prefs.cols || 4,
      };
    } catch (error) {
      // If table doesn't exist yet (migration not run), return defaults
      console.warn(
        "Dashboard preferences query failed, returning defaults:",
        error,
      );
      return {
        layout: DEFAULT_DASHBOARD_LAYOUT,
        activeWidgets: DEFAULT_ACTIVE_WIDGETS,
        breakpoint: "lg",
        cols: 4,
      };
    }
  }),

  // Save dashboard preferences
  savePreferences: protectedProcedure
    .input(
      z.object({
        layout: z.array(
          z.object({
            i: z.string(),
            x: z.number(),
            y: z.number(),
            w: z.number(),
            h: z.number(),
            minW: z.number().optional(),
            minH: z.number().optional(),
            maxW: z.number().optional(),
            maxH: z.number().optional(),
          }),
        ),
        activeWidgets: z.array(z.string()),
        breakpoint: z.string().optional(),
        cols: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      try {
        // Check if preferences exist
        const existing = await ctx.db.query.dashboardPreferences.findFirst({
          where: eq(dashboardPreferences.userId, userId),
        });

        if (existing) {
          // Update existing preferences
          const [updated] = await ctx.db
            .update(dashboardPreferences)
            .set({
              layout: input.layout,
              activeWidgets: input.activeWidgets,
              breakpoint: input.breakpoint || "lg",
              cols: input.cols || 4,
              updatedAt: new Date(),
            })
            .where(eq(dashboardPreferences.userId, userId))
            .returning();

          return updated;
        }

        // Create new preferences
        const [created] = await ctx.db
          .insert(dashboardPreferences)
          .values({
            userId,
            organizationId: ctx.orgId ?? null,
            layout: input.layout,
            activeWidgets: input.activeWidgets,
            breakpoint: input.breakpoint || "lg",
            cols: input.cols || 4,
          })
          .returning();

        return created;
      } catch (error) {
        // If table doesn't exist, log error and return null
        console.log("Failed to save dashboard preferences:", error);
        throw new Error(
          await tr("serverErrors", "dashboard.prefsTableMissing"),
        );
      }
    }),

  // Reset to default layout
  resetToDefault: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    try {
      const existing = await ctx.db.query.dashboardPreferences.findFirst({
        where: eq(dashboardPreferences.userId, userId),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(dashboardPreferences)
          .set({
            layout: DEFAULT_DASHBOARD_LAYOUT,
            activeWidgets: DEFAULT_ACTIVE_WIDGETS,
            breakpoint: "lg",
            cols: 4,
            updatedAt: new Date(),
          })
          .where(eq(dashboardPreferences.userId, userId))
          .returning();

        return updated;
      }

      // Create with defaults
      const [created] = await ctx.db
        .insert(dashboardPreferences)
        .values({
          userId,
          organizationId: ctx.orgId ?? null,
          layout: DEFAULT_DASHBOARD_LAYOUT,
          activeWidgets: DEFAULT_ACTIVE_WIDGETS,
          breakpoint: "lg",
          cols: 4,
        })
        .returning();

      return created;
    } catch (error) {
      console.log("Failed to reset dashboard preferences:", error);
      throw new Error(await tr("serverErrors", "dashboard.prefsTableMissing"));
    }
  }),

  // Hjem (#hjem): dagens egne poster, kompakt. Personlig visning som
  // time.todayTotal — aldrig kollegers tid, også for org-ejere.
  homeToday: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const todayStr = copenhagenToday();
    const rows = await ctx.db.query.timeEntries.findMany({
      where: and(
        eq(timeEntries.userId, userId),
        ...(ctx.orgId ? [eq(timeEntries.organizationId, ctx.orgId)] : []),
        gte(timeEntries.date, copenhagenDayStart(todayStr)),
        lt(timeEntries.date, copenhagenDayEndExclusive(todayStr)),
      ),
      orderBy: [asc(timeEntries.startTime), asc(timeEntries.createdAt)],
      limit: 50,
      columns: {
        id: true,
        description: true,
        hours: true,
        startTime: true,
        endTime: true,
        projectId: true,
        clientId: true,
        taskId: true,
        isBilled: true,
      },
      with: {
        project: {
          columns: { id: true, name: true, clientId: true },
          with: { client: { columns: { id: true, name: true } } },
        },
        client: { columns: { id: true, name: true } },
      },
    });

    const entries = rows.map((e) => ({
      id: e.id,
      description: e.description ?? "",
      hours: Number(e.hours),
      startTime: e.startTime,
      endTime: e.endTime,
      projectId: e.projectId,
      projectName: e.project?.name ?? null,
      clientId: e.clientId ?? e.project?.clientId ?? null,
      clientName: e.client?.name ?? e.project?.client?.name ?? null,
      taskId: e.taskId,
      isBilled: e.isBilled ?? false,
    }));
    const totalHours =
      Math.round(entries.reduce((sum, e) => sum + e.hours, 0) * 100) / 100;
    return { date: todayStr, entries, totalHours };
  }),

  // Hjem: hurtigstart-chips = de kunde/projekt-kombinationer brugeren har
  // brugt mest de seneste 30 dage (egne poster).
  homeQuickStart: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const since = copenhagenDayStart(addDaysToDateStr(copenhagenToday(), -30));
    const rows = await ctx.db
      .select({
        projectId: timeEntries.projectId,
        projectName: projects.name,
        projectStatus: projects.status,
        projectClientId: projects.clientId,
        entryClientId: timeEntries.clientId,
        clientName: clients.name,
        clientArchived: clients.isArchived,
        createdAt: timeEntries.createdAt,
      })
      .from(timeEntries)
      .leftJoin(projects, eq(timeEntries.projectId, projects.id))
      // Postens egen kunde vinder over projektets (som coverage/load.ts)
      .leftJoin(
        clients,
        sql`${clients.id} = COALESCE(${timeEntries.clientId}, ${projects.clientId})`,
      )
      .where(
        and(
          eq(timeEntries.userId, userId),
          ...(ctx.orgId ? [eq(timeEntries.organizationId, ctx.orgId)] : []),
          gte(timeEntries.date, since),
        ),
      )
      .orderBy(desc(timeEntries.createdAt))
      .limit(1000);
    return rankQuickStart(rows, 6);
  }),
});
