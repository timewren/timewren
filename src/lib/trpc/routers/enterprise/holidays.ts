import { TRPCError } from "@trpc/server";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { holidays } from "@/lib/db/schema";
import { loadDaysOff } from "@/lib/holidays/load";
import { router } from "../../trpc";
import { orgAdminProcedure, organizationProcedure } from "./middleware";

// ── Router ──────────────────────────────────────────────────────────

export const enterpriseHolidaysRouter = router({
  /**
   * listDaysOff — de fridage, der gælder for den indloggede medarbejder i
   * året (fridagskalenderen #526: afdeling > org > egen > standard, inkl.
   * org'ens ældre helligdagsliste). Bruges til at tælle arbejdsdage.
   */
  listDaysOff: organizationProcedure
    .input(z.object({ year: z.number().min(2020).max(2100) }))
    .query(async ({ ctx, input }) => {
      return loadDaysOff(ctx.db, {
        orgId: ctx.orgId,
        userId: ctx.session.user.id,
        start: `${input.year}-01-01`,
        end: `${input.year}-12-31`,
      });
    }),

  /**
   * list — list holidays for the org (system + custom) for a given year.
   * Also includes system-wide holidays (organizationId IS NULL).
   */
  listHolidays: organizationProcedure
    .input(z.object({ year: z.number().min(2020).max(2100) }))
    .query(async ({ ctx, input }) => {
      const startDate = `${input.year}-01-01`;
      const endDate = `${input.year}-12-31`;

      return ctx.db.query.holidays.findMany({
        where: and(
          or(
            eq(holidays.organizationId, ctx.orgId),
            isNull(holidays.organizationId),
          ),
          gte(holidays.date, startDate),
          lte(holidays.date, endDate),
          eq(holidays.isArchived, false),
        ),
        orderBy: (h, { asc }) => [asc(h.date)],
      });
    }),

  /**
   * create — add a custom holiday. Admin/owner only.
   */
  createHoliday: orgAdminProcedure
    .input(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: z.string().min(1).max(255),
        isHalfDay: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [holiday] = await ctx.db
        .insert(holidays)
        .values({
          organizationId: ctx.orgId,
          date: input.date,
          name: input.name,
          isHalfDay: input.isHalfDay,
          isSystem: false,
        })
        .returning();

      return holiday;
    }),

  /**
   * update — update a holiday name/date/halfDay. Admin/owner only.
   * SECURITY: verifies holiday.organizationId === ctx.orgId.
   */
  updateHoliday: orgAdminProcedure
    .input(
      z.object({
        id: z.string(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        name: z.string().min(1).max(255).optional(),
        isHalfDay: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const holiday = await ctx.db.query.holidays.findFirst({
        where: eq(holidays.id, input.id),
      });
      if (!holiday || holiday.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.holidays.notFound"),
        });
      }
      const { id, ...data } = input;
      const [updated] = await ctx.db
        .update(holidays)
        .set(data)
        .where(eq(holidays.id, id))
        .returning();
      return updated;
    }),

  /**
   * delete — delete a holiday. Admin/owner only.
   * SECURITY: verifies holiday.organizationId === ctx.orgId.
   */
  deleteHoliday: orgAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // SECURITY: verify org ownership
      const holiday = await ctx.db.query.holidays.findFirst({
        where: eq(holidays.id, input.id),
      });
      if (!holiday || holiday.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.holidays.notFound"),
        });
      }

      if (holiday.isSystem) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.holidays.defaultNoDelete",
          ),
        });
      }

      await ctx.db
        .update(holidays)
        .set({ isArchived: true })
        .where(eq(holidays.id, input.id));
      return { success: true };
    }),
});
