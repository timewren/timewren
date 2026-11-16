import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import {
  departmentManagers,
  departments,
  employeeProfiles,
  members,
} from "@/lib/db/schema";
import { getVisibleScope } from "@/lib/enterprise/scope";
import { logOrgAudit } from "@/lib/org-audit";
import { roleSatisfies } from "@/lib/permissions/org-role";
import { router } from "../../trpc";
import { orgAdminProcedure, organizationProcedure } from "./middleware";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const managerInput = z.object({
  userId: z.string(),
  role: z.enum(["lead", "deputy"]).default("lead"),
  validFrom: dateString.nullable().optional(),
  validTo: dateString.nullable().optional(),
});

/**
 * enterprise.departmentManagers (#464) — afdelingsledere og stedfortrædere
 * pr. afdeling. Supplerer employee_profiles.managerId i leder-scopingen
 * (src/lib/enterprise/scope.ts).
 */
export const enterpriseDepartmentManagersRouter = router({
  departmentManagers: router({
    /**
     * list — ledere/stedfortrædere for org'ens afdelinger. manager+ ser alle
     * afdelinger i eget scope; menige ser kun deres egen afdelings ledere.
     */
    list: organizationProcedure
      .input(z.object({ departmentId: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        let deptFilter: string[] | null = null; // null = alle afdelinger
        if (roleSatisfies(ctx.orgRole, "manager")) {
          const scope = await getVisibleScope(ctx.db, ctx);
          if (!scope.all) {
            // Afdelinger for de profiler lederen ser (egen afdeling, reports
            // og afdelinger hvor lederen er lead/deputy)
            deptFilter = scope.profiles
              .map((p) => p.departmentId)
              .filter((d): d is string => !!d);
          }
        } else {
          const own = await ctx.db.query.employeeProfiles.findFirst({
            where: eq(employeeProfiles.id, ctx.employeeProfileId),
            columns: { departmentId: true },
          });
          deptFilter = own?.departmentId ? [own.departmentId] : [];
        }
        if (deptFilter && deptFilter.length === 0) return [];

        return ctx.db.query.departmentManagers.findMany({
          where: and(
            eq(departmentManagers.organizationId, ctx.orgId),
            input?.departmentId
              ? eq(departmentManagers.departmentId, input.departmentId)
              : undefined,
            deptFilter
              ? inArray(
                  departmentManagers.departmentId,
                  Array.from(new Set(deptFilter)),
                )
              : undefined,
          ),
          with: {
            user: { columns: { id: true, name: true, email: true } },
          },
          orderBy: (m, { asc }) => [asc(m.role), asc(m.createdAt)],
        });
      }),

    /**
     * set — erstat sættet af ledere/stedfortrædere for én afdeling. Admin/
     * owner. Brugere skal være medlemmer af org'en.
     */
    set: orgAdminProcedure
      .input(
        z.object({
          departmentId: z.string(),
          managers: z.array(managerInput).max(20),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const dept = await ctx.db.query.departments.findFirst({
          where: and(
            eq(departments.id, input.departmentId),
            eq(departments.organizationId, ctx.orgId),
          ),
          columns: { id: true },
        });
        if (!dept) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "enterprise.departmentNotFound"),
          });
        }

        // Dubletter (samme bruger to gange) og fremmede brugere afvises
        const userIds = Array.from(
          new Set(input.managers.map((m) => m.userId)),
        );
        if (userIds.length !== input.managers.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr(
              "serverErrors",
              "enterprise.deptManagers.oncePerDept",
            ),
          });
        }
        for (const m of input.managers) {
          if (m.validFrom && m.validTo && m.validFrom > m.validTo) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "enterprise.deptManagers.validFromBeforeTo",
              ),
            });
          }
        }
        if (userIds.length > 0) {
          const rows = await ctx.db.query.members.findMany({
            where: and(
              eq(members.organizationId, ctx.orgId),
              inArray(members.userId, userIds),
            ),
            columns: { userId: true },
          });
          if (rows.length !== userIds.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "enterprise.deptManagers.usersNotMembers",
              ),
            });
          }
        }

        await ctx.db.transaction(async (tx) => {
          const before = await tx.query.departmentManagers.findMany({
            where: and(
              eq(departmentManagers.organizationId, ctx.orgId),
              eq(departmentManagers.departmentId, input.departmentId),
            ),
            columns: { userId: true, role: true },
          });
          await tx
            .delete(departmentManagers)
            .where(
              and(
                eq(departmentManagers.organizationId, ctx.orgId),
                eq(departmentManagers.departmentId, input.departmentId),
              ),
            );
          if (input.managers.length > 0) {
            await tx.insert(departmentManagers).values(
              input.managers.map((m) => ({
                organizationId: ctx.orgId,
                departmentId: input.departmentId,
                userId: m.userId,
                role: m.role,
                validFrom: m.validFrom ?? null,
                validTo: m.validTo ?? null,
              })),
            );
          }
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "department_managers_updated",
            {
              metadata: {
                departmentId: input.departmentId,
                before: before.map((m) => `${m.userId}:${m.role}`).sort(),
                after: input.managers
                  .map((m) => `${m.userId}:${m.role}`)
                  .sort(),
              },
            },
          );
        });

        return { success: true, count: input.managers.length };
      }),
  }),
});
