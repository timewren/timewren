/**
 * INTEGRATION: rækker købt i appen må ikke røres af web-flows. Kører de
 * rigtige cron-handlere, Alunta-webhooken og tRPC-routerne mod Postgres og
 * tjekker både vagten (butiksrækken røres ikke) og en kontrolrække uden
 * butik (som stadig behandles), så testen beviseligt kan fange en fejl.
 * Hvor en butiksrække ikke naturligt kan ramme cronens filter (fx status
 * "trialing"), simuleres tilstanden for at teste selve vagten.
 *
 * Kører kun med TEST_DATABASE_URL sat (se account-deletion.test.ts).
 */
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

const h = vi.hoisted(() => ({ db: undefined as unknown }));

// Alle moduler der importerer `db` får testens scratch-forbindelse.
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const real = h.db as Record<string | symbol, unknown>;
        const value = real[prop];
        return typeof value === "function" ? value.bind(real) : value;
      },
    },
  ),
}));
vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging:
    (_name: string, handler: (req: Request) => Promise<unknown>) =>
    async (req: Request) =>
      handler(req),
}));
vi.mock("@/lib/email/billing", () => ({
  sendTrialEndingEmail: vi.fn(async () => {}),
  sendPaymentReminderEmail: vi.fn(async () => {}),
  sendPaymentFailedEmail: vi.fn(async () => {}),
  sendCancellationConfirmedEmail: vi.fn(async () => {}),
}));
vi.mock("@/lib/alunta", () => ({
  alunta: {
    subscriptions: {
      get: vi.fn(async (uuid: string) => ({
        data: { uuid, status: "active", plan: { uuid: "plan-team" } },
      })),
      listAllForCustomer: vi.fn(async () => []),
      cancel: vi.fn(async () => ({})),
    },
    checkoutSessions: { create: vi.fn() },
    portalLinks: { create: vi.fn() },
  },
  resolveAluntaPlanTier: vi.fn(() => "team"),
}));
vi.mock("@/lib/notifications/admin", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@/lib/modules/plan-grants", () => ({
  grantEnterpriseForTierSafe: vi.fn(async () => {}),
}));
vi.mock("@/lib/billing/auto-seats", () => ({
  syncSeatsToUsage: vi.fn(async () => ({ ok: false, reason: "test" })),
}));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-butik"),
  resolveRequestedOrgId: vi.fn(async ({ orgId }: { orgId: string }) => orgId),
}));
vi.mock("@/lib/trpc/routers/enterprise/middleware", () => ({
  resolveModules: vi.fn(async () => ({})),
  makePermissiveModules: vi.fn(() => ({})),
}));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { POST as aluntaWebhookPOST } from "@/app/api/alunta/webhook/route";
import { GET as dunningGET } from "@/app/api/cron/dunning/route";
import { GET as seatReconGET } from "@/app/api/cron/seat-reconciliation/route";
import { GET as trialExpireGET } from "@/app/api/cron/trial-expire/route";
import { GET as trialReminderGET } from "@/app/api/cron/trial-reminder/route";
import { POST as appStorePOST } from "@/app/api/webhooks/app-store/route";
import { POST as googlePlayPOST } from "@/app/api/webhooks/google-play/route";
import { alunta } from "@/lib/alunta";
import * as schema from "@/lib/db/schema";
import { members, subscriptions, users, webhookEvents } from "@/lib/db/schema";
import {
  sendPaymentReminderEmail,
  sendTrialEndingEmail,
} from "@/lib/email/billing";
import { storeBillingRouter } from "@/lib/trpc/routers/storeBilling";
import { subscriptionRouter } from "@/lib/trpc/routers/subscription";
import { userRouter } from "@/lib/trpc/routers/user";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const STORE = {
  storeProvider: "apple",
  storeStatus: "active",
  storeOriginalTransactionId: "otx-guard",
  storeProductId: "dk.timetrack.app.solo.monthly",
} as const;

const cronRequest = () => new Request("http://test/api/cron");

describe.skipIf(!TEST_DATABASE_URL)(
  "web-flows rører ikke abonnementer købt i appen (integration)",
  () => {
    const scratch = `store_guards_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });
    h.db = db;

    const sub = (userId: string) =>
      db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

    async function user(id: string) {
      await db
        .insert(users)
        .values({ id, email: `${id}@example.test`, name: id })
        .onConflictDoNothing();
    }

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of [
        "subscriptions",
        "store_billing_events",
        "members",
        "invitations",
        "user",
        "sent_emails",
        "email_delivery_logs",
        "webhook_events",
        "clients",
      ]) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("trial-expire nedgraderer ikke en butiksrække", async () => {
      const past = new Date(Date.now() - DAY);
      await db.insert(subscriptions).values([
        {
          userId: "te-web",
          billingCycle: "monthly",
          status: "trialing",
          trialEndsAt: past,
        },
        {
          userId: "te-butik",
          billingCycle: "monthly",
          status: "trialing",
          planTier: "solo",
          trialEndsAt: past,
          ...STORE,
          storeOriginalTransactionId: "otx-te",
        },
      ]);
      await trialExpireGET(cronRequest());
      expect((await sub("te-web"))?.status).toBe("free");
      expect(await sub("te-butik")).toMatchObject({
        status: "trialing",
        planTier: "solo",
      });
    });

    it("trial-reminder sender ingen web-mail til en butikskunde", async () => {
      const inSevenDays = new Date(Date.now() + 7 * DAY);
      for (const id of ["tr-web", "tr-butik"]) await user(id);
      await db.insert(subscriptions).values([
        {
          userId: "tr-web",
          billingCycle: "monthly",
          status: "trialing",
          trialEndsAt: inSevenDays,
        },
        {
          userId: "tr-butik",
          billingCycle: "monthly",
          status: "trialing",
          trialEndsAt: inSevenDays,
          ...STORE,
          storeOriginalTransactionId: "otx-tr",
        },
      ]);
      vi.mocked(sendTrialEndingEmail).mockClear();
      await trialReminderGET(cronRequest());
      const recipients = vi
        .mocked(sendTrialEndingEmail)
        .mock.calls.map((c) => c[0].userId);
      expect(recipients).toContain("tr-web");
      expect(recipients).not.toContain("tr-butik");
    });

    it("dunning rykker ikke en butikskunde med web-links", async () => {
      const since = new Date(Date.now() - 10 * DAY);
      for (const id of ["du-web", "du-butik"]) await user(id);
      await db.insert(subscriptions).values([
        {
          userId: "du-web",
          billingCycle: "monthly",
          status: "past_due",
          pastDueSince: since,
          trialEndsAt: since,
        },
        {
          userId: "du-butik",
          billingCycle: "monthly",
          status: "past_due",
          pastDueSince: since,
          trialEndsAt: since,
          ...STORE,
          storeOriginalTransactionId: "otx-du",
        },
      ]);
      vi.mocked(sendPaymentReminderEmail).mockClear();
      await dunningGET(cronRequest());
      const recipients = vi
        .mocked(sendPaymentReminderEmail)
        .mock.calls.map((c) => c[0].userId);
      expect(recipients).toContain("du-web");
      expect(recipients).not.toContain("du-butik");
    });

    it("seat-reconciliation slår ikke butiksrækkens gamle Alunta-link op", async () => {
      await db.insert(subscriptions).values([
        {
          userId: "sr-web",
          organizationId: "org-sr-web",
          billingCycle: "monthly",
          status: "active",
          planTier: "team",
          aluntaSubscriptionId: "alunta-sr-web",
          trialEndsAt: new Date(),
        },
        {
          userId: "sr-butik",
          organizationId: "org-sr-butik",
          billingCycle: "monthly",
          status: "active",
          planTier: "solo",
          aluntaSubscriptionId: "alunta-sr-gammel",
          trialEndsAt: new Date(),
          ...STORE,
          storeOriginalTransactionId: "otx-sr",
        },
      ]);
      vi.mocked(alunta.subscriptions.get).mockClear();
      await seatReconGET(cronRequest());
      const looked = vi
        .mocked(alunta.subscriptions.get)
        .mock.calls.map((c) => c[0]);
      expect(looked).toContain("alunta-sr-web");
      expect(looked).not.toContain("alunta-sr-gammel");
      expect(await sub("sr-butik")).toMatchObject({
        planTier: "solo",
        maxSeats: 1,
      });
    });

    describe("Alunta-webhook", () => {
      const secret = "test-webhook-secret";

      // Webhooken fejler lukket uden nøgle og secret (#1103), så requesten
      // signeres som Alunta gør.
      async function post(event: string, subscription: object) {
        const body = JSON.stringify({
          event,
          timestamp: new Date().toISOString(),
          data: { subscription, external_customer_id: "org-aw" },
        });
        return aluntaWebhookPOST(
          new Request("http://test/api/alunta/webhook", {
            method: "POST",
            headers: {
              Signature: createHmac("sha256", secret)
                .update(body)
                .digest("hex"),
            },
            body,
          }),
        );
      }

      beforeEach(() => {
        vi.stubEnv("ALUNTA_API_KEY", "test-alunta-key");
        vi.stubEnv("ALUNTA_WEBHOOK_SECRET", secret);
      });
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it("et gammelt web-abonnement kan ikke opsige eller ændre butiksabonnementet", async () => {
        await db.insert(subscriptions).values({
          userId: "aw-butik",
          organizationId: "org-aw",
          billingCycle: "monthly",
          status: "active",
          planTier: "solo",
          aluntaSubscriptionId: "alunta-aw-gammel",
          trialEndsAt: new Date(),
          ...STORE,
          storeOriginalTransactionId: "otx-aw",
        });

        await post("subscription.updated", {
          uuid: "alunta-aw-gammel",
          status: "canceled",
          plan: { uuid: "plan-team" },
        });
        await post("subscription.ended", { uuid: "alunta-aw-gammel" });

        expect(await sub("aw-butik")).toMatchObject({
          status: "active",
          planTier: "solo",
          storeStatus: "active",
        });
        const events = await db.query.webhookEvents.findMany({
          where: eq(webhookEvents.source, "alunta"),
        });
        const updated = events.find(
          (e) => e.eventType === "subscription.updated",
        );
        expect(updated?.status).toBe("needs_review");
        expect(updated?.errorMessage).toContain("App Store");
        // Også opsigelsen skal til et menneske: kunden kan betale to steder.
        const ended = events.find((e) => e.eventType === "subscription.ended");
        expect(ended?.status).toBe("needs_review");
        expect(ended?.errorMessage).toContain("App Store");
      });
    });

    describe("tRPC", () => {
      const callerFor = <T extends { createCaller: (ctx: never) => unknown }>(
        r: T,
        userId: string,
      ) =>
        r.createCaller({
          session: { user: { id: userId } },
          db,
          headers: null,
        } as never) as ReturnType<T["createCaller"]>;

      beforeAll(async () => {
        await user("u-butik");
        await db.insert(members).values({
          id: "m-butik",
          organizationId: "org-butik",
          userId: "u-butik",
          role: "owner",
        });
        await db.insert(subscriptions).values({
          userId: "u-butik",
          organizationId: "org-butik",
          billingCycle: "monthly",
          status: "active",
          planTier: "solo",
          aluntaSubscriptionId: "alunta-u-gammel",
          aluntaCustomerId: "kunde-u",
          trialEndsAt: new Date(),
          currentPeriodEnd: new Date(Date.now() + 20 * DAY),
          ...STORE,
          storeOriginalTransactionId: "otx-u",
        });
      });

      it("Alunta-mutationer afvises med CONFLICT for en butiksrække", async () => {
        const caller = callerFor(subscriptionRouter, "u-butik");
        await expect(caller.cancel()).rejects.toMatchObject({
          code: "CONFLICT",
        });
        await expect(
          caller.changePlan({ billingCycle: "yearly" }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await expect(
          caller.createCheckoutSession({ planTier: "team" }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await expect(caller.createPortalSession()).rejects.toMatchObject({
          code: "CONFLICT",
        });
        expect(alunta.subscriptions.cancel).not.toHaveBeenCalled();
        expect(await sub("u-butik")).toMatchObject({
          cancelAtPeriodEnd: false,
          billingCycle: "monthly",
        });
      });

      it("getDetails markerer rækken som butiksejet med link til butikken", async () => {
        const details = await callerFor(
          subscriptionRouter,
          "u-butik",
        ).getDetails();
        expect(details).toMatchObject({
          storeManaged: true,
          storeProvider: "apple",
          storeManageUrl: "https://apps.apple.com/account/subscriptions",
        });
      });

      it("kontosletning kræver bekræftelse af butiksabonnementet", async () => {
        const caller = callerFor(userRouter, "u-butik");
        await expect(caller.getAccountDeletionInfo()).resolves.toMatchObject({
          storeSubscription: {
            storeProvider: "apple",
            manageUrl: "https://apps.apple.com/account/subscriptions",
          },
        });
        await expect(
          caller.deleteAccount({ confirmEmail: "u-butik@example.test" }),
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringContaining("skal opsiges i App Store"),
        });
        expect(await sub("u-butik")).toBeDefined();

        // Org-løs bruger: rækken findes via bruger-id'et, ikke en org.
        await user("u-orgløs");
        await db.insert(subscriptions).values({
          userId: "u-orgløs",
          billingCycle: "monthly",
          status: "active",
          planTier: "privat",
          trialEndsAt: new Date(),
          ...STORE,
          storeProvider: "google",
          storeOriginalTransactionId: null,
          storePurchaseToken: "tok-orgløs",
        });
        await expect(
          callerFor(userRouter, "u-orgløs").getAccountDeletionInfo(),
        ).resolves.toMatchObject({
          storeSubscription: { storeProvider: "google" },
        });

        // Udløbet butikskøb: ingen bekræftelse.
        await db
          .update(subscriptions)
          .set({ storeStatus: "expired", status: "canceled" })
          .where(eq(subscriptions.userId, "u-orgløs"));
        await expect(
          callerFor(userRouter, "u-orgløs").getAccountDeletionInfo(),
        ).resolves.toMatchObject({ storeSubscription: null });
      });

      it("storeBilling er mørkt uden STORE_BILLING_ENABLED", async () => {
        delete process.env.STORE_BILLING_ENABLED;
        const caller = callerFor(storeBillingRouter, "u-butik");
        await expect(
          caller.verifyApple({ signedTransaction: "x" }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        await expect(
          caller.verifyGoogle({ productId: "solo", purchaseToken: "x" }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        const config = await caller.config();
        expect(config).toMatchObject({
          enabled: false,
          canPurchase: false,
          purchaseBlockedReason: "disabled",
          current: { source: "apple", planTier: "solo", status: "active" },
        });
        expect(config.products).toHaveLength(8);
        expect(config.accountToken).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      });

      it("config med STORE_BILLING_ENABLED=1 tillader køb for ejeren", async () => {
        process.env.STORE_BILLING_ENABLED = "1";
        try {
          const config = await callerFor(
            storeBillingRouter,
            "u-butik",
          ).config();
          expect(config).toMatchObject({
            enabled: true,
            canPurchase: true,
            purchaseBlockedReason: null,
          });
        } finally {
          delete process.env.STORE_BILLING_ENABLED;
        }
      });
    });

    describe("webhook-ruterne", () => {
      const req = (url: string, body: unknown) =>
        new Request(url, { method: "POST", body: JSON.stringify(body) });

      it("er mørke (404) uden STORE_BILLING_ENABLED", async () => {
        delete process.env.STORE_BILLING_ENABLED;
        process.env.GOOGLE_PLAY_WEBHOOK_TOKEN = "hemmelig";
        expect(
          (await appStorePOST(req("http://t/api/webhooks/app-store", {})))
            .status,
        ).toBe(404);
        expect(
          (
            await googlePlayPOST(
              req("http://t/api/webhooks/google-play?token=hemmelig", {}),
            )
          ).status,
        ).toBe(404);
      });

      it("Google: forkert token → 401, rigtigt token + testbesked → 200", async () => {
        process.env.STORE_BILLING_ENABLED = "1";
        process.env.GOOGLE_PLAY_WEBHOOK_TOKEN = "hemmelig";
        try {
          const body = {
            message: {
              messageId: "rute-test-1",
              data: Buffer.from(
                JSON.stringify({
                  packageName: "dk.timetrack.app",
                  testNotification: { version: "1.0" },
                }),
              ).toString("base64"),
            },
          };
          const wrong = await googlePlayPOST(
            req("http://t/api/webhooks/google-play?token=forkert", body),
          );
          expect(wrong.status).toBe(401);
          const ok = await googlePlayPOST(
            req("http://t/api/webhooks/google-play?token=hemmelig", body),
          );
          expect(ok.status).toBe(200);
          expect(await ok.json()).toMatchObject({ outcome: "test" });
        } finally {
          delete process.env.STORE_BILLING_ENABLED;
          delete process.env.GOOGLE_PLAY_WEBHOOK_TOKEN;
        }
      });

      it("Apple: ugyldig signatur → 400", async () => {
        process.env.STORE_BILLING_ENABLED = "1";
        try {
          const res = await appStorePOST(
            req("http://t/api/webhooks/app-store", {
              signedPayload: "ikke.en.jws",
            }),
          );
          expect(res.status).toBe(400);
        } finally {
          delete process.env.STORE_BILLING_ENABLED;
        }
      });
    });
  },
);
