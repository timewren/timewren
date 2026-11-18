import { readFileSync } from "node:fs";
import type { inferRouterContext } from "@trpc/server";
import { sql as drizzleSql, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteUserAccountCompletely } from "@/lib/account-deletion";
import { calculateChurnRisk } from "@/lib/admin/churn-risk";
import * as schema from "@/lib/db/schema";
import {
  connectTestDb,
  isolatedTestDatabase,
  testPostgres,
} from "@/test/test-db";
import { adminAnalyticsRouter } from "./analytics";
import { adminFinanceRouter } from "./finance";
import { adminOrganizationModulesRouter } from "./organizationModules";
import { adminProspectsRouter } from "./prospects";

vi.mock("../../trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC
    .context<{
      db: ReturnType<typeof drizzle<typeof schema>>;
      session: { user: { id: string } };
      headers: Headers;
    }>()
    .create();
  return {
    router: t.router,
    adminProcedure: t.procedure,
    supporterProcedure: t.procedure,
  };
});
vi.mock("./shared", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/alunta", () => ({
  alunta: {
    subscriptions: {
      cancel: vi.fn(),
      listAll: async () => [
        { uuid: "sub-test-seats", external_customer_id: "auto-org" },
        {
          uuid: "sub-test-replaced",
          customer: {
            uuid: "shared-customer",
            external_customer_id: "auto-org",
          },
        },
        {
          uuid: "sub-real-extra",
          external_customer_id: "real-org",
          customer: { uuid: "shared-customer" },
        },
      ],
    },
    transactions: {
      list: async ({ invoiced }: { invoiced: string }) => ({
        data:
          invoiced === "true"
            ? [
                {
                  membership: { uuid: "sub-customer" },
                  customer: { uuid: "shared-customer" },
                  price: 10000,
                  period_start: "2026-11-01",
                },
                {
                  membership: { uuid: "sub-email-test" },
                  customer: { uuid: "shared-customer" },
                  price: 2000,
                  period_start: "2026-11-01",
                },
                {
                  membership: { uuid: "sub-demo" },
                  price: 8000,
                  period_start: "2026-11-01",
                },
                ...[
                  "sub-test-seats",
                  "sub-test-replaced",
                  "sub-real-extra",
                ].map((id) => ({
                  membership: { uuid: id },
                  price: 1000,
                  period_start: "2026-11-01",
                })),
                {
                  membership: { uuid: "sub-marked-owner" },
                  customer: { uuid: "test-customer" },
                  price: 4000,
                  period_start: "2026-11-01",
                },
              ]
            : [],
      }),
    },
  },
}));

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "admin test account metrics",
  () => {
    const database = isolatedTestDatabase();
    const sql = testPostgres({ max: 1, database: database.name });
    const db = drizzle(sql, { schema });
    type Context = inferRouterContext<typeof adminAnalyticsRouter>;
    const session = { user: { id: "admin" } } as Context["session"];
    const context = { db, session, headers: new Headers() };

    beforeAll(async () => {
      await database.create();
      await connectTestDb(sql);
      const ids = ["customer", "email-test", "marked-owner"];
      await db.insert(schema.users).values(
        ids.map((id, i) => ({
          id,
          name: id,
          email: [
            "account+kunde@company.dk",
            "account+smoke-42@company.dk",
            "owner@company.dk",
          ][i],
          onboardingCompleted: true,
        })),
      );
      await db.insert(schema.organizations).values([
        {
          id: "real-org",
          name: "Real org",
          slug: "real-org",
          metadata: "legacy metadata",
        },
        { id: "auto-org", name: "Auto org", slug: "auto-org" },
        {
          id: "marked-org",
          name: "Marked org",
          slug: "marked-org",
          isTestAccount: true,
          metadata: JSON.stringify({
            allowedDomains: ["company.dk"],
          }),
        },
      ]);
      await db.insert(schema.members).values([
        {
          id: "auto-membership",
          role: "owner",
          userId: "email-test",
          organizationId: "auto-org",
        },
        {
          id: "marked-membership",
          role: "owner,admin",
          userId: "marked-owner",
          organizationId: "marked-org",
        },
        {
          id: "real-membership",
          role: "owner",
          userId: "customer",
          organizationId: "real-org",
          createdAt: new Date(0),
        },
        {
          id: "second-membership",
          role: "owner",
          userId: "customer",
          organizationId: "marked-org",
          createdAt: new Date(),
        },
      ]);
      await db.insert(schema.clients).values([
        { userId: "customer", organizationId: "real-org", name: "Real client" },
        {
          userId: "email-test",
          organizationId: "auto-org",
          name: "Test client",
        },
        {
          userId: "marked-owner",
          organizationId: "marked-org",
          name: "Marked client",
        },
        {
          userId: "customer",
          organizationId: "marked-org",
          name: "Test workspace data",
        },
      ]);
      await db.insert(schema.sessions).values(
        ids.map((id, i) => ({
          id: `session-${id}`,
          userId: id,
          activeOrganizationId: [null, "auto-org", "marked-org"][i],
          token: `token-${id}`,
          expiresAt: new Date(Date.now() + 3600_000),
        })),
      );
      await db.insert(schema.subscriptions).values(
        ids.map((id, i) => ({
          userId: id,
          organizationId: ["real-org", "auto-org", null][i],
          billingCycle: "monthly",
          aluntaSubscriptionId: `sub-${id}`,
          aluntaCustomerId: i < 2 ? "shared-customer" : "test-customer",
          status: "active",
          isTrial: false,
          trialEndsAt: new Date(),
        })),
      );
    });

    afterAll(async () => {
      await sql.end();
      await database.drop();
    });

    it("filters signups, funnel steps and activity by default and restores them on request", async () => {
      const caller = adminAnalyticsRouter.createCaller(context);
      const funnel = await caller.getOnboardingFunnel();
      expect(funnel.slice(0, 3).map((step) => step.value)).toEqual([1, 1, 1]);
      const included = await caller.getOnboardingFunnel({
        includeTestAccounts: true,
      });
      expect(included.slice(0, 3).map((step) => step.value)).toEqual([3, 3, 3]);
      expect(await caller.getSystemStats()).toMatchObject({
        activeOrganizations: 1,
        totalClients: 1,
        newUsersThisMonth: 1,
      });
      expect(
        await caller.getSystemStats({ includeTestAccounts: true }),
      ).toMatchObject({
        activeOrganizations: 3,
        totalClients: 4,
        newUsersThisMonth: 3,
      });
      expect((await caller.getActiveUserCounts({})).mau).toBe(1);
      expect(
        (await caller.getActiveUserCounts({ includeTestAccounts: true })).mau,
      ).toBe(3);
    });

    it("keeps a platform flag through an organization settings write", async () => {
      const caller = adminOrganizationModulesRouter.createCaller(context);
      const organizationId = "marked-org";
      const staleMetadata = JSON.stringify({
        allowedDomains: ["company.dk"],
        testAccount: false,
      });
      expect(await caller.getTestAccountFlag({ organizationId })).toBe(true);
      await db
        .update(schema.organizations)
        .set({ metadata: staleMetadata })
        .where(eq(schema.organizations.id, organizationId));
      expect(await caller.getTestAccountFlag({ organizationId })).toBe(true);
      await caller.setTestAccountFlag({ organizationId, testAccount: false });
      try {
        expect(await caller.getTestAccountFlag({ organizationId })).toBe(false);
        const stats = await adminAnalyticsRouter
          .createCaller(context)
          .getSystemStats();
        expect(stats).toMatchObject({ totalUsers: 2, activeOrganizations: 2 });
        const [row] = await db
          .select({ metadata: schema.organizations.metadata })
          .from(schema.organizations)
          .where(eq(schema.organizations.id, organizationId));
        expect(row.metadata).toEqual(JSON.parse(staleMetadata));
      } finally {
        await caller.setTestAccountFlag({ organizationId, testAccount: true });
      }
    });

    it("uses the same account population for subscription counts and MRR", async () => {
      const caller = adminFinanceRouter.createCaller(context);
      const standard = await caller.getFinanceOverview();
      const included = await caller.getFinanceOverview({
        includeTestAccounts: true,
      });
      expect(standard.counts.active).toBe(1);
      expect(included.counts.active).toBe(3);
      expect(standard.mrrActual).toBeGreaterThan(0);
      expect(included.mrrActual).toBe(standard.mrrActual * 3);
    });

    it("excludes workspace signals from journey stages and churn risk", async () => {
      const [customer] = await db
        .select({ createdAt: schema.users.createdAt })
        .from(schema.users)
        .where(eq(schema.users.id, "customer"));
      await db
        .update(schema.users)
        .set({ createdAt: new Date(Date.now() - 3 * 86_400_000) })
        .where(eq(schema.users.id, "customer"));
      const [entry] = await db
        .insert(schema.timeEntries)
        .values({
          organizationId: "marked-org",
          userId: "customer",
          date: new Date(),
          hours: "1",
        })
        .returning({ id: schema.timeEntries.id });
      await db
        .update(schema.subscriptions)
        .set({ organizationId: "marked-org", status: "trialing" })
        .where(eq(schema.subscriptions.userId, "customer"));
      await db
        .update(schema.sessions)
        .set({ activeOrganizationId: "marked-org" })
        .where(eq(schema.sessions.userId, "customer"));
      try {
        const caller = adminAnalyticsRouter.createCaller(context);
        async function customerStage(includeTestAccounts: boolean) {
          const { stages } = await caller.getJourneyStages({
            includeTestAccounts,
          });
          return stages.find((stage) =>
            stage.users.some((user) => user.userId === "customer"),
          );
        }
        expect(await customerStage(false)).toMatchObject({
          key: "trial_idle",
          users: [
            { lastSessionAt: null, subStatus: null, hasTimeEntries: false },
          ],
        });
        expect(await customerStage(true)).toMatchObject({
          key: "trial_active",
          users: [
            {
              lastSessionAt: expect.any(Date),
              subStatus: "trialing",
              hasTimeEntries: true,
            },
          ],
        });
        const standard = await calculateChurnRisk(db, {});
        const included = await calculateChurnRisk(db, {
          includeTestAccounts: true,
        });
        expect(standard.find((row) => row.userId === "customer")).toMatchObject(
          { subscriptionStatus: null, daysSinceLastEntry: -1 },
        );
        expect(included.find((row) => row.userId === "customer")).toMatchObject(
          { subscriptionStatus: "trialing", daysSinceLastEntry: 0 },
        );
      } finally {
        await db
          .update(schema.users)
          .set({ createdAt: customer.createdAt })
          .where(eq(schema.users.id, "customer"));
        await db
          .delete(schema.timeEntries)
          .where(eq(schema.timeEntries.id, entry.id));
        await db
          .update(schema.subscriptions)
          .set({ organizationId: "real-org", status: "active" })
          .where(eq(schema.subscriptions.userId, "customer"));
        await db
          .update(schema.sessions)
          .set({ activeOrganizationId: null })
          .where(eq(schema.sessions.userId, "customer"));
      }
    });

    it("excludes test trials by default and includes them on request", async () => {
      await db.update(schema.subscriptions).set({ status: "trialing" });
      try {
        const caller = adminProspectsRouter.createCaller(context);
        expect(await caller.listTrials()).toMatchObject({ total: 1 });
        expect(
          await caller.listTrials({ includeTestAccounts: true }),
        ).toMatchObject({ total: 3 });
      } finally {
        await db.update(schema.subscriptions).set({ status: "active" });
      }
    });

    it("excludes historical test revenue after deleting the account", async () => {
      await db.insert(schema.users).values({
        id: "demo",
        name: "Demo",
        email: "demo@company.dk",
        isDemo: true,
      });
      await db.insert(schema.subscriptions).values({
        userId: "demo",
        billingCycle: "monthly",
        aluntaSubscriptionId: "sub-demo",
        status: "active",
        isTrial: false,
        trialEndsAt: new Date(),
      });
      const caller = adminFinanceRouter.createCaller(context);
      expect(await caller.getAluntaRevenue()).toMatchObject({
        totalRevenue: 110,
        transactionCount: 2,
      });
      await expect(
        deleteUserAccountCompletely(db, "email-test"),
      ).resolves.toEqual({ outcome: "deleted" });
      expect(await caller.getAluntaRevenue()).toMatchObject({
        totalRevenue: 110,
        transactionCount: 2,
      });
      expect(
        await caller.getAluntaRevenue({ includeTestAccounts: true }),
      ).toMatchObject({ totalRevenue: 190, transactionCount: 6 });
    });

    it("restores only the latest audited platform-admin flags", async () => {
      const ids = ["legacy-test", "legacy-cleared", "legacy-unaudited"];
      await db.insert(schema.organizations).values(
        ids.map((id) => ({
          id,
          name: id,
          slug: id,
          metadata:
            id === "legacy-test"
              ? JSON.stringify({ testAccount: true })
              : { testAccount: true },
        })),
      );
      await db.insert(schema.adminActivityLogs).values([
        {
          adminUserId: "customer",
          action: "set_test_account_flag",
          details: { organizationId: "legacy-test", testAccount: true },
        },
        ...[true, false].map((testAccount, i) => ({
          adminUserId: "customer",
          action: "set_test_account_flag",
          details: { organizationId: "legacy-cleared", testAccount },
          createdAt: new Date(i * 1000),
        })),
      ]);
      const migration = readFileSync(
        "drizzle/0161_restore_test_account_flags.sql",
        "utf8",
      );
      await db.execute(drizzleSql.raw(migration));
      const flags = await db
        .select({
          id: schema.organizations.id,
          flag: schema.organizations.isTestAccount,
        })
        .from(schema.organizations)
        .where(inArray(schema.organizations.id, ids));
      expect(
        Object.fromEntries(flags.map(({ id, flag }) => [id, flag])),
      ).toEqual({
        "legacy-test": true,
        "legacy-cleared": false,
        "legacy-unaudited": false,
      });
    });
  },
);
