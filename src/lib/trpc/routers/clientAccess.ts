import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import type { db as dbType } from "@/lib/db";
import { memberClientAccess, members, organizations } from "@/lib/db/schema";
import { parseOrgMetadata } from "@/lib/utils/org-metadata";
import { orgAdminProcedure, router } from "../trpc";

/**
 * Throw FORBIDDEN if the user may not access the given client (per-member
 * client-access restriction). No-op for solo users, owners/admins, and orgs
 * without any access rules. Use on endpoints that take a clientId directly so
 * a restricted member can't read a client's data by guessing its id.
 */
export async function assertClientAccess(
  db: typeof dbType,
  userId: string,
  orgId: string | null,
  clientId: string | null,
): Promise<void> {
  // Interne projekter uden kunde (#467) er ikke klient-begrænsede
  if (!orgId || !clientId) return;
  const accessible = await getAccessibleClientIds(db, userId, orgId);
  if (accessible !== null && !accessible.includes(clientId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "common.noAccessToClient"),
    });
  }
}

export async function getAccessibleClientIds(
  db: typeof dbType,
  userId: string,
  orgId: string,
): Promise<string[] | null> {
  const membership = await db.query.members.findFirst({
    where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
    columns: { id: true, role: true },
  });

  if (!membership) return [];
  if (membership.role === "owner" || membership.role === "admin") return null;

  // Per-member client access only restricts when the org has explicitly turned
  // it on (metadata.restrictClientAccess). Otherwise every member sees all
  // clients. Previously the mere existence of ONE access row silently locked
  // every other member out of all clients — a footgun the moment an admin
  // granted a single client to a single person.
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { metadata: true },
  });
  if (parseOrgMetadata(org?.metadata).restrictClientAccess !== true) {
    return null;
  }

  // Restriction is on: the member sees only the clients they've been granted
  // (an empty list means no clients, by design).
  const memberEntries = await db.query.memberClientAccess.findMany({
    where: and(
      eq(memberClientAccess.organizationId, orgId),
      eq(memberClientAccess.memberId, membership.id),
    ),
    columns: { clientId: true },
  });
  return memberEntries.map((e: { clientId: string }) => e.clientId);
}

export const clientAccessRouter = router({
  listForClient: orgAdminProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.orgId) return [];

      const orgMembers = await ctx.db.query.members.findMany({
        where: eq(members.organizationId, ctx.orgId),
        with: {
          user: { columns: { id: true, name: true, image: true } },
        },
      });

      const access = await ctx.db.query.memberClientAccess.findMany({
        where: and(
          eq(memberClientAccess.organizationId, ctx.orgId),
          eq(memberClientAccess.clientId, input.clientId),
        ),
      });

      const accessMap = new Map(access.map((a) => [a.memberId, a.accessLevel]));

      return orgMembers.map((m) => ({
        memberId: m.id,
        userId: m.user.id,
        userName: m.user.name,
        userImage: m.user.image,
        role: m.role,
        accessLevel: accessMap.get(m.id) ?? null,
      }));
    }),

  setAccess: orgAdminProcedure
    .input(
      z.object({
        memberId: z.string(),
        clientId: z.string().uuid(),
        accessLevel: z.enum(["view", "manage"]).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.orgId) return;

      const existing = await ctx.db.query.memberClientAccess.findFirst({
        where: and(
          eq(memberClientAccess.organizationId, ctx.orgId),
          eq(memberClientAccess.memberId, input.memberId),
          eq(memberClientAccess.clientId, input.clientId),
        ),
      });

      if (input.accessLevel === null) {
        if (existing) {
          await ctx.db
            .delete(memberClientAccess)
            .where(eq(memberClientAccess.id, existing.id));
        }
        return { success: true };
      }

      if (existing) {
        await ctx.db
          .update(memberClientAccess)
          .set({ accessLevel: input.accessLevel })
          .where(eq(memberClientAccess.id, existing.id));
      } else {
        await ctx.db.insert(memberClientAccess).values({
          organizationId: ctx.orgId,
          memberId: input.memberId,
          clientId: input.clientId,
          accessLevel: input.accessLevel,
          grantedBy: ctx.session.user.id,
        });
      }

      return { success: true };
    }),
});
