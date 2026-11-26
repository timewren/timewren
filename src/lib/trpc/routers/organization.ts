import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { canAutoExpandTier } from "@/lib/billing/auto-seats-rules";
import { capacityLimitsApply } from "@/lib/billing/capacity-gate";
import { isFreeSubscription, planLimits } from "@/lib/billing/plan-limits";
import { countSeatUsage } from "@/lib/billing/seat-usage";
import { maxSeatsForTier, seatPriceForTier } from "@/lib/config";
import {
  members,
  organizationModules,
  orgPeriodLocks,
  subscriptions,
} from "@/lib/db/schema";
import { ensureDefaultAbsenceTypes } from "@/lib/enterprise/absence-defaults";
import { isOrgFounding } from "@/lib/founding";
import { invalidateOrgModules } from "@/lib/modules/cache";
import { FREELANCE_BUNDLE, MODULE_KEYS } from "@/lib/modules/constants";
import { resolveOrgProfile } from "@/lib/modules/org-profile";
import { shouldMakeModuleAvailable } from "@/lib/modules/toggle";
import { DEFAULT_ORG_REGION, orgRegionFromMetadata } from "@/lib/org/region";
import { logOrgAudit } from "@/lib/org-audit";
import type { OrgRole } from "@/lib/permissions/org-role";
import { resolveEffectiveOrgRole } from "@/lib/permissions/role-access";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

/**
 * Permissive FREELANCE_BUNDLE shown to users without a resolvable active
 * organization. Mirrors the server-side `makePermissiveModules()` fallback
 * in `isAuthed` so the client UI (nav, widgets) doesn't blank out for
 * users whose org creation was missed/delayed.
 */
const FREELANCE_FALLBACK_MODULES = FREELANCE_BUNDLE.map((key) => ({
  key,
  isAvailable: true,
  isEnabled: true,
}));

export const organizationRouter = router({
  // Org-periodelås (#144): "luk marts" — tid før datoen kan ikke
  // oprettes/redigeres/slettes af nogen i org'en. Append-only audit.
  getPeriodLock: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.orgId) return { lockedBefore: null };
    const { getEffectivePeriodLock } = await import("@/lib/org/period-lock");
    const lockedBefore = await getEffectivePeriodLock(ctx.db, ctx.orgId);
    return { lockedBefore };
  }),

  setPeriodLock: orgAdminProcedure
    .input(
      z.object({
        // null = ophæv låsen
        lockedBefore: z.string().nullable(),
        note: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "organization.requiresOrg"),
        });
      }
      const lockedBefore = input.lockedBefore
        ? new Date(input.lockedBefore)
        : null;
      if (lockedBefore && Number.isNaN(lockedBefore.getTime())) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "common.invalidDate"),
        });
      }
      await ctx.db.insert(orgPeriodLocks).values({
        organizationId: ctx.orgId,
        lockedBefore,
        lockedByUserId: ctx.session.user.id,
        note: input.note?.trim() || null,
      });

      logOrgAudit(
        ctx.db,
        ctx.orgId,
        ctx.session.user.id,
        "period_lock_changed",
        {
          metadata: { lockedBefore: lockedBefore?.toISOString() ?? null },
        },
      );

      return { lockedBefore };
    }),

  /**
   * Returns the active organization along with its module state.
   * Used by the client-side useModules() hook.
   */
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.orgId) {
      return {
        id: null,
        name: null,
        slug: null,
        metadata: null,
        orgProfile: "freelance" as const,
        teamSize: null,
        region: DEFAULT_ORG_REGION,
        modules: FREELANCE_FALLBACK_MODULES,
      };
    }
    const org = await ctx.db.query.organizations.findFirst({
      where: (o, { eq }) => eq(o.id, ctx.orgId as string),
    });
    const moduleRows = await ctx.db.query.organizationModules.findMany({
      where: eq(organizationModules.organizationId, ctx.orgId),
    });
    // Medlemmer plus gyldige invitationer: menuen skjuler teampunkterne for
    // en solo-freelancer og viser dem, så snart nogen er inviteret (fund 15).
    const seats = await countSeatUsage(ctx.db, ctx.orgId);
    // Profil: eksplicit metadata.type vinder; ellers modul-heuristik
    // (se resolveOrgProfile, #452).
    const moduleOn = (key: string) =>
      moduleRows.some(
        (r) => r.moduleKey === key && r.isAvailable && r.isEnabled,
      );
    const metadataType = (org?.metadata as { type?: string } | null)?.type;
    const orgProfile = resolveOrgProfile(metadataType, moduleOn);
    return {
      id: ctx.orgId,
      name: org?.name ?? null,
      slug: org?.slug ?? null,
      metadata: org?.metadata ?? null,
      orgProfile,
      teamSize: seats.total,
      region: orgRegionFromMetadata(org?.metadata),
      modules: moduleRows.map((r) => ({
        key: r.moduleKey,
        isAvailable: r.isAvailable,
        isEnabled: r.isEnabled,
      })),
    };
  }),

  /** Founding-kunde-mærket for den aktive organisation (kun visning). */
  getFounding: protectedProcedure.query(async ({ ctx }) => ({
    isFounding: await isOrgFounding(ctx.db, ctx.orgId),
  })),

  /**
   * Toggle the `isEnabled` state of a module. Only owners/admins may call this.
   * Cannot enable a module that is not `isAvailable`.
   */
  setModuleEnabled: orgAdminProcedure
    .input(
      z.object({
        moduleKey: z.enum([...MODULE_KEYS] as [string, ...string[]]),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.orgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "organization.noActiveOrg"),
        });
      }

      const existing = await ctx.db.query.organizationModules.findFirst({
        where: and(
          eq(organizationModules.organizationId, ctx.orgId),
          eq(organizationModules.moduleKey, input.moduleKey),
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "organization.moduleNotAssigned", {
            module: input.moduleKey,
          }),
        });
      }
      const makeAvailable = shouldMakeModuleAvailable({
        enabled: input.enabled,
        isAvailable: existing.isAvailable,
      });

      await ctx.db
        .update(organizationModules)
        .set({
          isEnabled: input.enabled,
          enabledAt: input.enabled ? new Date() : existing.enabledAt,
          ...(makeAvailable
            ? { isAvailable: true, availableAt: new Date() }
            : {}),
          updatedAt: new Date(),
          updatedBy: ctx.session.user.id,
        })
        .where(eq(organizationModules.id, existing.id));
      await invalidateOrgModules(ctx.orgId);

      // Enterprise tændt: sørg for standard-fraværstyper (#435, idempotent).
      // Toggle'et er allerede committet — en fejl her må ikke rapporteres som
      // fejlet toggle (listTypes lazy-seeder alligevel ved første visning).
      if (input.moduleKey === "enterprise" && input.enabled) {
        try {
          await ensureDefaultAbsenceTypes(ctx.db, ctx.orgId);
        } catch (err) {
          console.error(
            `[modules] kunne ikke seede standard-fraværstyper for ${ctx.orgId}:`,
            err,
          );
        }
      }

      return { success: true };
    }),

  /**
   * Transfer org ownership from the current user (owner) to another member.
   * The current owner becomes admin; the target member becomes owner.
   */
  transferOwnership: orgAdminProcedure
    .input(
      z.object({
        // Better-Auth user IDs are not UUIDs (default alphanumeric IDs), so
        // .uuid() here rejected every valid id and ownership transfer always
        // failed — which also blocked the last owner from ever leaving.
        targetUserId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.orgId;
      if (!orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "organization.noActiveOrg"),
        });
      }
      if (input.targetUserId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "organization.noSelfTransfer"),
        });
      }

      await ctx.db.transaction(async (tx) => {
        // Lock both rows in a single query with deterministic order to prevent deadlock
        const lockedMembers = await tx
          .select()
          .from(members)
          .where(
            and(
              eq(members.organizationId, orgId),
              inArray(members.userId, [
                ctx.session.user.id,
                input.targetUserId,
              ]),
            ),
          )
          .for("update");

        const currentMember = lockedMembers.find(
          (m) => m.userId === ctx.session.user.id,
        );
        const targetMember = lockedMembers.find(
          (m) => m.userId === input.targetUserId,
        );

        if (currentMember?.role !== "owner") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "organization.ownerOnlyTransfer"),
          });
        }
        if (!targetMember) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "organization.memberNotFound"),
          });
        }

        await tx
          .update(members)
          .set({ role: "owner" })
          .where(
            and(
              eq(members.organizationId, orgId),
              eq(members.userId, input.targetUserId),
            ),
          );
        await tx
          .update(members)
          .set({ role: "admin" })
          .where(
            and(
              eq(members.organizationId, orgId),
              eq(members.userId, ctx.session.user.id),
            ),
          );
      });

      return { success: true };
    }),

  /**
   * Returns all members of the active org with their user info.
   * Used for team member dropdowns, team directory, etc.
   */
  /**
   * getMyRole — the caller's role in the active org plus the derived
   * canManage/isSolo flags (destructive actions hidden from plain members;
   * solo freelancers → canManage). Rollen kommer fra samme kilde som
   * rolePermissions.getMyRole (resolveEffectiveOrgRole, #457), så de to
   * aldrig er uenige om fx en profil-admin.
   */
  getMyRole: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.orgId) {
      return { role: "owner" as OrgRole, canManage: true, isSolo: true };
    }
    const role = await resolveEffectiveOrgRole(
      ctx.db,
      ctx.session.user.id,
      ctx.orgId,
    );
    return {
      role,
      canManage: role === "owner" || role === "admin",
      isSolo: false,
    };
  }),

  getMembers: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.orgId) return [];

    const memberRows = await ctx.db.query.members.findMany({
      where: eq(members.organizationId, ctx.orgId),
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    return memberRows.map((m) => ({
      userId: m.userId,
      name: m.user.name ?? m.user.email,
      email: m.user.email,
      image: m.user.image,
      role: m.role,
    }));
  }),

  /**
   * Returns seat availability info for the active organization.
   * Counts current members + pending invitations vs. the plan's maxSeats.
   */
  checkSeatAvailability: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.orgId)
      return {
        canInvite: false,
        seatsUsed: 1,
        pendingInvites: 0,
        maxSeats: 1,
        planTier: "solo",
      };

    const usage = await countSeatUsage(ctx.db, ctx.orgId);

    // Selvhost uden billing: ingen pladsgrænse og ingen plan at vise
    if (!capacityLimitsApply()) {
      return {
        canInvite: true,
        canAutoExpand: false,
        seatPrice: 0,
        seatPriceCycle: "monthly" as const,
        seatsUsed: usage.total,
        pendingInvites: usage.pendingInvites,
        maxSeats: Number.MAX_SAFE_INTEGER,
        planTier: "solo",
        billingEnabled: false,
      };
    }

    // Prefer the org subscription; fall back to the OWNER's personal sub —
    // NOT the current user's. This must mirror resolveOrgMaxSeats in auth.ts
    // (the actual invite-time enforcement). Otherwise a non-owner admin sees a
    // seat count based on their own (often absent) subscription, gets maxSeats
    // 1, and the invite button is wrongly disabled even when the org has seats.
    let sub = await ctx.db.query.subscriptions.findFirst({
      where: eq(subscriptions.organizationId, ctx.orgId),
      columns: {
        maxSeats: true,
        planTier: true,
        status: true,
        aluntaSubscriptionId: true,
        billingCycle: true,
      },
      // Samme rækkefølge som getDetails / resolveOrgSeatPolicy, så en stray
      // canceled/free-række ikke vinder over orgens betalte abonnement.
      orderBy: [
        desc(
          sql`case when ${subscriptions.status} in ('active','trialing') then 1 else 0 end`,
        ),
        desc(
          sql`case when ${subscriptions.aluntaSubscriptionId} is not null or ${subscriptions.storeProvider} is not null then 1 else 0 end`,
        ),
        desc(subscriptions.createdAt),
      ],
    });
    if (!sub) {
      const owner = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, ctx.orgId),
          eq(members.role, "owner"),
        ),
        columns: { userId: true },
      });
      if (owner) {
        // Ejerens personlige/legacy række, aldrig en række fra en ANDEN org —
        // ellers kunne ejerens tidligere (forladte) organisation styre denne
        // orgs pladsloft og pris.
        sub = await ctx.db.query.subscriptions.findFirst({
          where: and(
            eq(subscriptions.userId, owner.userId),
            or(
              isNull(subscriptions.organizationId),
              eq(subscriptions.organizationId, ctx.orgId),
            ),
          ),
          columns: {
            maxSeats: true,
            planTier: true,
            status: true,
            aluntaSubscriptionId: true,
            billingCycle: true,
          },
        });
      }
    }

    const seatsUsed = usage.total;
    // Gratis-tierens faste pladsloft — spejler resolveOrgMaxSeats (invite-hooks).
    const isFree = !!sub && isFreeSubscription(sub);
    const maxSeats = isFree
      ? planLimits("free").maxSeats
      : (sub?.maxSeats ?? 1);
    const planTier = isFree ? "free" : (sub?.planTier ?? "solo");
    // Team/Business med Alunta-kobling får automatisk en plads mere ved
    // invitation (auth.ts beforeCreateInvitation → tryAutoExpandSeats).
    const canAutoExpand =
      !!sub &&
      canAutoExpandTier({
        planTier,
        status: sub.status,
        aluntaSubscriptionId: sub.aluntaSubscriptionId,
      }) &&
      maxSeats < maxSeatsForTier(planTier);
    const seatPrice = seatPriceForTier(
      planTier,
      sub?.billingCycle === "yearly" ? "yearly" : "monthly",
    );

    return {
      canInvite: seatsUsed < maxSeats || canAutoExpand,
      canAutoExpand,
      seatPrice,
      seatPriceCycle: sub?.billingCycle === "yearly" ? "yearly" : "monthly",
      seatsUsed,
      // Udstilles separat så UI'et kan vise hvor mange pladser der er optaget
      // af afventende invitationer (og ikke kun af faktiske medlemmer).
      pendingInvites: usage.pendingInvites,
      maxSeats,
      planTier,
      billingEnabled: true,
    };
  }),
});
