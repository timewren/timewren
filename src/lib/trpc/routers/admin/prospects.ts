import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  members,
  organizations,
  sessions,
  subscriptions,
  users,
} from "@/lib/db/schema";
import { excludeTestSubscription } from "@/lib/test-accounts";
import { adminProcedure, router } from "../../trpc";
import { logAdminAction } from "./shared";

const trialListProcedure = adminProcedure.input(
  z.object({ includeTestAccounts: z.boolean().optional() }).optional(),
);

/**
 * Prospects router: tracks demo accounts (seed data, internal testers)
 * and trial users (potential paying customers) so admin can tell them
 * apart and see who's about to convert / churn.
 */
export const adminProspectsRouter = router({
  /**
   * Full roster of demo users grouped by organization (if any). Shows
   * when they were created and when they last logged in so admin can
   * spot stale demos.
   */
  listDemos: adminProcedure.query(async ({ ctx }) => {
    await logAdminAction(
      ctx.db,
      ctx.session.user.id,
      "view_demo_overview",
      null,
      null,
      ctx.headers,
    );

    const demoUsers = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        onboardingCompleted: users.onboardingCompleted,
      })
      .from(users)
      .where(eq(users.isDemo, true))
      .orderBy(desc(users.createdAt));

    // Fetch last session per demo user in one query
    const lastSessionRows = await ctx.db
      .select({
        userId: sessions.userId,
        lastSession: sql<Date>`MAX(${sessions.createdAt})`
          .mapWith(sessions.createdAt)
          .as("lastSession"),
      })
      .from(sessions)
      .groupBy(sessions.userId);
    const lastSessionMap = new Map(
      lastSessionRows.map((r) => [r.userId, r.lastSession]),
    );

    // Fetch org membership per demo user
    const demoUserIds = demoUsers.map((u) => u.id);
    const memberships = demoUserIds.length
      ? await ctx.db
          .select({
            userId: members.userId,
            orgId: members.organizationId,
            orgName: organizations.name,
            role: members.role,
          })
          .from(members)
          .leftJoin(organizations, eq(members.organizationId, organizations.id))
          .where(
            sql`${members.userId} IN (${sql.join(
              demoUserIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
      : [];
    const membershipMap = new Map<
      string,
      { orgId: string; orgName: string | null; role: string }
    >();
    for (const m of memberships) {
      if (!membershipMap.has(m.userId)) {
        membershipMap.set(m.userId, {
          orgId: m.orgId,
          orgName: m.orgName,
          role: m.role,
        });
      }
    }

    // Group by organization for a cleaner admin view
    const byOrg = new Map<
      string,
      {
        orgId: string;
        orgName: string;
        users: Array<
          (typeof demoUsers)[number] & {
            lastSession: Date | null;
            orgRole: string | null;
          }
        >;
      }
    >();
    const orphanKey = "__orphan__";

    for (const u of demoUsers) {
      const m = membershipMap.get(u.id);
      const key = m?.orgId ?? orphanKey;
      const orgName = m?.orgName ?? "Uden organisation";
      let group = byOrg.get(key);
      if (!group) {
        group = { orgId: key, orgName, users: [] };
        byOrg.set(key, group);
      }
      group.users.push({
        ...u,
        lastSession: lastSessionMap.get(u.id) ?? null,
        orgRole: m?.role ?? null,
      });
    }

    return {
      totalDemoUsers: demoUsers.length,
      groups: Array.from(byOrg.values()).sort(
        (a, b) => b.users.length - a.users.length,
      ),
    };
  }),

  /**
   * Trial users with subscription-configuration status: have they
   * already committed to paying (alunta_subscription_id present) or
   * are they floating without a plan?
   */
  listTrials: trialListProcedure.query(async ({ ctx, input }) => {
    await logAdminAction(
      ctx.db,
      ctx.session.user.id,
      "view_trials_overview",
      null,
      null,
      ctx.headers,
    );

    const now = new Date();

    const rows = await ctx.db
      .select({
        subId: subscriptions.id,
        userId: subscriptions.userId,
        status: subscriptions.status,
        billingCycle: subscriptions.billingCycle,
        trialEndsAt: subscriptions.trialEndsAt,
        aluntaSubscriptionId: subscriptions.aluntaSubscriptionId,
        aluntaCustomerId: subscriptions.aluntaCustomerId,
        aluntaPlanId: subscriptions.aluntaPlanId,
        foundingTier: subscriptions.foundingTier,
        discountPercent: subscriptions.discountPercent,
        promoCode: subscriptions.promoCode,
        createdAt: subscriptions.createdAt,
        updatedAt: subscriptions.updatedAt,
        userName: users.name,
        userEmail: users.email,
        onboardingCompleted: users.onboardingCompleted,
      })
      .from(subscriptions)
      .leftJoin(users, eq(subscriptions.userId, users.id))
      // "free" = udløbet trial nedgraderet til Gratis-tieren (reverse trial) —
      // stadig en opgraderings-prospect, så den tæller med som udløbet.
      .where(
        and(
          inArray(subscriptions.status, ["trialing", "trial_expired", "free"]),
          sql`${users.isDemo} is not true`,
          excludeTestSubscription(input?.includeTestAccounts),
        ),
      )
      .orderBy(subscriptions.trialEndsAt);

    // Classify: committed (has alunta subscription — payment set up) vs
    // floating (no alunta subscription yet — will silently end when trial
    // does, unless we nudge them)
    const trials = rows.map((r) => {
      const committed = Boolean(r.aluntaSubscriptionId);
      const daysUntilEnd = r.trialEndsAt
        ? Math.ceil(
            (r.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          )
        : null;
      const urgency: "expired" | "urgent" | "soon" | "ok" =
        daysUntilEnd === null
          ? "ok"
          : daysUntilEnd < 0
            ? "expired"
            : daysUntilEnd <= 3
              ? "urgent"
              : daysUntilEnd <= 14
                ? "soon"
                : "ok";
      return {
        ...r,
        committed,
        daysUntilEnd,
        urgency,
      };
    });

    // Split into active trials vs. already-expired trials
    const activeTrials = trials.filter((t) => t.status === "trialing");
    const expiredTrials = trials.filter(
      (t) => t.status === "trial_expired" || t.status === "free",
    );

    const committedCount = activeTrials.filter((t) => t.committed).length;
    const floatingCount = activeTrials.filter((t) => !t.committed).length;
    const expiringSoonCount = activeTrials.filter(
      (t) => t.urgency === "urgent" || t.urgency === "expired",
    ).length;

    return {
      total: activeTrials.length,
      committed: committedCount,
      floating: floatingCount,
      expiringSoon: expiringSoonCount,
      expiredCount: expiredTrials.length,
      trials: activeTrials,
      expiredTrials,
    };
  }),

  /**
   * Toggle an individual user's is_demo flag. Lets admin promote a real
   * test user to excluded status or demote a former demo back to real.
   */
  setUserDemo: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        isDemo: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        input.isDemo ? "mark_user_demo" : "unmark_user_demo",
        input.userId,
        null,
        ctx.headers,
      );
      await ctx.db
        .update(users)
        .set({ isDemo: input.isDemo, updatedAt: new Date() })
        .where(eq(users.id, input.userId));
      return { success: true };
    }),
});
