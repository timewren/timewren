import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { organizations, periodClosings, users } from "@/lib/db/schema";
import {
  type ClosingSummary,
  canAcknowledgeClosing,
  canApproveClosing,
  canRefreshClosing,
  canUnlockClosing,
  closingPeriodBounds,
  closingPeriodLabel,
  isPeriodClosingInterval,
  MAX_UNLOCK_REASON,
  MIN_UNLOCK_REASON,
  PERIOD_CLOSING_INTERVALS,
  type PeriodClosingInterval,
  previousClosingPeriod,
} from "@/lib/enterprise/period-closing";
import {
  closingEmployees,
  computeClosingSummaries,
  generatePeriodClosings,
  loadPeriodClosingInterval,
} from "@/lib/enterprise/period-closing-service";
import {
  assertUserInScope,
  canSeeUser,
  getVisibleScope,
} from "@/lib/enterprise/scope";
import { notify } from "@/lib/notifications/bus";
import { formatUserLabel, logOrgAudit } from "@/lib/org-audit";
import { copenhagenToday, isDateStr } from "@/lib/time/copenhagen";
import { router } from "../../trpc";
import {
  orgAdminProcedure,
  organizationProcedure,
  orgManagerProcedure,
  orgManagerReadProcedure,
} from "./middleware";

const dateString = z
  .string()
  .refine(isDateStr, { error: () => st("zod.invalidDate") });

type ClosingRow = typeof periodClosings.$inferSelect;

function rowLabel(
  row: Pick<ClosingRow, "periodType" | "periodStart" | "periodEnd">,
) {
  const interval: PeriodClosingInterval = isPeriodClosingInterval(
    row.periodType,
  )
    ? row.periodType
    : "month";
  return closingPeriodLabel(interval, {
    start: row.periodStart,
    end: row.periodEnd,
  });
}

function present(row: ClosingRow) {
  return {
    id: row.id,
    userId: row.userId,
    periodType: row.periodType,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    label: rowLabel(row),
    status: row.status,
    summary: (row.summary ?? null) as ClosingSummary | null,
    generatedAt: row.generatedAt,
    approvedAt: row.approvedAt,
    acknowledgedAt: row.acknowledgedAt,
    unlockedAt: row.unlockedAt,
    unlockReason: row.unlockReason,
  };
}

async function requireInterval(
  db: Parameters<typeof loadPeriodClosingInterval>[0],
  orgId: string,
): Promise<PeriodClosingInterval> {
  const interval = await loadPeriodClosingInterval(db, orgId);
  if (!interval) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "enterprise.closing.notEnabled"),
    });
  }
  return interval;
}

/**
 * Periodeafslutning (#518, inkl. #509): opgørelse ved periodens slut,
 * leder-godkendelse (låser perioden), medarbejder-kvittering og oplåsning
 * med logget årsag.
 */
export const enterprisePeriodClosingRouter = router({
  updatePeriodClosingSettings: orgAdminProcedure
    .input(z.object({ interval: z.enum(PERIOD_CLOSING_INTERVALS).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const before = await loadPeriodClosingInterval(ctx.db, ctx.orgId);
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(organizations)
          .set({ periodClosingInterval: input.interval })
          .where(eq(organizations.id, ctx.orgId));
        if (before !== input.interval) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "period_closing_settings_updated",
            {
              metadata: {
                diff: { interval: { from: before, to: input.interval } },
              },
            },
          );
        }
      });
      return { interval: input.interval };
    }),

  /** Egne opgørelser, nyeste først. */
  listMyPeriodClosings: organizationProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.periodClosings.findMany({
      where: and(
        eq(periodClosings.organizationId, ctx.orgId),
        eq(periodClosings.userId, ctx.session.user.id),
      ),
      orderBy: [desc(periodClosings.periodStart)],
      limit: 24,
    });
    return {
      interval: await loadPeriodClosingInterval(ctx.db, ctx.orgId),
      closings: rows.map(present),
    };
  }),

  /**
   * Holdets opgørelser for én periode (default: den senest afsluttede).
   * Medarbejdere i scope uden opgørelse kommer med som `missing`.
   */
  listTeamPeriodClosings: orgManagerReadProcedure
    .input(z.object({ date: dateString.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const interval = await loadPeriodClosingInterval(ctx.db, ctx.orgId);
      if (!interval) return { interval: null, period: null, rows: [] };
      const today = copenhagenToday();
      const bounds = input?.date
        ? closingPeriodBounds(interval, input.date)
        : previousClosingPeriod(interval, today);

      const scope = await getVisibleScope(ctx.db, ctx);
      const employees = (
        await closingEmployees(ctx.db, ctx.orgId, bounds)
      ).filter((id) => canSeeUser(scope, id));
      const [rows, people] = await Promise.all([
        employees.length === 0
          ? Promise.resolve([] as ClosingRow[])
          : ctx.db.query.periodClosings.findMany({
              where: and(
                eq(periodClosings.organizationId, ctx.orgId),
                eq(periodClosings.periodStart, bounds.start),
                inArray(periodClosings.userId, employees),
              ),
            }),
        employees.length === 0
          ? Promise.resolve([])
          : ctx.db.query.users.findMany({
              where: inArray(users.id, employees),
              columns: { id: true, name: true, email: true },
            }),
      ]);
      const nameOf = new Map(
        people.map((p) => [p.id, p.name || p.email || "Ukendt"]),
      );
      const byUser = new Map(rows.map((r) => [r.userId, r]));
      return {
        interval,
        period: {
          ...bounds,
          label: closingPeriodLabel(interval, bounds),
          ended: bounds.end < today,
        },
        rows: employees
          .map((userId) => {
            const row = byUser.get(userId);
            return {
              userId,
              name: nameOf.get(userId) ?? "Ukendt",
              isSelf: userId === ctx.session.user.id,
              closing: row ? present(row) : null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, "da")),
      };
    }),

  /** Dan manglende opgørelser for en afsluttet periode (leder, scope). */
  generatePeriodClosings: orgManagerProcedure
    .input(z.object({ date: dateString }))
    .mutation(async ({ ctx, input }) => {
      const interval = await requireInterval(ctx.db, ctx.orgId);
      const bounds = closingPeriodBounds(interval, input.date);
      if (bounds.end >= copenhagenToday()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.closing.afterPeriodEnd",
          ),
        });
      }
      const scope = await getVisibleScope(ctx.db, ctx);
      const created = await generatePeriodClosings(ctx.db, {
        orgId: ctx.orgId,
        interval,
        bounds,
        userIds: scope.all ? undefined : [...scope.userIds],
        actorId: ctx.session.user.id,
      });
      return { created: created.length };
    }),

  /** Genberegn en opgørelse der endnu ikke er godkendt. */
  refreshPeriodClosing: orgManagerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadClosing(ctx, input.id);
      await assertUserInScope(ctx.db, ctx, row.userId);
      if (!canRefreshClosing(row.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.closing.approvedNoRecalc",
          ),
        });
      }
      const summary = await summaryFor(ctx, row);
      await ctx.db.transaction(async (tx) => {
        const updated = await tx
          .update(periodClosings)
          .set({ summary, generatedAt: new Date(), updatedAt: new Date() })
          // Kun hvis ingen nåede at godkende imens (summary er da fastfrosset)
          .where(
            and(
              eq(periodClosings.id, row.id),
              eq(periodClosings.status, row.status),
            ),
          )
          .returning({ id: periodClosings.id });
        if (updated.length === 0) throw closingChanged();
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "period_closing_refreshed",
          {
            targetUserId: row.userId,
            metadata: {
              periodStart: row.periodStart,
              periodEnd: row.periodEnd,
            },
          },
        );
      });
      return { ok: true };
    }),

  /**
   * Godkend opgørelsen: den genberegnes og fastfryses, og perioden låses
   * for medarbejderens registreringer. Medarbejderen bedes kvittere.
   */
  approvePeriodClosing: orgManagerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadClosing(ctx, input.id);
      if (row.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.closing.noSelfApprove"),
        });
      }
      await assertUserInScope(ctx.db, ctx, row.userId);
      if (!canApproveClosing(row.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.closing.alreadyApproved",
          ),
        });
      }
      const summary = await summaryFor(ctx, row);
      const now = new Date();
      const updated = await ctx.db.transaction(async (tx) => {
        const [u] = await tx
          .update(periodClosings)
          .set({
            status: "approved",
            summary,
            approvedBy: ctx.session.user.id,
            approvedAt: now,
            acknowledgedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(periodClosings.id, row.id),
              // Optimistisk: kun hvis ingen andre nåede at godkende først
              eq(periodClosings.status, row.status),
            ),
          )
          .returning({ id: periodClosings.id });
        if (!u) return false;
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "period_closing_approved",
          {
            targetUserId: row.userId,
            metadata: {
              periodStart: row.periodStart,
              periodEnd: row.periodEnd,
              registered: summary?.registered ?? null,
              net: summary?.net ?? null,
              flex: summary?.flex ?? null,
            },
          },
        );
        return true;
      });
      if (!updated) throw closingChanged();
      void notify({
        orgId: ctx.orgId,
        event: "period.closing_approved",
        payload: {
          managerName:
            ctx.session.user.name ??
            (await tr("serverErrors", "enterprise.yourManager")),
          periodLabel: rowLabel(row),
        },
        userIds: [row.userId],
      });
      return { status: "approved" as const };
    }),

  /** Medarbejderen kvitterer for sin godkendte opgørelse. */
  acknowledgePeriodClosing: organizationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadClosing(ctx, input.id);
      if (row.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.closing.ownAckOnly"),
        });
      }
      if (!canAcknowledgeClosing(row.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.closing.needsManagerApproval",
          ),
        });
      }
      const now = new Date();
      await ctx.db.transaction(async (tx) => {
        const updated = await tx
          .update(periodClosings)
          .set({ status: "acknowledged", acknowledgedAt: now, updatedAt: now })
          // Kun hvis perioden stadig er godkendt (ikke låst op imens)
          .where(
            and(
              eq(periodClosings.id, row.id),
              eq(periodClosings.status, "approved"),
            ),
          )
          .returning({ id: periodClosings.id });
        if (updated.length === 0) throw closingChanged();
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "period_closing_acknowledged",
          {
            targetUserId: row.userId,
            metadata: {
              periodStart: row.periodStart,
              periodEnd: row.periodEnd,
            },
          },
        );
      });
      return { status: "acknowledged" as const };
    }),

  /**
   * Lås en godkendt/kvitteret periode op. Kun administratorer, og årsagen
   * er obligatorisk og logges. Opgørelsen kan derefter genberegnes og
   * godkendes igen.
   */
  unlockPeriodClosing: orgAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z
          .string()
          .trim()
          .min(MIN_UNLOCK_REASON, { error: () => st("zod.unlockReason") })
          .max(MAX_UNLOCK_REASON),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await loadClosing(ctx, input.id);
      if (!canUnlockClosing(row.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "enterprise.closing.notLocked"),
        });
      }
      const now = new Date();
      await ctx.db.transaction(async (tx) => {
        const updated = await tx
          .update(periodClosings)
          .set({
            status: "reopened",
            unlockedBy: ctx.session.user.id,
            unlockedAt: now,
            unlockReason: input.reason,
            approvedBy: null,
            approvedAt: null,
            acknowledgedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(periodClosings.id, row.id),
              eq(periodClosings.status, row.status),
            ),
          )
          .returning({ id: periodClosings.id });
        if (updated.length === 0) throw closingChanged();
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "period_closing_unlocked",
          {
            targetUserId: row.userId,
            metadata: {
              periodStart: row.periodStart,
              periodEnd: row.periodEnd,
              previousStatus: row.status,
              reason: input.reason,
            },
          },
        );
      });
      if (row.userId !== ctx.session.user.id) {
        void notify({
          orgId: ctx.orgId,
          event: "period.closing_unlocked",
          payload: {
            actorName:
              formatUserLabel({ name: ctx.session.user.name }) ??
              "En administrator",
            periodLabel: rowLabel(row),
            reason: input.reason,
          },
          userIds: [row.userId],
        });
      }
      return { status: "reopened" as const };
    }),
});

function closingChanged(): TRPCError {
  return new TRPCError({
    code: "CONFLICT",
    message: st("enterprise.closing.changedMeanwhile"),
  });
}

type Ctx = {
  db: Parameters<typeof computeClosingSummaries>[0];
  orgId: string;
};

async function loadClosing(ctx: Ctx, id: string): Promise<ClosingRow> {
  const row = await ctx.db.query.periodClosings.findFirst({
    where: and(
      eq(periodClosings.id, id),
      eq(periodClosings.organizationId, ctx.orgId),
    ),
  });
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.closing.notFound"),
    });
  }
  return row;
}

async function summaryFor(
  ctx: Ctx,
  row: ClosingRow,
): Promise<ClosingSummary | null> {
  const map = await computeClosingSummaries(ctx.db, {
    orgId: ctx.orgId,
    userIds: [row.userId],
    bounds: { start: row.periodStart, end: row.periodEnd },
  });
  return map.get(row.userId) ?? null;
}
