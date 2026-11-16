import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { dayOffCalendars, departments } from "@/lib/db/schema";
import { recalculateCalendarFlex } from "@/lib/enterprise/flex-calendar";
import {
  DAY_OFF_PRESETS,
  MAX_CUSTOM_DAYS,
  MAX_DAY_OFF_NAME,
  OPTIONAL_DAY_SETTINGS,
} from "@/lib/holidays/danish";
import {
  configFromRow,
  loadDayOffCalendar,
  type PersonalCalendarBlock,
} from "@/lib/holidays/load";
import { isDateStr } from "@/lib/time/copenhagen";
import { assertMinRole, getOrgRole } from "../middleware/org-role";
import { protectedProcedure, router } from "../trpc";

// Fridagskalender (#526): forudindstilling + valgfri dage + egne fridage pr.
// bruger (selvstændig), organisation eller afdeling (Virksomhed). Normtid,
// flex, dækningsgrad og belægningsgrad læser kalenderen via
// src/lib/holidays/load.ts.
//
// Egen kalender (scope "user") gælder kun for den, der selv styrer sin
// arbejdstid (#742): har org'en/afdelingen valgt fridage, eller er brugeren
// medarbejder med HR-normtid, afvises skrivninger til den egne kalender, og
// loaderen ignorerer en evt. gammel række.

const scopeInput = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("user") }),
  z.object({ scope: z.literal("org") }),
  z.object({ scope: z.literal("department"), departmentId: z.string().uuid() }),
]);
type ScopeInput = z.infer<typeof scopeInput>;

const optionalSetting = z.enum(OPTIONAL_DAY_SETTINGS);

const configInput = z.object({
  preset: z.enum(DAY_OFF_PRESETS),
  optionalDays: z.object({
    may1: optionalSetting,
    constitutionDay: optionalSetting,
    dayAfterAscension: optionalSetting,
    christmasEve: optionalSetting,
    newYearsEve: optionalSetting,
  }),
  customDays: z
    .array(
      z.object({
        date: z
          .string()
          .refine(isDateStr, { error: () => st("zod.invalidDate") }),
        name: z.string().trim().min(1).max(MAX_DAY_OFF_NAME),
        isHalfDay: z.boolean(),
      }),
    )
    .max(MAX_CUSTOM_DAYS)
    .refine((days) => new Set(days.map((d) => d.date)).size === days.length, {
      error: () => st("zod.duplicateDate"),
    }),
});

type Ctx = {
  db: Parameters<typeof loadDayOffCalendar>[0];
  orgId: string | null;
  session: { user: { id: string } };
  modules: { isEnabled: (key: "enterprise") => boolean };
};

const PERSONAL_BLOCK_KEYS: Record<
  Exclude<PersonalCalendarBlock, null>,
  string
> = {
  department: "dayOff.blockedDepartment",
  org: "dayOff.blockedOrg",
  employee: "dayOff.blockedEmployee",
};

/** Hvorfor brugerens egen kalender ikke gælder (null = den må gælde). */
async function personalBlock(ctx: Ctx): Promise<PersonalCalendarBlock> {
  if (!ctx.orgId) return null;
  const calendar = await loadDayOffCalendar(ctx.db, {
    orgId: ctx.orgId,
    userId: ctx.session.user.id,
  });
  return calendar.personalBlockedBy;
}

/**
 * WHERE-betingelsen for scopets ene række (efter adgangstjek). "reset" er
 * en skrivning, men den egne kalender må altid slettes — også når den er
 * blokeret (#742).
 */
async function resolveScope(
  ctx: Ctx,
  input: ScopeInput,
  mode: "read" | "write" | "reset",
) {
  const write = mode !== "read";
  const userId = ctx.session.user.id;
  if (input.scope === "user") {
    const blockedBy = await personalBlock(ctx);
    if (blockedBy && mode === "write") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", PERSONAL_BLOCK_KEYS[blockedBy]),
      });
    }
    return {
      where: eq(dayOffCalendars.userId, userId),
      values: { userId, organizationId: null, departmentId: null },
      canEdit: !blockedBy,
    };
  }
  if (!ctx.orgId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "dayOff.orgNeedsOrg"),
    });
  }
  const orgId = ctx.orgId;
  const role = await getOrgRole(ctx.db, userId, orgId);
  if (!role) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "common.notOrgMember"),
    });
  }
  if (write) assertMinRole(role, "admin");
  const canEdit = role === "admin" || role === "owner";

  if (input.scope === "org") {
    return {
      where: and(
        eq(dayOffCalendars.organizationId, orgId),
        isNull(dayOffCalendars.departmentId),
        isNull(dayOffCalendars.userId),
      ),
      values: { userId: null, organizationId: orgId, departmentId: null },
      canEdit,
    };
  }

  // Afdelinger findes kun i Virksomhed (enterprise-modulet)
  if (!ctx.modules.isEnabled("enterprise")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "dayOff.departmentNeedsBusiness"),
    });
  }
  const department = await ctx.db.query.departments.findFirst({
    where: and(
      eq(departments.id, input.departmentId),
      eq(departments.organizationId, orgId),
    ),
    columns: { id: true },
  });
  if (!department) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "dayOff.departmentNotFound"),
    });
  }
  return {
    where: and(
      eq(dayOffCalendars.organizationId, orgId),
      eq(dayOffCalendars.departmentId, department.id),
    ),
    values: {
      userId: null,
      organizationId: orgId,
      departmentId: department.id,
    },
    canEdit,
  };
}

export const dayOffRouter = router({
  /** Den gemte kalender for scopet (standard, hvis der ikke er gemt en). */
  getCalendar: protectedProcedure
    .input(scopeInput)
    .query(async ({ ctx, input }) => {
      const scope = await resolveScope(ctx, input, "read");
      const row = await ctx.db.query.dayOffCalendars.findFirst({
        where: scope.where,
      });
      return {
        config: configFromRow(row),
        isSaved: !!row,
        updatedAt: row?.updatedAt ?? null,
        canEdit: scope.canEdit,
      };
    }),

  /** Hvilken kalender gælder for mig lige nu (afdeling > org > egen)? */
  getEffective: protectedProcedure.query(async ({ ctx }) => {
    const calendar = await loadDayOffCalendar(ctx.db, {
      orgId: ctx.orgId,
      userId: ctx.session.user.id,
    });
    return {
      source: calendar.source,
      preset: calendar.config.preset,
      /** Hvorfor egen kalender ikke kan vælges (null = den kan) */
      personalBlockedBy: calendar.personalBlockedBy,
    };
  }),

  saveCalendar: protectedProcedure
    .input(z.intersection(scopeInput, configInput))
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveScope(ctx, input, "write");
      const data = {
        preset: input.preset,
        optionalDays: input.optionalDays,
        customDays: [...input.customDays].sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
        updatedBy: ctx.session.user.id,
        updatedAt: new Date(),
      };
      return ctx.db.transaction(async (tx) => {
        const existing = await tx.query.dayOffCalendars.findFirst({
          where: scope.where,
          columns: { id: true },
        });
        if (existing) {
          await tx
            .update(dayOffCalendars)
            .set(data)
            .where(eq(dayOffCalendars.id, existing.id));
        } else {
          const inserted = await tx
            .insert(dayOffCalendars)
            .values({ ...scope.values, ...data })
            .onConflictDoNothing()
            .returning({ id: dayOffCalendars.id });
          if (inserted.length === 0) {
            await tx.update(dayOffCalendars).set(data).where(scope.where);
          }
        }
        if (input.scope !== "user" && ctx.orgId) {
          await recalculateCalendarFlex(tx, {
            orgId: ctx.orgId,
            ...(input.scope === "department"
              ? { departmentId: input.departmentId }
              : {}),
          });
        }
        return { success: true };
      });
    }),

  /** Slet scopets kalender, så den næste i rækken gælder igen. */
  resetCalendar: protectedProcedure
    .input(scopeInput)
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveScope(ctx, input, "reset");
      return ctx.db.transaction(async (tx) => {
        await tx.delete(dayOffCalendars).where(scope.where);
        if (input.scope !== "user" && ctx.orgId) {
          await recalculateCalendarFlex(tx, {
            orgId: ctx.orgId,
            ...(input.scope === "department"
              ? { departmentId: input.departmentId }
              : {}),
          });
        }
        return { success: true };
      });
    }),
});
