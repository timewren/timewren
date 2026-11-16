import { st, tr } from "@/i18n/server-text";
// Fast arbejdsplan (#510, arbejdstidsloven § 4 b). Planer og tildelinger
// ændres kun fremadrettet; afvigelser skrives i samme transaktion som
// hændelsesloggen. Beregningen af dagene ligger i @/lib/enterprise/work-plan.

import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  departments,
  employeeProfiles,
  orgAuditLogs,
  users,
  workDayDeviations,
  workPlanAssignments,
  workPlans,
  workPlanVersions,
} from "@/lib/db/schema";
import { buildCsv } from "@/lib/enterprise/csv";
import { assertEntryEditable } from "@/lib/enterprise/edit-guard";
import { recalculateFlexDay } from "@/lib/enterprise/flex";
import {
  assertUserInScope,
  canSeeUser,
  getVisibleScope,
} from "@/lib/enterprise/scope";
import {
  DEVIATION_KINDS,
  exportHeaders,
  exportRows,
  inheritedRotationAnchor,
  MAX_DEVIATION_NOTE,
  MAX_PLAN_NAME,
  normalizeDeviation,
  validateWeeks,
  versionAt,
  WORK_PLAN_PRESETS,
  weeklyHours,
} from "@/lib/enterprise/work-plan";
import {
  loadPlanLookups,
  loadPlanMembers,
  loadRegisteredDays,
} from "@/lib/enterprise/work-plan-load";
import { auditDiff, formatUserLabel, logOrgAudit } from "@/lib/org-audit";
import { roleCanWriteTeam } from "@/lib/permissions/org-role";
import { addDaysToDateStr, copenhagenToday } from "@/lib/time/copenhagen";
import { router } from "../../trpc";
import {
  assertTwoFactorIfRequired,
  organizationProcedure,
  orgManagerProcedure,
  orgManagerReadProcedure,
} from "./middleware";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const weeksInput = z
  .array(
    z
      .array(
        z.object({
          weekday: z.number().int().min(1).max(7),
          start: timeString,
          end: timeString,
          breakMinutes: z.number().int().min(0).max(240),
        }),
      )
      .max(7),
  )
  .min(1)
  .max(2);

const MAX_VIEW_DAYS = 62;
const MAX_EXPORT_DAYS = 731;

function daysBetween(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000 +
    1
  );
}

function assertRange(from: string, to: string, max: number) {
  if (from > to) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: st("enterprise.fromBeforeTo"),
    });
  }
  if (daysBetween(from, to) > max) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: st("enterprise.periodMaxDays", { days: max }),
    });
  }
}

function assertWeeks(weeks: z.infer<typeof weeksInput>, rotation: number) {
  const error = validateWeeks(weeks, rotation);
  if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error });
}

/** Ændringer gælder tidligst fra i dag — fortiden står fast (§ 4 b, stk. 3). */
function assertNotPast(validFrom: string) {
  if (validFrom < copenhagenToday()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: st("enterprise.workPlans.notBackwards"),
    });
  }
}

type Ctx = {
  db: typeof import("@/lib/db").db;
  orgId: string;
  orgRole: string;
  employeeProfileId: string;
  session: { user: { id: string } };
};

/**
 * Hvem dagene vises/rettes for: dig selv, eller (leder/HR) en medarbejder
 * i dit scope. Skrivning for andre kræver skrive-tier (ikke HR).
 */
async function resolveTarget(
  ctx: Ctx,
  userId: string | undefined,
  mode: "read" | "write",
): Promise<{ userId: string; onBehalf: boolean }> {
  const self = ctx.session.user.id;
  if (!userId || userId === self) return { userId: self, onBehalf: false };
  const canRead =
    roleCanWriteTeam(ctx.orgRole as never) || ctx.orgRole === "hr";
  if (mode === "write" ? !roleCanWriteTeam(ctx.orgRole as never) : !canRead) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        mode === "write"
          ? await tr("serverErrors", "enterprise.workPlans.managersOnlyEdit")
          : await tr("serverErrors", "enterprise.workPlans.ownOnlyView"),
    });
  }
  await assertTwoFactorIfRequired(ctx.db, ctx.orgId, self);
  await assertMemberOfOrg(ctx, userId);
  await assertUserInScope(ctx.db, ctx as never, userId);
  return { userId, onBehalf: true };
}

/**
 * Brugeren skal have en medarbejderprofil i org'en — scope "alle"
 * (admin/hr) springer ellers eksistens-tjekket over.
 */
async function assertMemberOfOrg(ctx: Ctx, userId: string) {
  const profile = await ctx.db.query.employeeProfiles.findFirst({
    where: and(
      eq(employeeProfiles.organizationId, ctx.orgId),
      eq(employeeProfiles.userId, userId),
    ),
    columns: { id: true },
  });
  if (!profile) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr(
        "serverErrors",
        "enterprise.workPlans.employeeNotInOrg",
      ),
    });
  }
}

/**
 * At ændre eller arkivere en delt plan rammer alle, der følger den. En
 * leder må kun, når alle nuværende/fremtidige tildelinger er personer i
 * lederens scope; afdelingstildelinger kræver admin/owner.
 */
async function assertCanChangePlan(ctx: Ctx, planId: string) {
  if (ctx.orgRole === "admin" || ctx.orgRole === "owner") return;
  const rows = await ctx.db.query.workPlanAssignments.findMany({
    where: and(
      eq(workPlanAssignments.organizationId, ctx.orgId),
      eq(workPlanAssignments.planId, planId),
      or(
        sql`${workPlanAssignments.validTo} IS NULL`,
        gte(workPlanAssignments.validTo, copenhagenToday()),
      ),
    ),
    columns: { userId: true, departmentId: true },
  });
  if (rows.length === 0) return;
  const scope = await getVisibleScope(ctx.db, ctx as never);
  if (rows.some((r) => !r.userId || !canSeeUser(scope, r.userId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "enterprise.workPlans.sharedPlan"),
    });
  }
}

async function loadPlanOrThrow(ctx: Ctx, planId: string) {
  const plan = await ctx.db.query.workPlans.findFirst({
    where: and(
      eq(workPlans.id, planId),
      eq(workPlans.organizationId, ctx.orgId),
    ),
  });
  if (!plan) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.workPlans.planMissing"),
    });
  }
  return plan;
}

const deviationInput = z.object({
  date: dateString,
  userId: z.string().optional(),
  kind: z.enum(DEVIATION_KINDS),
  startTime: timeString.nullish(),
  endTime: timeString.nullish(),
  breakMinutes: z.number().int().min(0).max(600).nullish(),
  hours: z.number().min(0).max(24).nullish(),
  note: z.string().max(MAX_DEVIATION_NOTE).nullish(),
});

function deviationSnapshot(
  row:
    | {
        kind: string;
        startTime: string | null;
        endTime: string | null;
        breakMinutes: number | null;
        hours: string | number;
      }
    | null
    | undefined,
): Record<string, unknown> {
  if (!row) return {};
  return {
    kind: row.kind,
    startTime: row.startTime,
    endTime: row.endTime,
    breakMinutes: row.breakMinutes,
    hours: Number(row.hours),
  };
}

export const enterpriseWorkPlansRouter = router({
  /** Planer med versioner og tildelinger + vælgere (leder/HR/admin). */
  workPlanList: orgManagerReadProcedure.query(async ({ ctx }) => {
    const scope = await getVisibleScope(ctx.db, ctx);
    const [plans, versions, assignments, depts, people] = await Promise.all([
      ctx.db.query.workPlans.findMany({
        where: eq(workPlans.organizationId, ctx.orgId),
        orderBy: [asc(workPlans.isArchived), asc(workPlans.name)],
      }),
      ctx.db.query.workPlanVersions.findMany({
        where: eq(workPlanVersions.organizationId, ctx.orgId),
        orderBy: [asc(workPlanVersions.validFrom)],
      }),
      ctx.db.query.workPlanAssignments.findMany({
        where: and(
          eq(workPlanAssignments.organizationId, ctx.orgId),
          or(
            sql`${workPlanAssignments.validTo} IS NULL`,
            gte(workPlanAssignments.validTo, copenhagenToday()),
          ),
        ),
        orderBy: [asc(workPlanAssignments.validFrom)],
      }),
      ctx.db.query.departments.findMany({
        where: and(
          eq(departments.organizationId, ctx.orgId),
          eq(departments.isArchived, false),
        ),
        columns: { id: true, name: true },
        orderBy: [asc(departments.name)],
      }),
      ctx.db
        .select({
          userId: employeeProfiles.userId,
          departmentId: employeeProfiles.departmentId,
          name: users.name,
          email: users.email,
        })
        .from(employeeProfiles)
        .innerJoin(users, eq(users.id, employeeProfiles.userId))
        .where(
          and(
            eq(employeeProfiles.organizationId, ctx.orgId),
            eq(employeeProfiles.isActive, true),
          ),
        )
        .orderBy(asc(users.name)),
    ]);
    const visiblePeople = people.filter((p) => canSeeUser(scope, p.userId));
    const visibleIds = new Set(visiblePeople.map((p) => p.userId));
    return {
      today: copenhagenToday(),
      canAssignDepartments: ctx.orgRole === "admin" || ctx.orgRole === "owner",
      canWrite: roleCanWriteTeam(ctx.orgRole),
      plans: plans.map((p) => {
        const own = versions.filter((v) => v.planId === p.id);
        return {
          ...p,
          versions: own.map((v) => ({
            ...v,
            weeklyHours: weeklyHours(v.weeks),
          })),
        };
      }),
      assignments: assignments.filter(
        (a) => !a.userId || visibleIds.has(a.userId),
      ),
      departments: depts,
      employees: visiblePeople.map((p) => ({
        userId: p.userId,
        departmentId: p.departmentId,
        label: p.name || p.email,
      })),
    };
  }),

  workPlanCreate: orgManagerProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(MAX_PLAN_NAME),
        preset: z.enum(WORK_PLAN_PRESETS).nullish(),
        rotationWeeks: z.union([z.literal(1), z.literal(2)]),
        weeks: weeksInput,
        validFrom: dateString,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertWeeks(input.weeks, input.rotationWeeks);
      assertNotPast(input.validFrom);
      return ctx.db.transaction(async (tx) => {
        const [plan] = await tx
          .insert(workPlans)
          .values({
            organizationId: ctx.orgId,
            name: input.name,
            preset: input.preset ?? null,
            createdBy: ctx.session.user.id,
          })
          .returning();
        await tx.insert(workPlanVersions).values({
          organizationId: ctx.orgId,
          planId: plan.id,
          validFrom: input.validFrom,
          rotationWeeks: input.rotationWeeks,
          weeks: input.weeks,
          createdBy: ctx.session.user.id,
        });
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "work_plan_created",
          {
            metadata: {
              planId: plan.id,
              name: plan.name,
              validFrom: input.validFrom,
              rotationWeeks: input.rotationWeeks,
              weeklyHours: weeklyHours(input.weeks),
            },
          },
        );
        return plan;
      });
    }),

  /**
   * Ny version fra en dato (i dag eller senere). En version der endnu ikke
   * er trådt i kraft, kan overskrives; en der gælder i dag, kan ikke.
   */
  workPlanSaveVersion: orgManagerProcedure
    .input(
      z.object({
        planId: z.string().uuid(),
        name: z.string().trim().min(1).max(MAX_PLAN_NAME).optional(),
        rotationWeeks: z.union([z.literal(1), z.literal(2)]),
        weeks: weeksInput,
        validFrom: dateString,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertWeeks(input.weeks, input.rotationWeeks);
      assertNotPast(input.validFrom);
      const plan = await loadPlanOrThrow(ctx, input.planId);
      if (plan.isArchived) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.workPlans.planArchived",
          ),
        });
      }
      await assertCanChangePlan(ctx, plan.id);
      const today = copenhagenToday();
      return ctx.db.transaction(async (tx) => {
        const versions = await tx.query.workPlanVersions.findMany({
          where: eq(workPlanVersions.planId, plan.id),
        });
        const existing = versions.find((v) => v.validFrom === input.validFrom);
        const later = versions
          .filter((v) => v.validFrom > input.validFrom)
          .sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
        if (later) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr(
              "serverErrors",
              "enterprise.workPlans.laterVersion",
              { date: later.validFrom },
            ),
          });
        }
        // Fortsæt uge A/B-rotationen fra versionen før, så en rettelse midt
        // i en uge B ikke bytter om på ugerne
        const rotationAnchor = inheritedRotationAnchor(
          versionAt(
            versions.filter((v) => v.validFrom < input.validFrom),
            input.validFrom,
          ),
          input.rotationWeeks,
        );
        if (existing && existing.validFrom <= today) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr(
              "serverErrors",
              "enterprise.workPlans.versionFromToday",
            ),
          });
        }
        if (existing) {
          await tx
            .update(workPlanVersions)
            .set({
              rotationWeeks: input.rotationWeeks,
              rotationAnchor,
              weeks: input.weeks,
              createdBy: ctx.session.user.id,
            })
            .where(eq(workPlanVersions.id, existing.id));
        } else {
          await tx.insert(workPlanVersions).values({
            organizationId: ctx.orgId,
            planId: plan.id,
            validFrom: input.validFrom,
            rotationWeeks: input.rotationWeeks,
            rotationAnchor,
            weeks: input.weeks,
            createdBy: ctx.session.user.id,
          });
        }
        if (input.name && input.name !== plan.name) {
          await tx
            .update(workPlans)
            .set({ name: input.name, updatedAt: new Date() })
            .where(eq(workPlans.id, plan.id));
        }
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "work_plan_updated",
          {
            metadata: {
              planId: plan.id,
              name: input.name ?? plan.name,
              validFrom: input.validFrom,
              rotationWeeks: input.rotationWeeks,
              weeklyHours: weeklyHours(input.weeks),
              replacedFutureVersion: !!existing,
              previousWeeklyHours: existing
                ? weeklyHours(existing.weeks)
                : undefined,
            },
          },
        );
        return { ok: true };
      });
    }),

  /** Arkivér: tildelinger slutter i dag, fremtidige fjernes. */
  workPlanArchive: orgManagerProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await loadPlanOrThrow(ctx, input.planId);
      await assertCanChangePlan(ctx, plan.id);
      const today = copenhagenToday();
      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(workPlanAssignments)
          .where(
            and(
              eq(workPlanAssignments.planId, plan.id),
              sql`${workPlanAssignments.validFrom} > ${today}`,
            ),
          );
        await tx
          .update(workPlanAssignments)
          .set({ validTo: today })
          .where(
            and(
              eq(workPlanAssignments.planId, plan.id),
              or(
                sql`${workPlanAssignments.validTo} IS NULL`,
                sql`${workPlanAssignments.validTo} > ${today}`,
              ),
            ),
          );
        await tx
          .update(workPlans)
          .set({ isArchived: true, updatedAt: new Date() })
          .where(eq(workPlans.id, plan.id));
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "work_plan_archived",
          {
            metadata: { planId: plan.id, name: plan.name },
          },
        );
      });
      return { ok: true };
    }),

  /**
   * Tildel (eller fjern, planId null) en plan for en medarbejder eller en
   * afdeling fra en dato. Den hidtidige tildeling slutter dagen før;
   * tildelinger der endnu ikke er trådt i kraft, erstattes.
   */
  workPlanAssign: orgManagerProcedure
    .input(
      z
        .object({
          planId: z.string().uuid().nullable(),
          userId: z.string().optional(),
          departmentId: z.string().uuid().optional(),
          validFrom: dateString,
        })
        .refine((v) => !!v.userId !== !!v.departmentId, {
          error: () => st("zod.employeeOrDepartment"),
        }),
    )
    .mutation(async ({ ctx, input }) => {
      assertNotPast(input.validFrom);
      let departmentName: string | null = null;
      if (input.departmentId) {
        if (ctx.orgRole !== "admin" && ctx.orgRole !== "owner") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr(
              "serverErrors",
              "enterprise.workPlans.adminsOnlyDept",
            ),
          });
        }
        const dept = await ctx.db.query.departments.findFirst({
          where: and(
            eq(departments.id, input.departmentId),
            eq(departments.organizationId, ctx.orgId),
          ),
          columns: { name: true },
        });
        if (!dept) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr(
              "serverErrors",
              "enterprise.workPlans.departmentMissing",
            ),
          });
        }
        departmentName = dept.name;
      }
      if (input.userId) {
        await assertMemberOfOrg(ctx, input.userId);
        await assertUserInScope(ctx.db, ctx, input.userId);
      }
      const plan = input.planId
        ? await loadPlanOrThrow(ctx, input.planId)
        : null;
      if (plan?.isArchived) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.workPlans.planArchived",
          ),
        });
      }
      const target = input.userId
        ? eq(workPlanAssignments.userId, input.userId)
        : eq(workPlanAssignments.departmentId, input.departmentId as string);
      const dayBefore = addDaysToDateStr(input.validFrom, -1);

      await ctx.db.transaction(async (tx) => {
        // Ikke-ikrafttrådte tildelinger fra samme dato eller senere erstattes
        const replaced = await tx
          .delete(workPlanAssignments)
          .where(
            and(
              eq(workPlanAssignments.organizationId, ctx.orgId),
              target,
              gte(workPlanAssignments.validFrom, input.validFrom),
            ),
          )
          .returning({
            planId: workPlanAssignments.planId,
            validFrom: workPlanAssignments.validFrom,
          });
        // Den løbende tildeling slutter dagen før
        await tx
          .update(workPlanAssignments)
          .set({ validTo: dayBefore })
          .where(
            and(
              eq(workPlanAssignments.organizationId, ctx.orgId),
              target,
              lt(workPlanAssignments.validFrom, input.validFrom),
              or(
                sql`${workPlanAssignments.validTo} IS NULL`,
                gte(workPlanAssignments.validTo, input.validFrom),
              ),
            ),
          );
        if (plan) {
          await tx.insert(workPlanAssignments).values({
            organizationId: ctx.orgId,
            planId: plan.id,
            userId: input.userId ?? null,
            departmentId: input.departmentId ?? null,
            validFrom: input.validFrom,
            createdBy: ctx.session.user.id,
          });
        }
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "work_plan_assigned",
          {
            targetUserId: input.userId,
            metadata: {
              planId: plan?.id ?? null,
              planName: plan?.name ?? null,
              departmentId: input.departmentId ?? null,
              departmentName,
              validFrom: input.validFrom,
              replacedFutureAssignments:
                replaced.length > 0 ? replaced : undefined,
            },
          },
        );
      });
      return { ok: true };
    }),

  /** Dagene i perioden: plan, afvigelse og registreret arbejdstid. */
  workPlanDays: organizationProcedure
    .input(
      z.object({
        from: dateString,
        to: dateString,
        userId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertRange(input.from, input.to, MAX_VIEW_DAYS);
      const target = await resolveTarget(ctx, input.userId, "read");
      const members = await loadPlanMembers(ctx.db, ctx.orgId, [target.userId]);
      const registered = await loadRegisteredDays(
        ctx.db,
        ctx.orgId,
        members,
        input.from,
        input.to,
      );
      const days = registered.get(target.userId) ?? [];
      return {
        today: copenhagenToday(),
        hasPlan: days.length > 0,
        days,
        totals: {
          planned:
            Math.round(
              days.reduce((s, d) => s + (d.planned?.hours ?? 0), 0) * 100,
            ) / 100,
          registered:
            Math.round(days.reduce((s, d) => s + d.hours, 0) * 100) / 100,
          deviations: days.filter((d) => d.status === "deviation").length,
        },
      };
    }),

  workPlanSetDeviation: organizationProcedure
    .input(deviationInput)
    .mutation(async ({ ctx, input }) => {
      const target = await resolveTarget(ctx, input.userId, "write");
      const normalized = normalizeDeviation(input);
      if (!normalized.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: normalized.error });
      }
      // Afvigelser registreres, når de sker (i dag eller bagud). Planlagt
      // fravær hører til i fraværsmodulet — og en fremtidig afvigelse ville
      // skrive flex-rækker for dage, der ikke er sket endnu.
      if (input.date > copenhagenToday()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.workPlans.deviationsRecorded",
          ),
        });
      }
      const members = await loadPlanMembers(ctx.db, ctx.orgId, [target.userId]);
      const plan = (await loadPlanLookups(ctx.db, ctx.orgId, members)).get(
        target.userId,
      );
      if (!plan?.hasPlan(input.date)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.workPlans.noFixedPlanToday",
          ),
        });
      }
      const note = input.note?.trim() || null;
      await ctx.db.transaction(async (tx) => {
        await assertEntryEditable(tx, {
          orgId: ctx.orgId,
          userId: target.userId,
          dates: [input.date],
          role: ctx.orgRole,
          actorUserId: ctx.session.user.id,
        });
        const existing = await tx.query.workDayDeviations.findFirst({
          where: and(
            eq(workDayDeviations.organizationId, ctx.orgId),
            eq(workDayDeviations.userId, target.userId),
            eq(workDayDeviations.date, input.date),
          ),
        });
        const values = {
          kind: normalized.value.kind,
          startTime: normalized.value.startTime,
          endTime: normalized.value.endTime,
          breakMinutes: normalized.value.breakMinutes,
          hours: String(normalized.value.hours),
          note,
          updatedBy: ctx.session.user.id,
          updatedAt: new Date(),
        };
        await tx
          .insert(workDayDeviations)
          .values({
            ...values,
            organizationId: ctx.orgId,
            userId: target.userId,
            date: input.date,
            createdBy: ctx.session.user.id,
          })
          .onConflictDoUpdate({
            target: [
              workDayDeviations.organizationId,
              workDayDeviations.userId,
              workDayDeviations.date,
            ],
            set: values,
          });
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "work_day_deviation_set",
          {
            targetUserId: target.userId,
            metadata: {
              date: input.date,
              onBehalf: target.onBehalf,
              noteChanged: (existing?.note ?? null) !== note,
              diff: auditDiff(
                deviationSnapshot(existing),
                deviationSnapshot({ ...normalized.value }),
              ),
            },
          },
        );
      });
      await recalculateFlexDay(ctx.db, {
        userId: target.userId,
        orgId: ctx.orgId,
        date: input.date,
      });
      return { ok: true };
    }),

  workPlanClearDeviation: organizationProcedure
    .input(z.object({ date: dateString, userId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const target = await resolveTarget(ctx, input.userId, "write");
      const removed = await ctx.db.transaction(async (tx) => {
        await assertEntryEditable(tx, {
          orgId: ctx.orgId,
          userId: target.userId,
          dates: [input.date],
          role: ctx.orgRole,
          actorUserId: ctx.session.user.id,
        });
        const [row] = await tx
          .delete(workDayDeviations)
          .where(
            and(
              eq(workDayDeviations.organizationId, ctx.orgId),
              eq(workDayDeviations.userId, target.userId),
              eq(workDayDeviations.date, input.date),
            ),
          )
          .returning();
        if (!row) return false;
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "work_day_deviation_cleared",
          {
            targetUserId: target.userId,
            metadata: {
              date: input.date,
              onBehalf: target.onBehalf,
              noteChanged: row.note != null,
              diff: auditDiff(deviationSnapshot(row), {
                kind: null,
                startTime: null,
                endTime: null,
                breakMinutes: null,
                hours: null,
              }),
            },
          },
        );
        return true;
      });
      if (removed) {
        await recalculateFlexDay(ctx.db, {
          userId: target.userId,
          orgId: ctx.orgId,
          date: input.date,
        });
      }
      return { ok: removed };
    }),

  /** Ændringsloggen for en medarbejders afvigelser (hvem/hvornår). */
  workPlanDeviationLog: organizationProcedure
    .input(z.object({ userId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const target = await resolveTarget(ctx, input.userId, "read");
      const rows = await ctx.db.query.orgAuditLogs.findMany({
        where: and(
          eq(orgAuditLogs.organizationId, ctx.orgId),
          eq(orgAuditLogs.targetUserId, target.userId),
          inArray(orgAuditLogs.action, [
            "work_day_deviation_set",
            "work_day_deviation_cleared",
            "work_plan_assigned",
          ]),
        ),
        orderBy: [desc(orgAuditLogs.createdAt)],
        limit: 100,
      });
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorLabel: r.actorLabel,
        createdAt: r.createdAt,
        metadata: r.metadata as Record<string, unknown> | null,
      }));
    }),

  /** CSV med de registrerede dage (§ 4 b, stk. 2: adgang til egne data). */
  workPlanExport: organizationProcedure
    .input(
      z.object({
        from: dateString,
        to: dateString,
        userId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertRange(input.from, input.to, MAX_EXPORT_DAYS);
      const target = await resolveTarget(ctx, input.userId, "read");
      const members = await loadPlanMembers(ctx.db, ctx.orgId, [target.userId]);
      const registered = await loadRegisteredDays(
        ctx.db,
        ctx.orgId,
        members,
        input.from,
        input.to,
      );
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, target.userId),
        columns: { name: true, email: true },
      });
      const label = formatUserLabel(user) ?? target.userId;
      const days = registered.get(target.userId) ?? [];
      const csv = buildCsv(exportHeaders(), exportRows(days));
      return {
        filename: `arbejdstid-${input.from}-${input.to}.csv`,
        csv,
        label,
        rows: days.length,
      };
    }),
});
