import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import type { db as dbClient } from "@/lib/db";
import {
  absenceRequests,
  employeeProfiles,
  organizations,
  overtimeLedger,
  timeEntries,
  timesheetWeekEvents,
  timesheetWeeks,
} from "@/lib/db/schema";
import { absenceCoversDate } from "@/lib/enterprise/absence-registration";
import {
  getEmploymentBatch,
  makeDayResolver,
} from "@/lib/enterprise/employment";
import { insertOvertimeLedger } from "@/lib/enterprise/overtime-ledger";
import {
  MAX_UNLOCK_REASON,
  MIN_UNLOCK_REASON,
} from "@/lib/enterprise/period-closing";
import { isWeekClosingLocked } from "@/lib/enterprise/period-closing-lock";
import {
  assertUserInScope,
  getVisibleScope,
  profileScopeCondition,
  type ScopeCtx,
} from "@/lib/enterprise/scope";
import { loadTeamBalances } from "@/lib/enterprise/team-balances";
import {
  ownTimeEntriesInOrg,
  usersTimeEntriesInOrg,
} from "@/lib/enterprise/time-entry-scope";
import { insertTimesheetWeekEvent } from "@/lib/enterprise/timesheet-events";
import {
  canApproveWeek,
  canRejectWeek,
  canReopenWeek,
} from "@/lib/enterprise/timesheet-week-status";
import { getVacationOrgSettings } from "@/lib/enterprise/vacation";
import { vacationPeriodFor } from "@/lib/enterprise/vacation-period";
import { loadOrgWorkSettings } from "@/lib/enterprise/work-settings";
import { workShareOn } from "@/lib/holidays/danish";
import { loadDayOffLookupsForUsers } from "@/lib/holidays/load";
import { notify } from "@/lib/notifications/bus";
import {
  formatUserLabel,
  logOrgAudit,
  resolveUserLabel,
} from "@/lib/org-audit";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { copenhagenDateSql } from "@/lib/time/date-bounds";
import { router } from "../../trpc";
import { orgManagerProcedure, orgManagerReadProcedure } from "./middleware";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type FailedItem = { id: string; name: string; message: string };

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Db = typeof dbClient;

type TeamCtx = ScopeCtx;

/**
 * Profiler lederen må behandle: afdelinger hvor lederen er lead/deputy ∪
 * direkte reports (managerId) ∪ sig selv; admin/owner ser hele org'en.
 * Fælles scope-logik i src/lib/enterprise/scope.ts (#464).
 */
async function getManagedProfiles(db: Db, ctx: TeamCtx, departmentId?: string) {
  const scope = await getVisibleScope(db, ctx);
  return db.query.employeeProfiles.findMany({
    where: and(
      eq(employeeProfiles.organizationId, ctx.orgId),
      eq(employeeProfiles.isActive, true),
      profileScopeCondition(scope),
      departmentId
        ? eq(employeeProfiles.departmentId, departmentId)
        : undefined,
    ),
    with: {
      user: { columns: { id: true, name: true, email: true, image: true } },
    },
    orderBy: [asc(employeeProfiles.createdAt)],
  });
}

/** Guard: må ctx behandle denne medarbejders uge? Returnerer profilen. */
async function requireManagedProfile(
  db: Db,
  ctx: TeamCtx,
  targetUserId: string,
) {
  await assertUserInScope(
    db,
    ctx,
    targetUserId,
    await tr("serverErrors", "enterprise.team.timesheetsOwnEmployees"),
  );
  const profile = await db.query.employeeProfiles.findFirst({
    where: and(
      eq(employeeProfiles.userId, targetUserId),
      eq(employeeProfiles.organizationId, ctx.orgId),
    ),
    with: { user: { columns: { id: true, name: true, email: true } } },
  });
  if (!profile) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.team.employeeNotInOrg"),
    });
  }
  return profile;
}

type ApproveCtx = TeamCtx & {
  db: Db;
  session: { user: { id: string; name?: string | null } };
};

/**
 * Godkend (og lås) én medarbejders uge. Delt af approveTimesheetWeek og
 * approveDepartmentWeek. Kalderen har allerede verificeret scope.
 */
async function approveWeekForUser(
  ctx: ApproveCtx,
  input: { userId: string; weekStart: string },
  /** Forud-opløste labels fra bulk-godkendelse (#479) — spar opslag */
  knownLabels?: { actorLabel: string | null; userLabel: string | null },
) {
  const weekStart = parseLocalDate(input.weekStart);
  const weekEnd = addDays(weekStart, 7);
  const now = new Date();
  // Labels opløses én gang pr. kald og gives videre til hændelse + audit
  const userLabel =
    knownLabels?.userLabel ?? (await resolveUserLabel(ctx.db, input.userId));
  const actorLabel =
    knownLabels?.actorLabel ??
    (await resolveUserLabel(ctx.db, ctx.session.user.id));

  const existing = await ctx.db.query.timesheetWeeks.findFirst({
    where: and(
      eq(timesheetWeeks.userId, input.userId),
      eq(timesheetWeeks.organizationId, ctx.orgId),
      eq(timesheetWeeks.weekStart, input.weekStart),
    ),
  });

  // Godkend uden forudgående indsendelse er tilladt (leder-initieret),
  // men der skal være registreringer.
  const totals = await ctx.db
    .select({
      total: sql<string>`COALESCE(SUM(${timeEntries.hours}::numeric), 0)`,
    })
    .from(timeEntries)
    .where(
      and(
        ownTimeEntriesInOrg(input.userId, ctx.orgId),
        gte(timeEntries.date, weekStart),
        lt(timeEntries.date, weekEnd),
      ),
    );
  const totalHours = Number(totals[0]?.total ?? 0);
  if (totalHours <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "enterprise.team.weekNothingToApprove"),
    });
  }

  if (existing && !canApproveWeek(existing.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "enterprise.team.weekAlreadyApproved"),
    });
  }

  // Statusændring, hændelse (#466), låsning af poster og overtid i ÉN
  // transaktion, så godkendelseshistorikken aldrig kan afvige fra status.
  const overtimeEarned = await ctx.db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(timesheetWeeks)
        .set({
          status: "approved",
          totalHours: totalHours.toFixed(2),
          decidedBy: ctx.session.user.id,
          decidedAt: now,
          rejectionReason: null,
          updatedAt: now,
        })
        .where(eq(timesheetWeeks.id, existing.id));
    } else {
      await tx.insert(timesheetWeeks).values({
        userId: input.userId,
        organizationId: ctx.orgId,
        weekStart: input.weekStart,
        status: "approved",
        totalHours: totalHours.toFixed(2),
        submittedAt: now,
        decidedBy: ctx.session.user.id,
        decidedAt: now,
      });
    }

    await insertTimesheetWeekEvent(tx, {
      organizationId: ctx.orgId,
      userId: input.userId,
      weekStart: input.weekStart,
      event: "approved",
      actorId: ctx.session.user.id,
      totalHours: totalHours.toFixed(2),
      userLabel,
      actorLabel,
    });
    await logOrgAudit(
      tx,
      ctx.orgId,
      ctx.session.user.id,
      "timesheet_week_approved",
      {
        actorLabel,
        targetUserId: input.userId,
        metadata: {
          weekStart: input.weekStart,
          totalHours,
          previousStatus: existing?.status ?? null,
        },
      },
    );

    await tx
      .update(timeEntries)
      .set({
        approvalStatus: "approved",
        approvedAt: now,
        approvedBy: ctx.session.user.id,
        updatedAt: now,
      })
      .where(
        and(
          ownTimeEntriesInOrg(input.userId, ctx.orgId),
          gte(timeEntries.date, weekStart),
          lt(timeEntries.date, weekEnd),
        ),
      );

    // Overtid: timer over org-tærsklen flyttes til overtidssaldoen.
    // Idempotent: tidligere auto-postering for ugen erstattes.
    const org = await tx.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
      columns: { overtimeThresholdHours: true },
    });
    const threshold = org?.overtimeThresholdHours
      ? Number(org.overtimeThresholdHours)
      : null;
    await tx
      .delete(overtimeLedger)
      .where(
        and(
          eq(overtimeLedger.organizationId, ctx.orgId),
          eq(overtimeLedger.userId, input.userId),
          eq(overtimeLedger.type, "earned"),
          eq(overtimeLedger.weekStart, input.weekStart),
        ),
      );
    let earned = 0;
    if (threshold !== null && totalHours > threshold) {
      earned = Math.round((totalHours - threshold) * 100) / 100;
      await insertOvertimeLedger(tx, {
        organizationId: ctx.orgId,
        userId: input.userId,
        type: "earned",
        hours: earned.toFixed(2),
        weekStart: input.weekStart,
        note: `Uge godkendt: ${totalHours.toFixed(2).replace(".", ",")} t mod tærskel ${threshold.toFixed(1).replace(".", ",")} t`,
        createdBy: ctx.session.user.id,
      });
    }
    return earned;
  });

  // Besked til medarbejderen via notifikationsbussen (E10, best effort —
  // ingen DB-opslag efter commit, så en gennemført godkendelse aldrig vælter)
  void notify({
    orgId: ctx.orgId,
    event: "timesheet.approved",
    payload: {
      managerName:
        ctx.session.user.name ??
        (await tr("serverErrors", "enterprise.yourManager")),
      weekStart: input.weekStart,
    },
    userIds: [input.userId],
  });

  return { status: "approved" as const, totalHours, overtimeEarned };
}

export const enterpriseTeamRouter = router({
  /**
   * getTeamWeekOverview — ugestatus pr. medarbejder: timer pr. dag, total,
   * normtid, komplethed og godkendelsesstatus.
   */
  getTeamWeekOverview: orgManagerProcedure
    .input(
      z.object({ weekStart: dateString, departmentId: z.string().optional() }),
    )
    .query(async ({ ctx, input }) => {
      const weekStart = parseLocalDate(input.weekStart);
      const weekEnd = addDays(weekStart, 7);
      const days = Array.from({ length: 7 }, (_, i) =>
        toDateStr(addDays(weekStart, i)),
      );
      const weekEndStr = days[6];

      const profiles = await getManagedProfiles(
        ctx.db,
        ctx,
        input.departmentId,
      );
      if (profiles.length === 0) {
        return { days, members: [] };
      }
      const userIds = profiles.map((p) => p.userId);

      const [dailyTotals, weekRows, dayOffByUser, weekAbsences, orgSettings] =
        await Promise.all([
          ctx.db
            .select({
              userId: timeEntries.userId,
              day: copenhagenDateSql(timeEntries.date),
              total: sql<string>`SUM(${timeEntries.hours}::numeric)`,
            })
            .from(timeEntries)
            .where(
              and(
                usersTimeEntriesInOrg(userIds, ctx.orgId),
                gte(timeEntries.date, weekStart),
                lt(timeEntries.date, weekEnd),
              ),
            )
            .groupBy(timeEntries.userId, copenhagenDateSql(timeEntries.date)),
          ctx.db.query.timesheetWeeks.findMany({
            where: and(
              eq(timesheetWeeks.organizationId, ctx.orgId),
              eq(timesheetWeeks.weekStart, input.weekStart),
              inArray(timesheetWeeks.userId, userIds),
            ),
          }),
          // Fridagskalender pr. medarbejder (#526): afdeling > org > egen
          loadDayOffLookupsForUsers(
            ctx.db,
            ctx.orgId,
            profiles.map((p) => ({
              userId: p.userId,
              departmentId: p.departmentId,
            })),
          ),
          ctx.db.query.absenceRequests.findMany({
            where: and(
              eq(absenceRequests.organizationId, ctx.orgId),
              eq(absenceRequests.status, "approved"),
              inArray(absenceRequests.userId, userIds),
              lte(absenceRequests.startDate, weekEndStr),
              // Åben periode (endDate NULL, #460) dækker til og med i dag
              or(
                isNull(absenceRequests.endDate),
                gte(absenceRequests.endDate, input.weekStart),
              ),
            ),
            with: { absenceType: { columns: { name: true, color: true } } },
          }),
          loadOrgWorkSettings(ctx.db, ctx.orgId),
        ]);

      const totalsByUser = new Map<string, Record<string, number>>();
      for (const row of dailyTotals) {
        const dayStr = toDateStr(new Date(row.day));
        const map = totalsByUser.get(row.userId) ?? {};
        map[dayStr] = Math.round(Number(row.total) * 100) / 100;
        totalsByUser.set(row.userId, map);
      }
      const weekRowByUser = new Map(weekRows.map((w) => [w.userId, w]));
      const today = copenhagenToday();
      // Ansættelseshistorik (#465): normen pr. dag følger perioden på dagen
      const employment = await getEmploymentBatch(
        ctx.db,
        ctx.orgId,
        profiles.map((p) => p.userId),
      );

      const members = profiles.map((p) => {
        const perDay = totalsByUser.get(p.userId) ?? {};
        const total =
          Math.round(days.reduce((sum, d) => sum + (perDay[d] ?? 0), 0) * 100) /
          100;

        // Normtid for ugen: arbejdsdage minus helligdage og godkendt fravær
        const dayOff = dayOffByUser.get(p.userId);
        const resolveDay = makeDayResolver(
          employment.periodsFor(p.userId),
          p,
          orgSettings,
        );
        let norm = 0;
        const absenceByDay: Record<string, { name: string; color: string }> =
          {};
        for (const dayStr of days) {
          const d = parseLocalDate(dayStr);
          const isoDay = d.getDay() === 0 ? "7" : String(d.getDay());
          const day = resolveDay(dayStr);
          if (!day) continue;
          const { dailyNorm, workingDays } = day;
          if (!workingDays.includes(isoDay)) continue;
          // Hel fridag = ingen norm; halv fridag = halv norm (som flex)
          const share = dayOff ? workShareOn(dayOff, dayStr) : 1;
          if (share === 0) continue;
          const absence = weekAbsences.find(
            (a) => a.userId === p.userId && absenceCoversDate(a, dayStr, today),
          );
          if (absence) {
            absenceByDay[dayStr] = {
              name:
                absence.absenceType?.name ?? st("enterprise.team.absenceLabel"),
              color: absence.absenceType?.color ?? "#6b7280",
            };
            continue;
          }
          norm += dailyNorm * share;
        }
        norm = Math.round(norm * 100) / 100;

        const weekRow = weekRowByUser.get(p.userId);
        const completeness =
          total <= 0
            ? ("empty" as const)
            : total >= norm - 0.01
              ? ("complete" as const)
              : ("incomplete" as const);

        return {
          userId: p.userId,
          name: p.user?.name ?? "Ukendt",
          email: p.user?.email ?? "",
          image: p.user?.image ?? null,
          departmentId: p.departmentId,
          perDay,
          absenceByDay,
          total,
          norm,
          completeness,
          weekStatus: weekRow?.status ?? null,
          submittedAt: weekRow?.submittedAt ?? null,
          rejectionReason:
            weekRow?.status === "rejected" ? weekRow.rejectionReason : null,
        };
      });

      return { days, members };
    }),

  /**
   * getTeamWeekBalances — saldi (ferie, feriefridage, flex, afspadsering) pr.
   * medarbejder i samme scope som ugelisten, til chips i godkendelsesbilledet.
   * Én batch (fire grupperede queries) — ingen N+1. Flex er "pr. dato": t.o.m.
   * ugens sidste dag, dog aldrig frem i tiden. Ferie = den ferieperiode i dag
   * ligger i (org'ens ferieår-start).
   */
  getTeamWeekBalances: orgManagerReadProcedure
    .input(
      z.object({ weekStart: dateString, departmentId: z.string().optional() }),
    )
    .query(async ({ ctx, input }) => {
      const weekStart = parseLocalDate(input.weekStart);
      const weekEndStr = toDateStr(addDays(weekStart, 6));
      const today = copenhagenToday();
      const asOf = weekEndStr < today ? weekEndStr : today;

      const [profiles, vacationSettings, org] = await Promise.all([
        getManagedProfiles(ctx.db, ctx, input.departmentId),
        getVacationOrgSettings(ctx.db, ctx.orgId),
        ctx.db.query.organizations.findFirst({
          where: eq(organizations.id, ctx.orgId),
          columns: { overtimeThresholdHours: true },
        }),
      ]);
      const period = vacationPeriodFor(today, vacationSettings.yearStartMonth);
      const balances = await loadTeamBalances(ctx.db, {
        orgId: ctx.orgId,
        userIds: profiles.map((p) => p.userId),
        periodStart: period.start,
        asOf,
        overtimeEnabled: org?.overtimeThresholdHours != null,
      });

      return {
        asOf,
        periodLabel: period.label,
        members: profiles.map((p) => ({
          userId: p.userId,
          profileId: p.id,
          ...balances[p.userId],
        })),
      };
    }),

  /** approveTimesheetWeek — godkend (og lås) en medarbejders uge. */
  approveTimesheetWeek: orgManagerProcedure
    .input(z.object({ userId: z.string(), weekStart: dateString }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.team.noSelfApprove"),
        });
      }
      await requireManagedProfile(ctx.db, ctx, input.userId);
      return approveWeekForUser(ctx, input);
    }),

  /**
   * approveDepartmentWeek — godkend alle INDSENDTE uger i en afdeling inden
   * for kalderens scope (#464). Hver medarbejder behandles for sig; fejl
   * (fx tom uge) rapporteres pr. medarbejder uden at stoppe resten.
   */
  approveDepartmentWeek: orgManagerProcedure
    .input(z.object({ departmentId: z.string(), weekStart: dateString }))
    .mutation(async ({ ctx, input }) => {
      const profiles = await getManagedProfiles(
        ctx.db,
        ctx,
        input.departmentId,
      );
      const candidates = profiles.filter(
        (p) => p.userId !== ctx.session.user.id,
      );
      if (candidates.length === 0) {
        return { approved: [] as string[], failed: [] as FailedItem[] };
      }
      const submitted = await ctx.db.query.timesheetWeeks.findMany({
        where: and(
          eq(timesheetWeeks.organizationId, ctx.orgId),
          eq(timesheetWeeks.weekStart, input.weekStart),
          eq(timesheetWeeks.status, "submitted"),
          inArray(
            timesheetWeeks.userId,
            candidates.map((p) => p.userId),
          ),
        ),
        columns: { userId: true },
      });
      const submittedIds = new Set(submitted.map((w) => w.userId));

      const approved: string[] = [];
      const failed: FailedItem[] = [];
      const actorLabel = await resolveUserLabel(ctx.db, ctx.session.user.id);
      for (const profile of candidates) {
        if (!submittedIds.has(profile.userId)) continue;
        try {
          await approveWeekForUser(
            ctx,
            { userId: profile.userId, weekStart: input.weekStart },
            { actorLabel, userLabel: formatUserLabel(profile.user) },
          );
          approved.push(profile.userId);
        } catch (e) {
          failed.push({
            id: profile.userId,
            name: profile.user?.name ?? "Ukendt",
            message:
              e instanceof Error
                ? e.message
                : await tr("serverErrors", "common.unknownError"),
          });
        }
      }
      return { approved, failed };
    }),

  /** rejectTimesheetWeek — afvis med begrundelse; ugen åbnes for redigering. */
  rejectTimesheetWeek: orgManagerProcedure
    .input(
      z.object({
        userId: z.string(),
        weekStart: dateString,
        reason: z
          .string()
          .min(1, { error: () => st("zod.reasonRequired") })
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireManagedProfile(ctx.db, ctx, input.userId);

      const existing = await ctx.db.query.timesheetWeeks.findFirst({
        where: and(
          eq(timesheetWeeks.userId, input.userId),
          eq(timesheetWeeks.organizationId, ctx.orgId),
          eq(timesheetWeeks.weekStart, input.weekStart),
        ),
      });
      if (!existing || !canRejectWeek(existing.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.team.onlySubmittedRejectable",
          ),
        });
      }

      const now = new Date();
      const weekStart = parseLocalDate(input.weekStart);
      const weekEnd = addDays(weekStart, 7);
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(timesheetWeeks)
          .set({
            status: "rejected",
            decidedBy: ctx.session.user.id,
            decidedAt: now,
            rejectionReason: input.reason,
            updatedAt: now,
          })
          .where(eq(timesheetWeeks.id, existing.id));

        await insertTimesheetWeekEvent(tx, {
          organizationId: ctx.orgId,
          userId: input.userId,
          weekStart: input.weekStart,
          event: "rejected",
          actorId: ctx.session.user.id,
          reason: input.reason,
          totalHours: existing.totalHours,
        });
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "timesheet_week_rejected",
          {
            targetUserId: input.userId,
            metadata: { weekStart: input.weekStart, reason: input.reason },
          },
        );

        // Registreringerne kan redigeres igen
        await tx
          .update(timeEntries)
          .set({ approvalStatus: "not_required", updatedAt: now })
          .where(
            and(
              ownTimeEntriesInOrg(input.userId, ctx.orgId),
              gte(timeEntries.date, weekStart),
              lt(timeEntries.date, weekEnd),
            ),
          );
      });

      void notify({
        orgId: ctx.orgId,
        event: "timesheet.rejected",
        payload: {
          managerName:
            ctx.session.user.name ??
            (await tr("serverErrors", "enterprise.yourManager")),
          weekStart: input.weekStart,
          rejectionReason: input.reason,
        },
        userIds: [input.userId],
      });

      return { status: "rejected" as const };
    }),

  /**
   * reopenTimesheetWeek — genåbn en godkendt uge til redigering.
   * Rækken slettes IKKE (#466): status → "reopened" (behandles som kladde)
   * og hændelsen skrives til timesheet_week_events + org-audit i samme tx.
   * Årsagen er obligatorisk (#518) — revisor/løn spørger "hvem ændrede
   * efter godkendelse, og hvorfor?".
   */
  reopenTimesheetWeek: orgManagerProcedure
    .input(
      z.object({
        userId: z.string(),
        weekStart: dateString,
        reason: z
          .string()
          .trim()
          .min(MIN_UNLOCK_REASON, { error: () => st("zod.reopenReason") })
          .max(MAX_UNLOCK_REASON),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireManagedProfile(ctx.db, ctx, input.userId);

      // En uge i en afsluttet (låst) periode kan ikke genåbnes alene
      if (
        await isWeekClosingLocked(
          ctx.db,
          ctx.orgId,
          input.userId,
          input.weekStart,
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.team.weekInClosedPeriod",
          ),
        });
      }

      const existing = await ctx.db.query.timesheetWeeks.findFirst({
        where: and(
          eq(timesheetWeeks.userId, input.userId),
          eq(timesheetWeeks.organizationId, ctx.orgId),
          eq(timesheetWeeks.weekStart, input.weekStart),
        ),
      });
      if (!existing || !canReopenWeek(existing.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.team.onlyApprovedReopen",
          ),
        });
      }

      const now = new Date();
      const weekStart = parseLocalDate(input.weekStart);
      const weekEnd = addDays(weekStart, 7);
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(timesheetWeeks)
          .set({
            status: "reopened",
            decidedBy: ctx.session.user.id,
            decidedAt: now,
            rejectionReason: null,
            updatedAt: now,
          })
          .where(eq(timesheetWeeks.id, existing.id));

        await insertTimesheetWeekEvent(tx, {
          organizationId: ctx.orgId,
          userId: input.userId,
          weekStart: input.weekStart,
          event: "reopened",
          actorId: ctx.session.user.id,
          reason: input.reason,
          totalHours: existing.totalHours,
        });
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "timesheet_week_reopened",
          {
            targetUserId: input.userId,
            metadata: {
              weekStart: input.weekStart,
              reason: input.reason,
              totalHours: existing.totalHours
                ? Number(existing.totalHours)
                : null,
            },
          },
        );

        // Fjern auto-optjent overtid for ugen — den genberegnes ved næste
        // godkendelse
        await tx
          .delete(overtimeLedger)
          .where(
            and(
              eq(overtimeLedger.organizationId, ctx.orgId),
              eq(overtimeLedger.userId, input.userId),
              eq(overtimeLedger.type, "earned"),
              eq(overtimeLedger.weekStart, input.weekStart),
            ),
          );

        await tx
          .update(timeEntries)
          .set({
            approvalStatus: "not_required",
            approvedAt: null,
            approvedBy: null,
            updatedAt: now,
          })
          .where(
            and(
              ownTimeEntriesInOrg(input.userId, ctx.orgId),
              gte(timeEntries.date, weekStart),
              lt(timeEntries.date, weekEnd),
            ),
          );
      });

      void notify({
        orgId: ctx.orgId,
        event: "timesheet.reopened",
        payload: {
          managerName:
            ctx.session.user.name ??
            (await tr("serverErrors", "enterprise.yourManager")),
          weekStart: input.weekStart,
          reason: input.reason,
        },
        userIds: [input.userId],
      });

      return { status: "reopened" as const };
    }),

  /**
   * getTimesheetWeekEvents — godkendelseshistorik for én medarbejders uge
   * (#466): indsendt/godkendt/afvist/genåbnet med aktør og tidspunkt.
   */
  getTimesheetWeekEvents: orgManagerProcedure
    .input(z.object({ userId: z.string(), weekStart: dateString }))
    .query(async ({ ctx, input }) => {
      await assertUserInScope(
        ctx.db,
        ctx,
        input.userId,
        await tr("serverErrors", "enterprise.team.historyOwnEmployees"),
      );
      return ctx.db.query.timesheetWeekEvents.findMany({
        where: and(
          eq(timesheetWeekEvents.organizationId, ctx.orgId),
          eq(timesheetWeekEvents.userId, input.userId),
          eq(timesheetWeekEvents.weekStart, input.weekStart),
        ),
        orderBy: [asc(timesheetWeekEvents.createdAt)],
        with: { actor: { columns: { id: true, name: true, email: true } } },
      });
    }),
});
