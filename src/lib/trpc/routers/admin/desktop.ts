import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { LEGACY_DESKTOP_LIFETIME_PRICE } from "@/lib/config";
import {
  desktopAnalytics,
  desktopDevices,
  desktopLicenseDevices,
  desktopLicenses,
  desktopTrials,
  desktopWaitlist,
  users,
} from "@/lib/db/schema";
import { generateLicenseKey } from "@/lib/desktop-auth";
import { getStripe } from "@/lib/stripe";
import { adminProcedure, router } from "../../trpc";
import { logAdminAction } from "./shared";

export const adminDesktopRouter = router({
  // ============================================
  // Stats overview
  // ============================================
  getDesktopStats: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      licenseCounts,
      deviceCount,
      activeTrialCount,
      expiredTrialCount,
      waitlistCount,
      analyticsCount,
      purchaseRows,
    ] = await Promise.all([
      // License counts by tier
      ctx.db
        .select({
          tier: desktopLicenses.tier,
          count: count(),
        })
        .from(desktopLicenses)
        .where(eq(desktopLicenses.isActive, true))
        .groupBy(desktopLicenses.tier),

      // Total devices
      ctx.db.select({ count: count() }).from(desktopDevices),

      // Active trials (started within last 30 days)
      ctx.db
        .select({ count: count() })
        .from(desktopTrials)
        .where(
          gte(
            desktopTrials.startedAt,
            new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
          ),
        ),

      // Expired trials (started more than 30 days ago)
      ctx.db
        .select({ count: count() })
        .from(desktopTrials)
        .where(
          sql`${desktopTrials.startedAt} < ${new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}`,
        ),

      // Waitlist
      ctx.db.select({ count: count() }).from(desktopWaitlist),

      // Analytics events last 7 days
      ctx.db
        .select({ count: count() })
        .from(desktopAnalytics)
        .where(gte(desktopAnalytics.createdAt, sevenDaysAgo)),

      // Paid lifetime purchases (have a Stripe payment), split by active/refunded.
      // amountPaidDkk is the price actually charged (set by the Stripe webhook);
      // older purchases made before that column existed fall back to the price
      // that was in effect then (LEGACY_DESKTOP_LIFETIME_PRICE).
      ctx.db
        .select({
          isActive: desktopLicenses.isActive,
          amountPaidDkk: desktopLicenses.amountPaidDkk,
        })
        .from(desktopLicenses)
        .where(
          and(
            eq(desktopLicenses.tier, "lifetime"),
            isNotNull(desktopLicenses.stripePaymentIntentId),
          ),
        ),
    ]);

    // Desktop lifetime sales economics
    let activePurchased = 0;
    let refundedPurchased = 0;
    let revenueDkk = 0;
    for (const row of purchaseRows) {
      if (row.isActive) {
        activePurchased++;
        revenueDkk += row.amountPaidDkk ?? LEGACY_DESKTOP_LIFETIME_PRICE;
      } else {
        refundedPurchased++;
      }
    }
    const grossPurchased = activePurchased + refundedPurchased;

    // Build tier counts map
    const tierCounts: Record<string, number> = {};
    for (const row of licenseCounts) {
      tierCounts[row.tier] = row.count;
    }

    return {
      licenses: {
        lifetime: tierCounts.lifetime ?? 0,
        solo: tierCounts.solo ?? 0,
        team: tierCounts.team ?? 0,
        total: Object.values(tierCounts).reduce((a, b) => a + b, 0),
      },
      devices: deviceCount[0]?.count ?? 0,
      trials: {
        active: activeTrialCount[0]?.count ?? 0,
        expired: expiredTrialCount[0]?.count ?? 0,
      },
      waitlist: waitlistCount[0]?.count ?? 0,
      analyticsLast7Days: analyticsCount[0]?.count ?? 0,
      sales: {
        // Sum of what active lifetime purchases actually paid
        revenueDkk,
        purchased: grossPurchased,
        active: activePurchased,
        refunded: refundedPurchased,
        refundRate:
          grossPurchased > 0
            ? Math.round((refundedPurchased / grossPurchased) * 100)
            : 0,
      },
    };
  }),

  // ============================================
  // Licenses
  // ============================================
  listLicenses: adminProcedure
    .input(
      z
        .object({
          tier: z.enum(["lifetime", "solo", "team"]).optional(),
          status: z.enum(["active", "inactive"]).optional(),
          search: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      if (input?.tier) {
        conditions.push(eq(desktopLicenses.tier, input.tier));
      }

      if (input?.status === "active") {
        conditions.push(eq(desktopLicenses.isActive, true));
      } else if (input?.status === "inactive") {
        conditions.push(eq(desktopLicenses.isActive, false));
      }

      if (input?.search) {
        conditions.push(
          or(
            ilike(desktopLicenses.licenseKey, `%${input.search}%`),
            ilike(desktopLicenses.note, `%${input.search}%`),
          ),
        );
      }

      const licenses = await ctx.db
        .select({
          id: desktopLicenses.id,
          licenseKey: desktopLicenses.licenseKey,
          tier: desktopLicenses.tier,
          maxDevices: desktopLicenses.maxDevices,
          isActive: desktopLicenses.isActive,
          note: desktopLicenses.note,
          createdAt: desktopLicenses.createdAt,
          expiresAt: desktopLicenses.expiresAt,
          userId: desktopLicenses.userId,
          email: desktopLicenses.email,
          stripePaymentIntentId: desktopLicenses.stripePaymentIntentId,
          userEmail: users.email,
          userName: users.name,
        })
        .from(desktopLicenses)
        .leftJoin(users, eq(desktopLicenses.userId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(desktopLicenses.createdAt));

      // Device counts per license — keyed by licenseId so account-less
      // lifetime licenses (userId null) also report real usage.
      const deviceCounts = await ctx.db
        .select({
          licenseId: desktopLicenseDevices.licenseId,
          count: count(),
        })
        .from(desktopLicenseDevices)
        .groupBy(desktopLicenseDevices.licenseId);

      const deviceMap = new Map(
        deviceCounts.map((d) => [d.licenseId, d.count]),
      );

      return licenses.map((l) => ({
        ...l,
        devicesUsed: deviceMap.get(l.id) ?? 0,
        hasPayment: Boolean(l.stripePaymentIntentId),
      }));
    }),

  createLicense: adminProcedure
    .input(
      z.object({
        tier: z.enum(["lifetime", "solo", "team"]),
        email: z.string().email().optional(),
        maxDevices: z.number().min(1).max(100).optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const licenseKey = generateLicenseKey();
      let userId: string | null = null;

      // Find user by email if provided
      if (input.email) {
        const user = await ctx.db.query.users.findFirst({
          where: eq(users.email, input.email.toLowerCase().trim()),
          columns: { id: true },
        });
        userId = user?.id ?? null;
      }

      const defaultDevices =
        input.tier === "team" ? 10 : input.tier === "solo" ? 2 : 3;

      const [license] = await ctx.db
        .insert(desktopLicenses)
        .values({
          licenseKey,
          tier: input.tier,
          userId,
          maxDevices: input.maxDevices ?? defaultDevices,
          note: input.note ?? null,
          isActive: true,
          expiresAt: null, // Manual licenses don't expire
        })
        .returning();

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "create_desktop_license",
        userId,
        {
          licenseKey,
          tier: input.tier,
          email: input.email,
        },
        ctx.headers,
      );

      return {
        id: license.id,
        licenseKey: license.licenseKey,
        tier: license.tier,
        createdAt: license.createdAt,
      };
    }),

  deactivateLicense: adminProcedure
    .input(z.object({ licenseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const license = await ctx.db.query.desktopLicenses.findFirst({
        where: eq(desktopLicenses.id, input.licenseId),
      });

      if (!license) {
        throw new Error("Licens ikke fundet");
      }

      await ctx.db
        .update(desktopLicenses)
        .set({ isActive: false })
        .where(eq(desktopLicenses.id, input.licenseId));

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "deactivate_desktop_license",
        license.userId,
        { licenseKey: license.licenseKey },
        ctx.headers,
      );

      return { success: true };
    }),

  reactivateLicense: adminProcedure
    .input(z.object({ licenseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(desktopLicenses)
        .set({ isActive: true })
        .where(eq(desktopLicenses.id, input.licenseId));

      return { success: true };
    }),

  /**
   * Refunder en købt licens i Stripe og deaktivér den. Webhooken
   * (charge.refunded) frigør derudover devices, men vi gør det også her.
   */
  refundLicense: adminProcedure
    .input(z.object({ licenseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const license = await ctx.db.query.desktopLicenses.findFirst({
        where: eq(desktopLicenses.id, input.licenseId),
      });

      if (!license) {
        throw new Error("Licens ikke fundet");
      }

      if (!license.stripePaymentIntentId) {
        throw new Error(
          "Ingen Stripe-betaling tilknyttet denne licens — brug 'deaktivér' i stedet.",
        );
      }

      const stripe = getStripe();
      await stripe.refunds.create({
        payment_intent: license.stripePaymentIntentId,
      });

      await ctx.db
        .update(desktopLicenses)
        .set({ isActive: false })
        .where(eq(desktopLicenses.id, license.id));

      await ctx.db
        .delete(desktopLicenseDevices)
        .where(eq(desktopLicenseDevices.licenseId, license.id));

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "refund_desktop_license",
        license.userId,
        { licenseKey: license.licenseKey },
        ctx.headers,
      );

      return { success: true };
    }),

  // ============================================
  // Devices
  // ============================================
  listDevices: adminProcedure.query(async ({ ctx }) => {
    const devices = await ctx.db
      .select({
        id: desktopDevices.id,
        deviceName: desktopDevices.deviceName,
        machineId: desktopDevices.machineId,
        os: desktopDevices.os,
        lastSyncAt: desktopDevices.lastSyncAt,
        createdAt: desktopDevices.createdAt,
        userId: desktopDevices.userId,
        userEmail: users.email,
        userName: users.name,
      })
      .from(desktopDevices)
      .leftJoin(users, eq(desktopDevices.userId, users.id))
      .orderBy(desc(desktopDevices.createdAt));

    return devices;
  }),

  removeDevice: adminProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const device = await ctx.db.query.desktopDevices.findFirst({
        where: eq(desktopDevices.id, input.deviceId),
      });

      if (!device) {
        throw new Error("Enhed ikke fundet");
      }

      await ctx.db
        .delete(desktopDevices)
        .where(eq(desktopDevices.id, input.deviceId));

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "remove_desktop_device",
        device.userId,
        {
          deviceName: device.deviceName,
          machineId: device.machineId,
        },
        ctx.headers,
      );

      return { success: true };
    }),

  // ============================================
  // Trials
  // ============================================
  listTrials: adminProcedure
    .input(
      z
        .object({
          status: z.enum(["active", "expired"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const cutoff = thirtyDaysAgo.toISOString().split("T")[0];

      const conditions = [];

      if (input?.status === "active") {
        conditions.push(gte(desktopTrials.startedAt, cutoff));
      } else if (input?.status === "expired") {
        conditions.push(sql`${desktopTrials.startedAt} < ${cutoff}`);
      }

      const trials = await ctx.db
        .select()
        .from(desktopTrials)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(desktopTrials.createdAt));

      return trials.map((t) => {
        const startedDate = new Date(t.startedAt);
        const elapsed = Math.floor(
          (now.getTime() - startedDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        const daysRemaining = Math.max(30 - elapsed, 0);
        return {
          ...t,
          daysRemaining,
          isExpired: daysRemaining === 0,
        };
      });
    }),

  // ============================================
  // Waitlist
  // ============================================
  listWaitlist: adminProcedure.query(async ({ ctx }) => {
    const entries = await ctx.db
      .select()
      .from(desktopWaitlist)
      .orderBy(desc(desktopWaitlist.createdAt));

    return entries;
  }),

  getWaitlistCsv: adminProcedure.query(async ({ ctx }) => {
    const entries = await ctx.db
      .select()
      .from(desktopWaitlist)
      .orderBy(desc(desktopWaitlist.createdAt));

    const header = "email,tilmeldt";
    const rows = entries.map(
      (e) => `${e.email},${e.createdAt.toISOString().split("T")[0]}`,
    );

    return [header, ...rows].join("\n");
  }),

  // ============================================
  // Analytics
  // ============================================
  getDesktopAnalytics: adminProcedure
    .input(
      z
        .object({
          days: z.enum(["7", "30", "90"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const days = Number.parseInt(input?.days ?? "7", 10);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Popular events grouped
      const popularEvents = await ctx.db
        .select({
          event: desktopAnalytics.event,
          count: count(),
        })
        .from(desktopAnalytics)
        .where(gte(desktopAnalytics.createdAt, since))
        .groupBy(desktopAnalytics.event)
        .orderBy(desc(count()))
        .limit(20);

      // Recent events
      const recentEvents = await ctx.db
        .select()
        .from(desktopAnalytics)
        .where(gte(desktopAnalytics.createdAt, since))
        .orderBy(desc(desktopAnalytics.createdAt))
        .limit(50);

      // Total count
      const totalCount = await ctx.db
        .select({ count: count() })
        .from(desktopAnalytics)
        .where(gte(desktopAnalytics.createdAt, since));

      // Platform breakdown
      const platformBreakdown = await ctx.db
        .select({
          platform: desktopAnalytics.platform,
          count: count(),
        })
        .from(desktopAnalytics)
        .where(gte(desktopAnalytics.createdAt, since))
        .groupBy(desktopAnalytics.platform)
        .orderBy(desc(count()));

      return {
        total: totalCount[0]?.count ?? 0,
        popularEvents,
        recentEvents,
        platformBreakdown,
      };
    }),
});
