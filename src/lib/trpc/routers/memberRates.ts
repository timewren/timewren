import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { memberRates, members } from "@/lib/db/schema";
import { logOrgAudit } from "@/lib/org-audit";
import { orgAdminProcedure, router } from "../trpc";

/**
 * Verify every memberId belongs to the caller's org before writing a rate for
 * it. Without this an admin could attach a rate to another org's member id.
 */
async function assertMembersInOrg(
  db: typeof import("@/lib/db").db,
  memberIds: string[],
  orgId: string,
): Promise<void> {
  const rows = await db.query.members.findMany({
    where: and(
      eq(members.organizationId, orgId),
      inArray(members.id, memberIds),
    ),
    columns: { id: true },
  });
  if (rows.length !== new Set(memberIds).size) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "memberRates.membersNotInOrg"),
    });
  }
}

export const memberRatesRouter = router({
  // Per-member rates are salary-like data. Only owner/admin (who also set them)
  // may view the rate matrix — never a regular member who could otherwise read
  // every colleague's hourly rate.
  listForProject: orgAdminProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.orgId) return [];

      const orgMembers = await ctx.db.query.members.findMany({
        where: eq(members.organizationId, ctx.orgId),
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              image: true,
              defaultHourlyRate: true,
            },
          },
        },
      });

      const rates = await ctx.db.query.memberRates.findMany({
        where: and(
          eq(memberRates.organizationId, ctx.orgId),
          eq(memberRates.projectId, input.projectId),
        ),
      });

      const rateMap = new Map(rates.map((r) => [r.memberId, r]));

      return orgMembers.map((m) => ({
        memberId: m.id,
        userId: m.user.id,
        userName: m.user.name,
        userImage: m.user.image,
        role: m.role,
        projectRate: rateMap.get(m.id)?.hourlyRate ?? null,
        userDefaultRate: m.user.defaultHourlyRate ?? null,
      }));
    }),

  bulkUpdate: orgAdminProcedure
    .input(
      z.object({
        memberIds: z.array(z.string()).min(1),
        projectId: z.string().uuid().optional(),
        clientId: z.string().uuid().optional(),
        hourlyRate: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.orgId;
      if (!orgId) return;

      await assertMembersInOrg(ctx.db, input.memberIds, orgId);

      await ctx.db.transaction(async (tx) => {
        for (const memberId of input.memberIds) {
          await tx
            .insert(memberRates)
            .values({
              organizationId: orgId,
              memberId,
              projectId: input.projectId ?? null,
              clientId: input.clientId ?? null,
              hourlyRate: input.hourlyRate,
            })
            .onConflictDoNothing();

          // Update if it already existed
          await tx
            .update(memberRates)
            .set({ hourlyRate: input.hourlyRate, updatedAt: new Date() })
            .where(
              and(
                eq(memberRates.organizationId, orgId),
                eq(memberRates.memberId, memberId),
                input.projectId
                  ? eq(memberRates.projectId, input.projectId)
                  : isNull(memberRates.projectId),
                input.clientId
                  ? eq(memberRates.clientId, input.clientId)
                  : isNull(memberRates.clientId),
              ),
            );
        }
      });

      return { updated: input.memberIds.length };
    }),

  // Intern kostpris (#142): bor på members (IKKE memberRates — de har
  // højeste prioritet i faktureringshierarkiet). Kun owner/admin.
  listCostRates: orgAdminProcedure.query(async ({ ctx }) => {
    if (!ctx.orgId) return [];
    const orgMembers = await ctx.db.query.members.findMany({
      where: eq(members.organizationId, ctx.orgId),
      columns: { id: true, costRate: true, role: true },
      with: { user: { columns: { id: true, name: true } } },
    });
    return orgMembers.map((m) => ({
      memberId: m.id,
      userName: m.user.name,
      role: m.role,
      costRate: m.costRate,
    }));
  }),

  setCostRate: orgAdminProcedure
    .input(
      z.object({
        memberId: z.string(),
        costRate: z
          .string()
          .regex(/^\d+([.,]\d{1,2})?$/, {
            error: () => st("zod.invalidCostRate"),
          })
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.orgId) return;
      await assertMembersInOrg(ctx.db, [input.memberId], ctx.orgId);
      await ctx.db
        .update(members)
        .set({ costRate: input.costRate?.replace(",", ".") ?? null })
        .where(
          and(
            eq(members.id, input.memberId),
            eq(members.organizationId, ctx.orgId),
          ),
        );
      logOrgAudit(
        ctx.db,
        ctx.orgId,
        ctx.session.user.id,
        "member_cost_rate_changed",
        {
          metadata: { memberId: input.memberId, costRate: input.costRate },
        },
      );

      return { success: true };
    }),

  setRate: orgAdminProcedure
    .input(
      z.object({
        memberId: z.string(),
        projectId: z.string().uuid().optional(),
        clientId: z.string().uuid().optional(),
        hourlyRate: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.orgId) return;

      await assertMembersInOrg(ctx.db, [input.memberId], ctx.orgId);

      const existing = await ctx.db.query.memberRates.findFirst({
        where: and(
          eq(memberRates.organizationId, ctx.orgId),
          eq(memberRates.memberId, input.memberId),
          input.projectId
            ? eq(memberRates.projectId, input.projectId)
            : isNull(memberRates.projectId),
          input.clientId
            ? eq(memberRates.clientId, input.clientId)
            : isNull(memberRates.clientId),
        ),
      });

      if (existing) {
        await ctx.db
          .update(memberRates)
          .set({ hourlyRate: input.hourlyRate, updatedAt: new Date() })
          .where(eq(memberRates.id, existing.id));
      } else {
        await ctx.db.insert(memberRates).values({
          organizationId: ctx.orgId,
          memberId: input.memberId,
          projectId: input.projectId ?? null,
          clientId: input.clientId ?? null,
          hourlyRate: input.hourlyRate,
        });
      }

      logOrgAudit(
        ctx.db,
        ctx.orgId,
        ctx.session.user.id,
        "member_rate_changed",
        {
          metadata: {
            memberId: input.memberId,
            projectId: input.projectId ?? null,
            clientId: input.clientId ?? null,
            hourlyRate: input.hourlyRate,
          },
        },
      );

      return { success: true };
    }),
});
