import { st, tr } from "@/i18n/server-text";

// Ressourceplan (#508): planlagte timer pr. medarbejder × projekt (evt.
// aktivitetstype) pr. uge, holdt op mod registreret tid og kapacitet
// (normtid − fridage − godkendt fravær).
//
// Adgang: Team og Virksomhed (plan-gate). Ejer/admin planlægger for hele
// org'en, en leder for sine egne medarbejdere, HR ser alt, et medlem ser kun
// sin egen plan. Alt er scopet til den aktive organisation.

import { TRPCError } from "@trpc/server";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { loadWorkTimeContext } from "@/lib/coverage/load";
import {
  absenceRequests,
  activityTypes,
  clients,
  employeeProfiles,
  members,
  projects,
  resourcePlanEntries,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { resolveOrgRole } from "@/lib/enterprise/edit-guard";
import { getVisibleScope } from "@/lib/enterprise/scope";
import {
  type ResourcePlanViewScope,
  resourcePlanAccess,
} from "@/lib/resource-plan/access";
import type {
  ResourcePlanGrid,
  ResourcePlanMember,
} from "@/lib/resource-plan/export";
import {
  buildPlanRows,
  MAX_PLAN_WEEKS,
  type PlanAbsence,
  type PlanCell,
  planWeeks,
  toWeekStart,
  weekCapacity,
  weekEnd,
} from "@/lib/resource-plan/plan";
import {
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenToday,
  isDateStr,
} from "@/lib/time/copenhagen";
import { copenhagenDateSql } from "@/lib/time/date-bounds";
import { router, subscribedProcedure } from "../trpc";

type Ctx = {
  db: typeof import("@/lib/db").db;
  orgId?: string | null;
  session: { user: { id: string } };
};

const dateStr = z
  .string()
  .refine(isDateStr, { error: () => st("zod.dateFormat") });

interface Access {
  orgId: string;
  canPlan: boolean;
  scope: ResourcePlanViewScope;
  /** null = hele organisationen */
  visibleUserIds: Set<string> | null;
}

async function loadAccess(ctx: Ctx): Promise<Access> {
  if (!ctx.orgId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "resourcePlan.needsOrg"),
    });
  }
  const orgId = ctx.orgId;
  const userId = ctx.session.user.id;
  const role = await resolveOrgRole(ctx.db, orgId, userId);
  if (!role) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "common.notOrgMember"),
    });
  }
  const { canPlan, scope } = resourcePlanAccess(role);
  if (scope === "all") return { orgId, canPlan, scope, visibleUserIds: null };
  if (scope === "self") {
    return { orgId, canPlan, scope, visibleUserIds: new Set([userId]) };
  }
  // Leder: egne medarbejdere (afdeling/nærmeste leder) + en selv
  const profile = await ctx.db.query.employeeProfiles.findFirst({
    where: and(
      eq(employeeProfiles.organizationId, orgId),
      eq(employeeProfiles.userId, userId),
    ),
    columns: { id: true },
  });
  if (!profile) {
    return {
      orgId,
      canPlan: false,
      scope: "self",
      visibleUserIds: new Set([userId]),
    };
  }
  const visible = await getVisibleScope(ctx.db, {
    orgId,
    orgRole: role,
    employeeProfileId: profile.id,
    session: ctx.session,
  });
  const ids = new Set(visible.userIds);
  ids.add(userId);
  return { orgId, canPlan, scope, visibleUserIds: ids };
}

function userFilter(
  column: Parameters<typeof inArray>[0],
  ids: Set<string> | null,
) {
  if (ids === null) return undefined;
  return ids.size > 0 ? inArray(column, [...ids]) : sql`false`;
}

const WORKTIME_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

const num = (v: string | null | undefined) => Number.parseFloat(v ?? "0") || 0;

const cellInput = z.object({
  userId: z.string().min(1).max(100),
  projectId: z.string().uuid(),
  activityTypeId: z.string().uuid().nullable(),
  weekStart: dateStr,
  // 0 = fjern cellen
  hours: z.number().min(0).max(168),
});

export const resourcePlanRouter = router({
  grid: subscribedProcedure
    .input(
      z.object({
        weekStart: dateStr,
        weeks: z.number().int().min(1).max(MAX_PLAN_WEEKS).default(8),
        /** Kun én medarbejder (fx print af én persons opgaveoversigt) */
        userId: z.string().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await loadAccess(ctx);
      const { orgId } = access;
      const weeks = planWeeks(input.weekStart, input.weeks);
      const from = weeks[0];
      const to = weekEnd(weeks[weeks.length - 1]);
      const today = copenhagenToday();

      let visible = access.visibleUserIds;
      if (input.userId) {
        if (visible && !visible.has(input.userId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr(
              "serverErrors",
              "resourcePlan.ownEmployeesOnlyView",
            ),
          });
        }
        visible = new Set([input.userId]);
      }

      const memberRows = await ctx.db
        .select({
          userId: members.userId,
          name: users.name,
          email: users.email,
        })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(
          and(
            eq(members.organizationId, orgId),
            userFilter(members.userId, visible),
          ),
        );
      const memberIds = new Set(memberRows.map((m) => m.userId));
      const idFilter = memberIds;

      const weekExpr = sql<string>`to_char(date_trunc('week', ${copenhagenDateSql(timeEntries.date)}), 'YYYY-MM-DD')`;
      const [planRows, regRows, absenceRows] = await Promise.all([
        ctx.db
          .select({
            userId: resourcePlanEntries.userId,
            projectId: resourcePlanEntries.projectId,
            activityTypeId: resourcePlanEntries.activityTypeId,
            weekStart: resourcePlanEntries.weekStart,
            hours: resourcePlanEntries.hours,
          })
          .from(resourcePlanEntries)
          .where(
            and(
              eq(resourcePlanEntries.organizationId, orgId),
              gte(resourcePlanEntries.weekStart, from),
              lte(resourcePlanEntries.weekStart, to),
              userFilter(resourcePlanEntries.userId, idFilter),
            ),
          ),
        ctx.db
          .select({
            userId: timeEntries.userId,
            projectId: timeEntries.projectId,
            activityTypeId: timeEntries.activityTypeId,
            weekStart: weekExpr,
            hours: sql<string>`COALESCE(SUM(${timeEntries.hours}), 0)`,
          })
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.organizationId, orgId),
              sql`${timeEntries.projectId} IS NOT NULL`,
              gte(timeEntries.date, copenhagenDayStart(from)),
              lt(timeEntries.date, copenhagenDayEndExclusive(to)),
              ne(timeEntries.approvalStatus, "rejected"),
              userFilter(timeEntries.userId, idFilter),
            ),
          )
          .groupBy(
            timeEntries.userId,
            timeEntries.projectId,
            timeEntries.activityTypeId,
            weekExpr,
          ),
        ctx.db
          .select({
            userId: absenceRequests.userId,
            startDate: absenceRequests.startDate,
            endDate: absenceRequests.endDate,
            halfDayStart: absenceRequests.halfDayStart,
            halfDayEnd: absenceRequests.halfDayEnd,
            hoursPerDay: absenceRequests.hoursPerDay,
          })
          .from(absenceRequests)
          .where(
            and(
              eq(absenceRequests.organizationId, orgId),
              eq(absenceRequests.status, "approved"),
              lte(absenceRequests.startDate, to),
              or(
                isNull(absenceRequests.endDate),
                gte(absenceRequests.endDate, from),
              ),
              userFilter(absenceRequests.userId, idFilter),
            ),
          ),
      ]);

      const planned: PlanCell[] = planRows.map((r) => ({
        userId: r.userId,
        projectId: r.projectId,
        activityTypeId: r.activityTypeId,
        weekStart: r.weekStart,
        hours: num(r.hours),
      }));
      const registered: PlanCell[] = regRows.flatMap((r) =>
        r.userId && r.projectId
          ? [
              {
                userId: r.userId,
                projectId: r.projectId,
                activityTypeId: r.activityTypeId,
                weekStart: r.weekStart,
                hours: num(r.hours),
              },
            ]
          : [],
      );
      const rows = buildPlanRows(planned, registered);

      const absencesByUser = new Map<string, PlanAbsence[]>();
      for (const a of absenceRows) {
        const list = absencesByUser.get(a.userId) ?? [];
        list.push({
          startDate: a.startDate,
          endDate: a.endDate,
          halfDayStart: a.halfDayStart,
          halfDayEnd: a.halfDayEnd,
          hoursPerDay: a.hoursPerDay ? num(a.hoursPerDay) : null,
        });
        absencesByUser.set(a.userId, list);
      }

      // Normtid minus fridage: samme grundlag som dækningsgrad/belægning
      const enterpriseEnabled = ctx.modules.isEnabled("enterprise");
      // Højst WORKTIME_CONCURRENCY ad gangen — hver indlæsning er flere
      // forespørgsler, og en stor org må ikke åbne hundredvis på én gang
      const membersOut: ResourcePlanMember[] = await mapWithConcurrency(
        memberRows,
        WORKTIME_CONCURRENCY,
        async (m) => {
          const wt = await loadWorkTimeContext(ctx.db, m.userId, orgId, {
            enterpriseEnabled,
          });
          const absences = absencesByUser.get(m.userId) ?? [];
          return {
            userId: m.userId,
            name: m.name || m.email,
            capacity: Object.fromEntries(
              weeks.map((w) => [
                w,
                weekCapacity(w, wt.hoursFor, absences, today),
              ]),
            ),
          };
        },
      );
      membersOut.sort((a, b) => a.name.localeCompare(b.name, "da"));

      // Navne + valgmuligheder til "tilføj række"
      const rowProjectIds = [...new Set(rows.map((r) => r.projectId))];
      const [projectRows, activityRows] = await Promise.all([
        ctx.db
          .select({
            id: projects.id,
            name: projects.name,
            status: projects.status,
            clientName: clients.name,
          })
          .from(projects)
          .leftJoin(clients, eq(clients.id, projects.clientId))
          .where(
            and(
              eq(projects.organizationId, orgId),
              rowProjectIds.length > 0
                ? or(
                    inArray(projects.id, rowProjectIds),
                    inArray(projects.status, ["active", "on_hold"]),
                  )
                : inArray(projects.status, ["active", "on_hold"]),
            ),
          ),
        ctx.db
          .select({
            id: activityTypes.id,
            name: activityTypes.name,
            isArchived: activityTypes.isArchived,
          })
          .from(activityTypes)
          .where(eq(activityTypes.organizationId, orgId)),
      ]);
      const projectMap = new Map(projectRows.map((p) => [p.id, p]));
      const activityMap = new Map(activityRows.map((a) => [a.id, a.name]));

      const grid: ResourcePlanGrid = {
        weeks,
        today,
        members: membersOut,
        rows: rows
          // Kun org'ens projekter (tid på private projekter vises ikke)
          .filter((r) => projectMap.has(r.projectId))
          .map((r) => {
            const p = projectMap.get(r.projectId);
            return {
              ...r,
              projectName: p?.name ?? st("common.unknownProject"),
              clientName: p?.clientName ?? null,
              activityName: r.activityTypeId
                ? (activityMap.get(r.activityTypeId) ?? "Ukendt aktivitet")
                : null,
            };
          }),
      };

      return {
        ...grid,
        canPlan: access.canPlan,
        scope: access.scope,
        viewerId: ctx.session.user.id,
        options: access.canPlan
          ? {
              projects: projectRows
                .filter((p) => p.status === "active" || p.status === "on_hold")
                .map((p) => ({
                  id: p.id,
                  name: p.name,
                  clientName: p.clientName,
                }))
                .sort((a, b) => a.name.localeCompare(b.name, "da")),
              activityTypes: activityRows
                .filter((a) => !a.isArchived)
                .map((a) => ({ id: a.id, name: a.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "da")),
            }
          : null,
      };
    }),

  /**
   * Sæt planlagte timer for en eller flere celler (indtastning, "fyld
   * rækken", ryd række). 0 timer fjerner cellen.
   */
  setCells: subscribedProcedure
    .input(z.object({ cells: z.array(cellInput).min(1).max(400) }))
    .mutation(async ({ ctx, input }) => {
      const access = await loadAccess(ctx);
      if (!access.canPlan) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "resourcePlan.managersOnly"),
        });
      }
      const { orgId } = access;

      for (const c of input.cells) {
        if (toWeekStart(c.weekStart) !== c.weekStart) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "resourcePlan.weekMonday"),
          });
        }
        if (access.visibleUserIds && !access.visibleUserIds.has(c.userId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr(
              "serverErrors",
              "resourcePlan.ownEmployeesOnlyPlan",
            ),
          });
        }
      }

      const userIds = [...new Set(input.cells.map((c) => c.userId))];
      const projectIds = [...new Set(input.cells.map((c) => c.projectId))];
      const activityIds = [
        ...new Set(
          input.cells
            .map((c) => c.activityTypeId)
            .filter((id): id is string => id !== null),
        ),
      ];
      const [memberRows, projectRows, activityRows] = await Promise.all([
        ctx.db
          .select({ userId: members.userId })
          .from(members)
          .where(
            and(
              eq(members.organizationId, orgId),
              inArray(members.userId, userIds),
            ),
          ),
        ctx.db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.organizationId, orgId),
              inArray(projects.id, projectIds),
            ),
          ),
        activityIds.length > 0
          ? ctx.db
              .select({ id: activityTypes.id })
              .from(activityTypes)
              .where(
                and(
                  eq(activityTypes.organizationId, orgId),
                  inArray(activityTypes.id, activityIds),
                ),
              )
          : Promise.resolve([] as { id: string }[]),
      ]);
      if (
        memberRows.length !== userIds.length ||
        projectRows.length !== projectIds.length ||
        activityRows.length !== activityIds.length
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "resourcePlan.notInOrg"),
        });
      }

      const actorId = ctx.session.user.id;
      await ctx.db.transaction(async (tx) => {
        for (const c of input.cells) {
          const hours = Math.round(c.hours * 100) / 100;
          const activityCond =
            c.activityTypeId === null
              ? isNull(resourcePlanEntries.activityTypeId)
              : eq(resourcePlanEntries.activityTypeId, c.activityTypeId);
          if (hours <= 0) {
            await tx
              .delete(resourcePlanEntries)
              .where(
                and(
                  eq(resourcePlanEntries.organizationId, orgId),
                  eq(resourcePlanEntries.userId, c.userId),
                  eq(resourcePlanEntries.projectId, c.projectId),
                  activityCond,
                  eq(resourcePlanEntries.weekStart, c.weekStart),
                ),
              );
            continue;
          }
          const values = {
            organizationId: orgId,
            userId: c.userId,
            projectId: c.projectId,
            activityTypeId: c.activityTypeId,
            weekStart: c.weekStart,
            hours: hours.toFixed(2),
            updatedBy: actorId,
          };
          const set = {
            hours: values.hours,
            updatedBy: actorId,
            updatedAt: new Date(),
          };
          if (c.activityTypeId === null) {
            await tx
              .insert(resourcePlanEntries)
              .values(values)
              .onConflictDoUpdate({
                target: [
                  resourcePlanEntries.organizationId,
                  resourcePlanEntries.userId,
                  resourcePlanEntries.projectId,
                  resourcePlanEntries.weekStart,
                ],
                targetWhere: sql`activity_type_id IS NULL`,
                set,
              });
          } else {
            await tx
              .insert(resourcePlanEntries)
              .values(values)
              .onConflictDoUpdate({
                target: [
                  resourcePlanEntries.organizationId,
                  resourcePlanEntries.userId,
                  resourcePlanEntries.projectId,
                  resourcePlanEntries.activityTypeId,
                  resourcePlanEntries.weekStart,
                ],
                targetWhere: sql`activity_type_id IS NOT NULL`,
                set,
              });
          }
        }
      });
      return { updated: input.cells.length };
    }),
});
