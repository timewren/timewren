import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, isNotNull, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { checkIns, employeeProfiles, timeEntries } from "@/lib/db/schema";
import { assertEntryCompliant } from "@/lib/enterprise/compliance-guard";
import { assertEntryEditable } from "@/lib/enterprise/edit-guard";
import { recalculateFlexDay } from "@/lib/enterprise/flex";
import { ownTimeEntriesInOrg } from "@/lib/enterprise/time-entry-scope";
import {
  resolveBreakMinutes,
  unpaidBreakDeduction,
} from "@/lib/enterprise/timesheet";
import { loadOrgWorkSettings } from "@/lib/enterprise/work-settings";
import { isBilledLocked } from "@/lib/time/billed-lock";
import {
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenToday,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";
import { entryDateForStart } from "@/lib/timer/entry-date";
import { router } from "../../trpc";
import { organizationProcedure } from "./middleware";

export const enterpriseCheckInRouter = router({
  /**
   * getCheckInStatus — åben check-in (hvis nogen) + dagens afsluttede
   * fremmøde-registreringer.
   */
  getCheckInStatus: organizationProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    // Dansk dag uanset processens TZ (#649)
    const todayStr = copenhagenToday();
    const dayStart = copenhagenDayStart(todayStr);
    const dayEnd = copenhagenDayEndExclusive(todayStr);

    const [open, todayCompleted, orgSettings, profile] = await Promise.all([
      ctx.db.query.checkIns.findFirst({
        where: and(
          eq(checkIns.userId, userId),
          eq(checkIns.organizationId, ctx.orgId),
          isNull(checkIns.checkedOutAt),
        ),
        orderBy: [desc(checkIns.checkedInAt)],
      }),
      ctx.db.query.checkIns.findMany({
        where: and(
          eq(checkIns.userId, userId),
          eq(checkIns.organizationId, ctx.orgId),
          gte(checkIns.checkedInAt, dayStart),
          lt(checkIns.checkedInAt, dayEnd),
        ),
        orderBy: [desc(checkIns.checkedInAt)],
      }),
      loadOrgWorkSettings(ctx.db, ctx.orgId),
      ctx.db.query.employeeProfiles.findFirst({
        where: and(
          eq(employeeProfiles.userId, userId),
          eq(employeeProfiles.organizationId, ctx.orgId),
        ),
        columns: { breakMinutes: true },
      }),
    ]);

    const completedToday = todayCompleted.filter((c) => c.checkedOutAt);
    const presenceHours = completedToday.reduce((sum, c) => {
      if (!c.checkedOutAt) return sum;
      return (
        sum + (c.checkedOutAt.getTime() - c.checkedInAt.getTime()) / 3_600_000
      );
    }, 0);
    // Ubetalt pause (#449): vis dagens registrerede timer netto + fradraget
    const breakDeducted =
      orgSettings.breakPolicy === "unpaid_excluded"
        ? unpaidBreakDeduction(
            resolveBreakMinutes(profile, orgSettings),
            presenceHours,
          )
        : 0;

    return {
      open: open ?? null,
      todayHours: Math.round((presenceHours - breakDeducted) * 100) / 100,
      todayCount: completedToday.length,
      todayBreakDeductedHours: breakDeducted,
      breakPolicy: orgSettings.breakPolicy,
    };
  }),

  /** checkIn — registrér starttidspunkt. Fejler hvis man allerede er checket ind. */
  checkIn: organizationProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const open = await ctx.db.query.checkIns.findFirst({
      where: and(
        eq(checkIns.userId, userId),
        eq(checkIns.organizationId, ctx.orgId),
        isNull(checkIns.checkedOutAt),
      ),
    });
    if (open) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "enterprise.checkin.already"),
      });
    }

    const [created] = await ctx.db
      .insert(checkIns)
      .values({
        userId,
        organizationId: ctx.orgId,
        checkedInAt: new Date(),
      })
      .returning();
    return created;
  }),

  /**
   * checkOut — afslut åben check-in og opret en tidsregistrering med
   * start/slut (intern tid uden projekt). Flex genberegnes for dagen.
   */
  checkOut: organizationProcedure
    .input(z.object({ checkInId: z.string().uuid() }).optional())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const open = await ctx.db.query.checkIns.findFirst({
        where: and(
          eq(checkIns.userId, userId),
          eq(checkIns.organizationId, ctx.orgId),
          isNull(checkIns.checkedOutAt),
          ...(input?.checkInId ? [eq(checkIns.id, input.checkInId)] : []),
        ),
      });
      if (!open) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.checkin.noneOpen"),
        });
      }

      const now = new Date();
      const rawHours =
        Math.round(
          ((now.getTime() - open.checkedInAt.getTime()) / 3_600_000) * 100,
        ) / 100;

      // Fælles redigeringsguard (#467): en check-ud skriver en tidspost på
      // check-ind-dagen — indsendt/godkendt uge eller lås afviser
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId,
        role: ctx.orgRole,
        // Samme danske dato som posten gemmes på (#734)
        dates: [entryDateForStart(open.checkedInAt)],
      });

      // Arbejdstidsregler (E11, #469): en check-ud er et faktum, ikke en
      // plan — block nedgraderes til advarsel, så brugeren aldrig sidder
      // fast i "checket ind". Overtrædelsen fanges i compliance-oversigten.
      const complianceWarnings = await assertEntryCompliant(ctx.db, {
        orgId: ctx.orgId,
        userId,
        candidate: {
          date: entryDateForStart(open.checkedInAt),
          hours: rawHours,
          startTime: open.checkedInAt,
          endTime: now,
        },
        neverBlock: true,
        enterpriseEnabled: ctx.modules.isEnabled("enterprise"),
      });

      // Ubetalt pause (#449): når dagens samlede tilstedeværelse passerer
      // 6 t, trækkes pausen fra — kun den del der ikke allerede er trukket
      // på dagens tidligere check-ud'er, så flere check-ind/ud samme dag
      // tilsammen giver præcis ét fradrag.
      const { hours, breakDeductedHours, carryOverHours, earlierEntryIds } =
        await applyBreakPolicyForDay(ctx.db, {
          userId,
          orgId: ctx.orgId,
          day: open.checkedInAt,
          excludeCheckInId: open.id,
          sessionHours: rawHours,
        });

      // Fradrag større end sessionen (fx et kort check-ind sidst på dagen
      // der tipper totalen over 6 t): resten trækkes på dagens tidligere
      // fremmøde-poster, seneste først, så dagen samlet får præcis ét
      // fradrag (#452). Org-scoped (#445/#457): en post fra en anden org
      // med samme id-reference må aldrig røres.
      let carryApplied = false;
      let remainingCarry = carryOverHours;
      for (const entryId of earlierEntryIds) {
        if (remainingCarry <= 0) break;
        const entry = await ctx.db.query.timeEntries.findFirst({
          where: and(
            eq(timeEntries.id, entryId),
            ownTimeEntriesInOrg(userId, ctx.orgId),
          ),
          columns: { id: true, hours: true, isBilled: true, invoiceId: true },
        });
        // Fakturerede poster røres ikke (#702) — check-ud må aldrig fejle
        if (!entry || isBilledLocked(entry)) continue;
        const entryHours = Number(entry.hours);
        const take = Math.min(entryHours, remainingCarry);
        if (take <= 0) continue;
        await ctx.db
          .update(timeEntries)
          .set({
            hours: (Math.round((entryHours - take) * 100) / 100).toFixed(2),
            updatedAt: now,
          })
          .where(
            and(
              eq(timeEntries.id, entry.id),
              ownTimeEntriesInOrg(userId, ctx.orgId),
            ),
          );
        remainingCarry = Math.round((remainingCarry - take) * 100) / 100;
        carryApplied = true;
      }

      // Under ét minut: luk uden tidsregistrering (fejl-klik). Heller ingen
      // post når netto-timerne efter pausefradrag afrundes til 0.
      let timeEntryId: string | null = null;
      if (rawHours >= 0.02 && hours > 0) {
        const [entry] = await ctx.db
          .insert(timeEntries)
          .values({
            userId,
            organizationId: ctx.orgId,
            description:
              breakDeductedHours > 0
                ? `Fremmøde (pause fratrukket ${Math.round(breakDeductedHours * 60)} min)`
                : "Fremmøde",
            hours: hours.toFixed(2),
            date: entryDateForStart(open.checkedInAt),
            startTime: open.checkedInAt,
            endTime: now,
            isBillable: false,
            source: "checkin",
          })
          .returning({ id: timeEntries.id });
        timeEntryId = entry.id;
      }

      const [updated] = await ctx.db
        .update(checkIns)
        .set({ checkedOutAt: now, timeEntryId })
        .where(eq(checkIns.id, open.id))
        .returning();

      if (timeEntryId || carryApplied) {
        await recalculateFlexDay(ctx.db, {
          userId,
          orgId: ctx.orgId,
          // Samme danske dag som posten dateres på (#734)
          date: toCopenhagenDateStr(open.checkedInAt),
        });
      }

      return {
        ...updated,
        hours: timeEntryId ? hours : 0,
        breakDeductedHours: timeEntryId ? breakDeductedHours : 0,
        complianceWarnings: timeEntryId ? complianceWarnings : [],
      };
    }),
});

/**
 * Beregn netto-timer for én check-ud-session under org'ens pause-politik.
 * `paid_included`/`none` → ingen fradrag. `unpaid_excluded` → fradraget for
 * dagens samlede tilstedeværelse (tidligere lukkede check-ins + denne)
 * minus det fradrag der allerede er givet på de tidligere sessioner.
 */
async function applyBreakPolicyForDay(
  db: Parameters<typeof loadOrgWorkSettings>[0],
  params: {
    userId: string;
    orgId: string;
    day: Date;
    excludeCheckInId: string;
    sessionHours: number;
  },
): Promise<{
  hours: number;
  breakDeductedHours: number;
  /** Fradrag der ikke kunne rummes i sessionen — trækkes på tidligere poster. */
  carryOverHours: number;
  /** Dagens tidligere fremmøde-poster, seneste først. */
  earlierEntryIds: string[];
}> {
  const { userId, orgId, day, excludeCheckInId, sessionHours } = params;
  const orgSettings = await loadOrgWorkSettings(db, orgId);
  if (orgSettings.breakPolicy !== "unpaid_excluded") {
    return {
      hours: sessionHours,
      breakDeductedHours: 0,
      carryOverHours: 0,
      earlierEntryIds: [],
    };
  }

  // Den danske dag for check-in, uanset processens TZ (#649)
  const dayStr = toCopenhagenDateStr(day);
  const dayStart = copenhagenDayStart(dayStr);
  const dayEnd = copenhagenDayEndExclusive(dayStr);

  const [profile, earlier] = await Promise.all([
    db.query.employeeProfiles.findFirst({
      where: and(
        eq(employeeProfiles.userId, userId),
        eq(employeeProfiles.organizationId, orgId),
      ),
      columns: { breakMinutes: true },
    }),
    db.query.checkIns.findMany({
      where: and(
        eq(checkIns.userId, userId),
        eq(checkIns.organizationId, orgId),
        gte(checkIns.checkedInAt, dayStart),
        lt(checkIns.checkedInAt, dayEnd),
        isNotNull(checkIns.checkedOutAt),
        ne(checkIns.id, excludeCheckInId),
      ),
      columns: { checkedInAt: true, checkedOutAt: true, timeEntryId: true },
      orderBy: [desc(checkIns.checkedInAt)],
    }),
  ]);

  const breakMinutes = resolveBreakMinutes(profile, orgSettings);
  const earlierHours = earlier.reduce((sum, c) => {
    if (!c.checkedOutAt) return sum;
    return (
      sum + (c.checkedOutAt.getTime() - c.checkedInAt.getTime()) / 3_600_000
    );
  }, 0);
  const alreadyDeducted = unpaidBreakDeduction(breakMinutes, earlierHours);
  const totalDeduction = unpaidBreakDeduction(
    breakMinutes,
    earlierHours + sessionHours,
  );
  const deduction = Math.max(
    0,
    Math.round((totalDeduction - alreadyDeducted) * 100) / 100,
  );
  const appliedHere = Math.min(deduction, sessionHours);
  return {
    hours: Math.max(0, Math.round((sessionHours - deduction) * 100) / 100),
    breakDeductedHours: Math.round(appliedHere * 100) / 100,
    carryOverHours: Math.max(
      0,
      Math.round((deduction - appliedHere) * 100) / 100,
    ),
    earlierEntryIds: earlier
      .map((c) => c.timeEntryId)
      .filter((id): id is string => !!id),
  };
}
