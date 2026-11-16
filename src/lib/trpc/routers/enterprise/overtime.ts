import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { employeeProfiles, overtimeLedger } from "@/lib/db/schema";
import { insertOvertimeLedger } from "@/lib/enterprise/overtime-ledger";
import {
  assertUserInScope,
  getVisibleScope,
  profileScopeCondition,
} from "@/lib/enterprise/scope";
import { router } from "../../trpc";
import {
  organizationProcedure,
  orgManagerProcedure,
  orgManagerReadProcedure,
} from "./middleware";

export const enterpriseOvertimeRouter = router({
  /** getMyOvertime — egen overtidssaldo + posteringshistorik. */
  getMyOvertime: organizationProcedure.query(async ({ ctx }) => {
    const entries = await ctx.db.query.overtimeLedger.findMany({
      where: and(
        eq(overtimeLedger.userId, ctx.session.user.id),
        eq(overtimeLedger.organizationId, ctx.orgId),
      ),
      orderBy: [desc(overtimeLedger.createdAt)],
      limit: 100,
    });
    const balance =
      Math.round(
        entries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0) * 100,
      ) / 100;
    return { balance, entries };
  }),

  /**
   * getOvertimeOverview — saldo pr. medarbejder (manager: egne reports,
   * admin/owner: alle).
   */
  getOvertimeOverview: orgManagerReadProcedure.query(async ({ ctx }) => {
    const scope = await getVisibleScope(ctx.db, ctx);
    const profiles = await ctx.db.query.employeeProfiles.findMany({
      where: and(
        eq(employeeProfiles.organizationId, ctx.orgId),
        eq(employeeProfiles.isActive, true),
        profileScopeCondition(scope),
      ),
      with: { user: { columns: { id: true, name: true, email: true } } },
    });
    if (profiles.length === 0) return [];
    const userIds = profiles.map((p) => p.userId);

    const sums = await ctx.db
      .select({
        userId: overtimeLedger.userId,
        balance: sql<string>`COALESCE(SUM(${overtimeLedger.hours}::numeric), 0)`,
      })
      .from(overtimeLedger)
      .where(
        and(
          eq(overtimeLedger.organizationId, ctx.orgId),
          inArray(overtimeLedger.userId, userIds),
        ),
      )
      .groupBy(overtimeLedger.userId);
    const balanceByUser = new Map(
      sums.map((s) => [s.userId, Math.round(Number(s.balance) * 100) / 100]),
    );

    return profiles
      .map((p) => ({
        userId: p.userId,
        name: p.user?.name ?? "Ukendt",
        email: p.user?.email ?? "",
        balance: balanceByUser.get(p.userId) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "da"));
  }),

  /**
   * addOvertimeEntry — manuel postering (leder/admin): afspadsering uden
   * fraværsanmodning, udbetaling eller korrektion. Noten er påkrævet.
   */
  addOvertimeEntry: orgManagerProcedure
    .input(
      z.object({
        userId: z.string(),
        type: z.enum(["used", "payout", "adjustment"]),
        // used/payout angives positivt og bogføres negativt;
        // adjustment angives med fortegn
        hours: z.number().min(-500).max(500),
        note: z
          .string()
          .min(1, { error: () => st("zod.noteRequired") })
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // NOT_FOUND uden for org, FORBIDDEN uden for scope (#464)
      await assertUserInScope(
        ctx.db,
        ctx,
        input.userId,
        await tr("serverErrors", "enterprise.overtime.ownEmployeesOnly"),
      );

      let hours = Math.round(input.hours * 100) / 100;
      if (input.type !== "adjustment") {
        if (hours <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr(
              "serverErrors",
              "enterprise.overtime.positiveHours",
            ),
          });
        }
        hours = -hours;
      }
      if (hours === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "enterprise.overtime.notZero"),
        });
      }

      const [created] = await insertOvertimeLedger(ctx.db, {
        organizationId: ctx.orgId,
        userId: input.userId,
        type: input.type,
        hours: hours.toFixed(2),
        note: input.note,
        createdBy: ctx.session.user.id,
      });
      return created;
    }),
});
