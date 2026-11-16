import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { members, orgAuditLogs } from "@/lib/db/schema";
import {
  AUDIT_CATEGORY_LABELS,
  actionsInCategory,
  logOrgAudit,
  type OrgAuditAction,
  type OrgAuditCategory,
} from "@/lib/org-audit";

const categorySchema = z.enum(
  Object.keys(AUDIT_CATEGORY_LABELS) as [
    OrgAuditCategory,
    ...OrgAuditCategory[],
  ],
);

import { protectedProcedure, router } from "../trpc";

export const orgAuditRouter = router({
  getOrgAuditLog: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(25),
        offset: z.number().min(0).default(0),
        action: z.string().optional(),
        // Kategori-filter (#466): udelukker hinanden med `action`
        category: categorySchema.optional(),
        targetUserId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const orgId = ctx.orgId;
      if (!orgId) return [];

      const membership = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.session.user.id),
          eq(members.organizationId, orgId),
        ),
      });

      if (
        !membership ||
        (membership.role !== "owner" && membership.role !== "admin")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "orgAudit.ownersAdminsOnly"),
        });
      }

      const conditions = [eq(orgAuditLogs.organizationId, orgId)];
      if (input.action) {
        conditions.push(eq(orgAuditLogs.action, input.action));
      } else if (input.category) {
        conditions.push(
          inArray(orgAuditLogs.action, actionsInCategory(input.category)),
        );
      }
      if (input.targetUserId) {
        conditions.push(eq(orgAuditLogs.targetUserId, input.targetUserId));
      }

      return ctx.db.query.orgAuditLogs.findMany({
        where: and(...conditions),
        orderBy: [desc(orgAuditLogs.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          actor: {
            columns: { id: true, name: true, email: true, image: true },
          },
        },
      });
    }),

  logAudit: protectedProcedure
    .input(
      z.object({
        action: z.enum([
          "member_invited",
          "member_removed",
          "member_role_changed",
          "invitation_cancelled",
          "invitation_accepted",
          "org_updated",
          "module_toggled",
        ]),
        targetEmail: z.string().optional(),
        targetUserId: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.orgId;
      if (!orgId) return { success: false };

      // Only admins/owners can write audit entries
      const membership = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.session.user.id),
          eq(members.organizationId, orgId),
        ),
      });
      if (
        !membership ||
        (membership.role !== "owner" && membership.role !== "admin")
      ) {
        return { success: false };
      }

      await logOrgAudit(
        ctx.db,
        orgId,
        ctx.session.user.id,
        input.action as OrgAuditAction,
        {
          targetEmail: input.targetEmail,
          targetUserId: input.targetUserId,
          metadata: input.metadata,
        },
      );
      return { success: true };
    }),
});
