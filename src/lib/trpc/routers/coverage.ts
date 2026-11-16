import { eq } from "drizzle-orm";
import { z } from "zod";
import { st } from "@/i18n/sync-text";
import {
  coverageToDate,
  datesInRange,
  expectedByDate,
  ISO_WEEKDAYS,
  MAX_HOURS_PER_DAY,
  periodRange,
  summarizeCoverage,
  todayInTimeZone,
  type WorkSchedule,
  weeklyScheduleTotal,
  workingDaysOf,
} from "@/lib/coverage/coverage";
import { loadCoverageEntries, loadWorkTimeContext } from "@/lib/coverage/load";
import { users } from "@/lib/db/schema";
import { protectedProcedure, router } from "../trpc";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const dateString = z
  .string()
  .regex(DATE_RE)
  .refine(
    (v) => {
      const [y, m, d] = v.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
    },
    { error: () => st("zod.invalidDate") },
  );

const dayHours = z.number().min(0).max(MAX_HOURS_PER_DAY);

const scheduleInput = z
  .object({
    "1": dayHours,
    "2": dayHours,
    "3": dayHours,
    "4": dayHours,
    "5": dayHours,
    "6": dayHours,
    "7": dayHours,
  })
  // Uden arbejdstid giver dækningsgraden ingen mening, og working_days
  // (tidsblok-forslag) ville blive tom
  .refine((s) => ISO_WEEKDAYS.some((d) => s[d] > 0), {
    error: () => st("zod.atLeastOneWorkday"),
  });

// Dækningsgrad (#679): logget tid ÷ normal arbejdstid, personligt for den
// indloggede bruger (aldrig org-total), filtreret på aktiv org med
// userId-fallback.
export const coverageRouter = router({
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const wt = await loadWorkTimeContext(
      ctx.db,
      ctx.session.user.id,
      ctx.orgId,
      {
        enterpriseEnabled: ctx.modules.isEnabled("enterprise"),
      },
    );
    return {
      schedule: wt.schedule,
      weeklyTotal: weeklyScheduleTotal(wt.schedule),
      source: wt.source,
      reminderThreshold: wt.reminderThreshold,
    };
  }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        schedule: scheduleInput,
        reminderThreshold: z.number().int().min(1).max(100).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const schedule = {} as WorkSchedule;
      for (const d of ISO_WEEKDAYS) {
        schedule[d] = Math.round(input.schedule[d] * 100) / 100;
      }
      await ctx.db
        .update(users)
        .set({
          workSchedule: schedule,
          // Arbejdsdagene findes allerede (time-blocking) — hold dem i sync
          // med skemaet, så der kun er én sandhed om hvilke dage man arbejder
          workingDays: workingDaysOf(schedule),
          coverageReminderThreshold: input.reminderThreshold,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));
      return {
        schedule,
        weeklyTotal: weeklyScheduleTotal(schedule),
        reminderThreshold: input.reminderThreshold,
      };
    }),

  getSummary: protectedProcedure
    .input(
      z.object({
        period: z.enum(["day", "week", "month"]),
        /** Dato i perioden; standard = i dag i brugerens tidszone */
        date: dateString.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const wt = await loadWorkTimeContext(ctx.db, userId, ctx.orgId, {
        enterpriseEnabled: ctx.modules.isEnabled("enterprise"),
      });
      const today = todayInTimeZone(wt.timezone);
      const anchor = input.date ?? today;
      const { start, end } = periodRange(input.period, anchor);
      const dates = datesInRange(start, end);

      const entries = await loadCoverageEntries(ctx.db, {
        userId,
        orgId: ctx.orgId,
        start,
        end,
      });
      const summary = summarizeCoverage(
        entries,
        expectedByDate(dates, wt.hoursFor),
      );

      const isCurrent = start <= today && today <= end;
      return {
        ...summary,
        period: input.period,
        start,
        end,
        today,
        isCurrent,
        /** Kun sat for en igangværende uge/måned */
        toDate:
          isCurrent && input.period !== "day"
            ? coverageToDate(summary.days, today)
            : null,
        source: wt.source,
      };
    }),
});
