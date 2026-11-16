import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import type { db as dbClient } from "@/lib/db";
import {
  employeeProfiles,
  projectAssignments,
  projects,
  timesheetHiddenProjects,
  users,
} from "@/lib/db/schema";
import { router } from "../../trpc";
import {
  orgAdminProcedure,
  organizationProcedure,
  orgManagerProcedure,
} from "./middleware";

/**
 * Projekt-tildelinger (#432) — hvilke medarbejdere et projekt står fast for
 * i ugegrid'et, "tilgængeligt for alle"-flaget på projektet og pr.-bruger
 * skjulte rækker. Alt scoped på ctx.orgId.
 */

async function assertOrgProject(
  db: typeof dbClient,
  orgId: string,
  projectId: string,
) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.organizationId, orgId)),
    columns: { id: true, availableToAll: true },
  });
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.projectNotInOrg"),
    });
  }
  return project;
}

export const enterpriseProjectAssignmentsRouter = router({
  /** listProjectAssignments — tildelte medarbejdere + availableToAll. */
  listProjectAssignments: orgManagerProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const project = await assertOrgProject(
        ctx.db,
        ctx.orgId,
        input.projectId,
      );
      const rows = await ctx.db
        .select({
          userId: projectAssignments.userId,
          name: users.name,
          email: users.email,
        })
        .from(projectAssignments)
        .innerJoin(users, eq(projectAssignments.userId, users.id))
        .where(
          and(
            eq(projectAssignments.organizationId, ctx.orgId),
            eq(projectAssignments.projectId, input.projectId),
          ),
        )
        .orderBy(asc(users.name));
      return {
        projectId: project.id,
        availableToAll: project.availableToAll,
        userIds: rows.map((r) => r.userId),
        members: rows,
      };
    }),

  /**
   * setProjectAssignments — erstat sættet af tildelte medarbejdere atomisk.
   * Kun aktive medarbejderprofiler i org'en accepteres.
   */
  setProjectAssignments: orgAdminProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        userIds: z.array(z.string()).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgProject(ctx.db, ctx.orgId, input.projectId);
      const wanted = Array.from(new Set(input.userIds));

      if (wanted.length > 0) {
        const profiles = await ctx.db.query.employeeProfiles.findMany({
          where: and(
            eq(employeeProfiles.organizationId, ctx.orgId),
            eq(employeeProfiles.isActive, true),
            inArray(employeeProfiles.userId, wanted),
          ),
          columns: { userId: true },
        });
        const valid = new Set(profiles.map((p) => p.userId));
        const unknown = wanted.filter((id) => !valid.has(id));
        if (unknown.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr(
              "serverErrors",
              "enterprise.assign.usersNotActive",
            ),
          });
        }
      }

      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(projectAssignments)
          .where(
            and(
              eq(projectAssignments.organizationId, ctx.orgId),
              eq(projectAssignments.projectId, input.projectId),
            ),
          );
        if (wanted.length > 0) {
          // Samtidig gem fra to faner: den anden vinder stille i stedet for
          // en unique-violation efter vores delete (#452).
          await tx
            .insert(projectAssignments)
            .values(
              wanted.map((userId) => ({
                organizationId: ctx.orgId,
                projectId: input.projectId,
                userId,
                createdBy: ctx.session.user.id,
              })),
            )
            .onConflictDoNothing();
        }
      });

      return { projectId: input.projectId, count: wanted.length };
    }),

  /** setProjectAvailableToAll — projektet står fast for alle medarbejdere. */
  setProjectAvailableToAll: orgAdminProcedure
    .input(
      z.object({ projectId: z.string().uuid(), availableToAll: z.boolean() }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgProject(ctx.db, ctx.orgId, input.projectId);
      await ctx.db
        .update(projects)
        .set({ availableToAll: input.availableToAll, updatedAt: new Date() })
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.organizationId, ctx.orgId),
          ),
        );
      return {
        projectId: input.projectId,
        availableToAll: input.availableToAll,
      };
    }),

  /** hideTimesheetProject — skjul en fast række i eget grid (idempotent). */
  hideTimesheetProject: organizationProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOrgProject(ctx.db, ctx.orgId, input.projectId);
      await ctx.db
        .insert(timesheetHiddenProjects)
        .values({
          organizationId: ctx.orgId,
          userId: ctx.session.user.id,
          projectId: input.projectId,
        })
        .onConflictDoNothing();
      return { projectId: input.projectId, hidden: true };
    }),

  /** unhideTimesheetProject — vis en skjult række igen. */
  unhideTimesheetProject: organizationProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(timesheetHiddenProjects)
        .where(
          and(
            eq(timesheetHiddenProjects.organizationId, ctx.orgId),
            eq(timesheetHiddenProjects.userId, ctx.session.user.id),
            eq(timesheetHiddenProjects.projectId, input.projectId),
          ),
        );
      return { projectId: input.projectId, hidden: false };
    }),
});
