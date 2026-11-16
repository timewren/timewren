/**
 * INTEGRATION: køb i appen mod rigtig Postgres — binding af køb til
 * brugerens abonnementsrække (upsert, idempotens, konflikter) og
 * tilstandsovergange fra App Store-/Google Play-notifikationer.
 * Verifier og Google-klient er falske (injiceret); DB-logikken er ægte.
 *
 * Kører kun med TEST_DATABASE_URL sat (se account-deletion.test.ts).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/notifications/admin", () => ({ notifyAdmin: vi.fn() }));

import * as schema from "@/lib/db/schema";
import { members, storeBillingEvents, subscriptions } from "@/lib/db/schema";
import { notifyAdmin } from "@/lib/notifications/admin";
import { storeAccountTokenForUser } from "../account-token";
import type { AppleVerifier } from "../apple";
import type { GooglePlayClient } from "../google";
import { applyStoreSnapshot } from "../persist";
import {
  handleAppleNotification,
  handleGooglePlayNotification,
  sweepStoreSubscriptions,
  verifyApplePurchase,
  verifyGooglePurchase,
} from "../service";
import type { GooglePurchaseData } from "../state";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-10-23T12:00:00Z");
const DAY = 86_400_000;

/** Falsk Apple-verifier: "JWS" er blot JSON. Den rigtige testes i verifiers.test.ts. */
const fakeApple: AppleVerifier = {
  verifyTransaction: async (jws) => JSON.parse(jws),
  verifyRenewalInfo: async (jws) => JSON.parse(jws),
  verifyNotification: async (payload) => JSON.parse(payload),
};

function appleTx(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    originalTransactionId: `otx-${userId}`,
    transactionId: `tx-${userId}-1`,
    bundleId: "dk.timetrack.app",
    productId: "dk.timetrack.app.solo.monthly",
    purchaseDate: NOW.getTime() - DAY,
    expiresDate: NOW.getTime() + 29 * DAY,
    environment: "Production",
    appAccountToken: storeAccountTokenForUser(userId),
    signedDate: NOW.getTime() - 60_000,
    ...overrides,
  };
}

function appleNotification(params: {
  uuid: string;
  type: string;
  subtype?: string;
  signedDate: number;
  tx: object;
  renewal?: object;
}) {
  return JSON.stringify({
    notificationType: params.type,
    subtype: params.subtype,
    notificationUUID: params.uuid,
    signedDate: params.signedDate,
    data: {
      bundleId: "dk.timetrack.app",
      environment: "Production",
      signedTransactionInfo: JSON.stringify(params.tx),
      signedRenewalInfo: params.renewal
        ? JSON.stringify(params.renewal)
        : undefined,
    },
  });
}

function fakeGoogle(purchases: Record<string, GooglePurchaseData>) {
  const acknowledged: Array<[string, string]> = [];
  const client: GooglePlayClient = {
    getSubscription: async (token) => {
      const p = purchases[token];
      if (!p) {
        const { GooglePlayPurchaseNotFoundError } = await import("../google");
        throw new GooglePlayPurchaseNotFoundError();
      }
      return p;
    },
    acknowledge: async (productId, token) => {
      acknowledged.push([productId, token]);
      const p = purchases[token];
      if (p) p.acknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
    },
  };
  return { client, acknowledged };
}

function googlePurchase(
  userId: string,
  overrides: Partial<GooglePurchaseData> = {},
  item: Record<string, unknown> = {},
): GooglePurchaseData {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    externalAccountIdentifiers: {
      obfuscatedExternalAccountId: storeAccountTokenForUser(userId),
    },
    lineItems: [
      {
        productId: "privat",
        expiryTime: new Date(NOW.getTime() + 30 * DAY).toISOString(),
        autoRenewingPlan: { autoRenewEnabled: true },
        offerDetails: { basePlanId: "monthly" },
        ...item,
      },
    ],
    ...overrides,
  };
}

function pubsub(messageId: string, notification: object) {
  return {
    message: {
      messageId,
      data: Buffer.from(
        JSON.stringify({ packageName: "dk.timetrack.app", ...notification }),
      ).toString("base64"),
    },
  };
}

describe.skipIf(!TEST_DATABASE_URL)(
  "køb i appen mod Postgres (integration)",
  () => {
    const scratch = `store_billing_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema }) as never as Parameters<
      typeof verifyApplePurchase
    >[0];

    async function row(userId: string) {
      return db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });
    }

    /** Ejer af en én-bruger-org med en server-prøveperiode (intet Alunta). */
    async function trialUser(userId: string) {
      const orgId = `org-${userId}`;
      await db.insert(members).values({
        id: `m-${userId}`,
        organizationId: orgId,
        userId,
        role: "owner",
      });
      await db.insert(subscriptions).values({
        userId,
        organizationId: orgId,
        billingCycle: "monthly",
        status: "trialing",
        isTrial: true,
        planTier: "solo",
        trialEndsAt: new Date(NOW.getTime() + 10 * DAY),
      });
      return orgId;
    }

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of [
        "subscriptions",
        "store_billing_events",
        "members",
        "invitations",
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

    beforeEach(() => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    describe("verifyApple", () => {
      it("binder et køb til brugerens række og er idempotent", async () => {
        const orgId = await trialUser("a1");
        const jws = JSON.stringify(appleTx("a1"));

        const first = await verifyApplePurchase(db, {
          userId: "a1",
          orgId,
          signedTransaction: jws,
          verifier: fakeApple,
          now: NOW,
        });
        expect(first).toMatchObject({
          source: "apple",
          planTier: "solo",
          status: "active",
          cancelAtPeriodEnd: false,
          productId: "dk.timetrack.app.solo.monthly",
        });
        const again = await verifyApplePurchase(db, {
          userId: "a1",
          orgId,
          signedTransaction: jws,
          verifier: fakeApple,
          now: NOW,
        });
        expect(again).toEqual(first);

        const rows = await db.query.subscriptions.findMany({
          where: eq(subscriptions.userId, "a1"),
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          storeProvider: "apple",
          storeOriginalTransactionId: "otx-a1",
          storeStatus: "active",
          storeEnvironment: "Production",
          status: "active",
          isTrial: false,
          planTier: "solo",
          seatCount: 1,
          maxSeats: 1,
          organizationId: orgId,
        });
      });

      it("opretter rækken, når brugeren ingen har (org-løs)", async () => {
        const result = await verifyApplePurchase(db, {
          userId: "a-ny",
          orgId: null,
          signedTransaction: JSON.stringify(
            appleTx("a-ny", { productId: "dk.timetrack.app.privat.yearly" }),
          ),
          verifier: fakeApple,
          now: NOW,
        });
        expect(result).toMatchObject({ source: "apple", planTier: "privat" });
        expect((await row("a-ny"))?.billingCycle).toBe("yearly");
      });

      it("FORBIDDEN når appAccountToken tilhører en anden bruger", async () => {
        const orgId = await trialUser("a2");
        await expect(
          verifyApplePurchase(db, {
            userId: "a2",
            orgId,
            signedTransaction: JSON.stringify(
              appleTx("a2", {
                appAccountToken: storeAccountTokenForUser("en-anden"),
              }),
            ),
            verifier: fakeApple,
            now: NOW,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect((await row("a2"))?.storeProvider).toBeNull();
      });

      it("FORBIDDEN når købet allerede tilhører en anden konto", async () => {
        const orgId = await trialUser("a3");
        // Samme originalTransactionId som a1's køb, men a3's eget token.
        await expect(
          verifyApplePurchase(db, {
            userId: "a3",
            orgId,
            signedTransaction: JSON.stringify(
              appleTx("a3", { originalTransactionId: "otx-a1" }),
            ),
            verifier: fakeApple,
            now: NOW,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });

      it("CONFLICT ved løbende web-abonnement — rækken røres ikke", async () => {
        const orgId = await trialUser("a4");
        await db
          .update(subscriptions)
          .set({ status: "active", aluntaSubscriptionId: "alunta-a4" })
          .where(eq(subscriptions.userId, "a4"));
        vi.mocked(notifyAdmin).mockClear();
        // Et udløbet køb (Gendan køb) er ikke betalt nu: ingen alarm.
        await expect(
          verifyApplePurchase(db, {
            userId: "a4",
            orgId,
            signedTransaction: JSON.stringify(
              appleTx("a4", { expiresDate: NOW.getTime() - DAY }),
            ),
            verifier: fakeApple,
            now: NOW,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(notifyAdmin).not.toHaveBeenCalled();
        await expect(
          verifyApplePurchase(db, {
            userId: "a4",
            orgId,
            signedTransaction: JSON.stringify(appleTx("a4")),
            verifier: fakeApple,
            now: NOW,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await row("a4")).toMatchObject({
          storeProvider: null,
          aluntaSubscriptionId: "alunta-a4",
        });
        // Apple har trukket pengene og refunderer ikke selv: en admin skal vide det.
        expect(notifyAdmin).toHaveBeenCalledTimes(1);
        expect(notifyAdmin).toHaveBeenCalledWith(
          "subscription_duplicate",
          expect.objectContaining({
            userId: "a4",
            reason: expect.stringContaining("web_subscription"),
          }),
        );
      });

      it("FORBIDDEN for et medlem, CONFLICT for en ejer med flere brugere", async () => {
        const orgId = await trialUser("a5");
        await db.insert(members).values({
          id: "m-a5-medlem",
          organizationId: orgId,
          userId: "a5-medlem",
          role: "member",
        });
        await expect(
          verifyApplePurchase(db, {
            userId: "a5-medlem",
            orgId,
            signedTransaction: JSON.stringify(appleTx("a5-medlem")),
            verifier: fakeApple,
            now: NOW,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          verifyApplePurchase(db, {
            userId: "a5",
            orgId,
            signedTransaction: JSON.stringify(appleTx("a5")),
            verifier: fakeApple,
            now: NOW,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      });

      it("et udløbet køb (Gendan køb) overskriver ikke en prøveperiode", async () => {
        const orgId = await trialUser("a6");
        const result = await verifyApplePurchase(db, {
          userId: "a6",
          orgId,
          signedTransaction: JSON.stringify(
            appleTx("a6", { expiresDate: NOW.getTime() - DAY }),
          ),
          verifier: fakeApple,
          now: NOW,
        });
        expect(result.source).toBe("none");
        expect(await row("a6")).toMatchObject({
          status: "trialing",
          storeProvider: null,
        });
      });

      it("CONFLICT når brugeren allerede har et live Google Play-abonnement", async () => {
        const orgId = await trialUser("a7");
        await db
          .update(subscriptions)
          .set({
            status: "active",
            storeProvider: "google",
            storeStatus: "active",
            storePurchaseToken: "tok-a7",
          })
          .where(eq(subscriptions.userId, "a7"));
        vi.mocked(notifyAdmin).mockClear();
        await expect(
          verifyApplePurchase(db, {
            userId: "a7",
            orgId,
            signedTransaction: JSON.stringify(appleTx("a7")),
            verifier: fakeApple,
            now: NOW,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(notifyAdmin).toHaveBeenCalledWith(
          "subscription_duplicate",
          expect.objectContaining({
            userId: "a7",
            reason: expect.stringContaining("Google Play"),
          }),
        );
      });
    });

    describe("App Store-notifikationer", () => {
      const nowPlus = (minutes: number) => NOW.getTime() + minutes * 60_000;

      it("opsigelse, fornyelse, opgradering, refundering og forsinkede events", async () => {
        const orgId = await trialUser("n1");
        await verifyApplePurchase(db, {
          userId: "n1",
          orgId,
          signedTransaction: JSON.stringify(
            appleTx("n1", { productId: "dk.timetrack.app.privat.monthly" }),
          ),
          verifier: fakeApple,
          now: NOW,
        });

        // Opsigelse: auto-renew slået fra → aktiv til periodens udløb.
        let r = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "n1-1",
            type: "DID_CHANGE_RENEWAL_STATUS",
            subtype: "AUTO_RENEW_DISABLED",
            signedDate: nowPlus(1),
            tx: appleTx("n1", { productId: "dk.timetrack.app.privat.monthly" }),
            renewal: { autoRenewStatus: 0 },
          }),
          fakeApple,
          NOW,
        );
        expect(r.outcome).toBe("applied");
        expect(await row("n1")).toMatchObject({
          status: "active",
          cancelAtPeriodEnd: true,
          planTier: "privat",
        });
        expect((await row("n1"))?.canceledAt).not.toBeNull();

        // Samme notifikation igen (gen-levering) → duplicate, intet skrevet.
        r = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "n1-1",
            type: "DID_CHANGE_RENEWAL_STATUS",
            signedDate: nowPlus(1),
            tx: appleTx("n1"),
            renewal: { autoRenewStatus: 1 },
          }),
          fakeApple,
          NOW,
        );
        expect(r.outcome).toBe("duplicate");
        expect((await row("n1"))?.cancelAtPeriodEnd).toBe(true);

        // Opgradering til Selvstændig (ny transaktion, samme original-id),
        // og auto-renew slået til igen.
        const upgradedExpiry = NOW.getTime() + 30 * DAY;
        r = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "n1-2",
            type: "DID_CHANGE_RENEWAL_PREF",
            subtype: "UPGRADE",
            signedDate: nowPlus(2),
            tx: appleTx("n1", {
              transactionId: "tx-n1-2",
              productId: "dk.timetrack.app.solo.yearly",
              expiresDate: upgradedExpiry,
            }),
            renewal: { autoRenewStatus: 1 },
          }),
          fakeApple,
          NOW,
        );
        expect(r.outcome).toBe("applied");
        const upgraded = await row("n1");
        expect(upgraded).toMatchObject({
          planTier: "solo",
          billingCycle: "yearly",
          storeProductId: "dk.timetrack.app.solo.yearly",
          cancelAtPeriodEnd: false,
          canceledAt: null,
        });
        expect(upgraded?.currentPeriodEnd?.getTime()).toBe(upgradedExpiry);

        // En forsinket notifikation fra FØR opgraderingen må ikke vinde.
        r = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "n1-gammel",
            type: "DID_RENEW",
            signedDate: nowPlus(0.5),
            tx: appleTx("n1", { productId: "dk.timetrack.app.privat.monthly" }),
            renewal: { autoRenewStatus: 1 },
          }),
          fakeApple,
          NOW,
        );
        expect(r.outcome).toBe("stale");
        expect((await row("n1"))?.planTier).toBe("solo");

        // Refundering → tilbagekaldt → Gratis (status canceled).
        r = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "n1-3",
            type: "REFUND",
            signedDate: nowPlus(3),
            tx: appleTx("n1", {
              transactionId: "tx-n1-2",
              productId: "dk.timetrack.app.solo.yearly",
              revocationDate: nowPlus(3),
            }),
          }),
          fakeApple,
          NOW,
        );
        expect(r.outcome).toBe("applied");
        expect(await row("n1")).toMatchObject({
          status: "canceled",
          storeStatus: "revoked",
          cancelAtPeriodEnd: false,
        });

        const events = await db.query.storeBillingEvents.findMany({
          where: eq(storeBillingEvents.provider, "apple"),
        });
        expect(events.map((e) => e.eventId).sort()).toEqual(
          ["n1-1", "n1-2", "n1-3", "n1-gammel"].sort(),
        );
      });

      it("grace period beholder adgang; billing retry og udløb lander på Gratis", async () => {
        const orgId = await trialUser("n2");
        await verifyApplePurchase(db, {
          userId: "n2",
          orgId,
          signedTransaction: JSON.stringify(appleTx("n2")),
          verifier: fakeApple,
          now: NOW,
        });
        const expired = appleTx("n2", { expiresDate: NOW.getTime() - 1000 });

        await handleAppleNotification(
          db,
          appleNotification({
            uuid: "n2-1",
            type: "DID_FAIL_TO_RENEW",
            subtype: "GRACE_PERIOD",
            signedDate: nowPlus(1),
            tx: expired,
            renewal: {
              autoRenewStatus: 1,
              isInBillingRetryPeriod: true,
              gracePeriodExpiresDate: NOW.getTime() + 6 * DAY,
            },
          }),
          fakeApple,
          NOW,
        );
        expect(await row("n2")).toMatchObject({
          status: "active",
          storeStatus: "grace_period",
        });

        await handleAppleNotification(
          db,
          appleNotification({
            uuid: "n2-2",
            type: "GRACE_PERIOD_EXPIRED",
            signedDate: nowPlus(2),
            tx: expired,
            renewal: { autoRenewStatus: 1, isInBillingRetryPeriod: true },
          }),
          fakeApple,
          NOW,
        );
        expect(await row("n2")).toMatchObject({
          status: "canceled",
          storeStatus: "billing_retry",
        });

        // Betalingen går igennem igen.
        await handleAppleNotification(
          db,
          appleNotification({
            uuid: "n2-3",
            type: "DID_RENEW",
            subtype: "BILLING_RECOVERY",
            signedDate: nowPlus(3),
            tx: appleTx("n2", { transactionId: "tx-n2-2" }),
            renewal: { autoRenewStatus: 1 },
          }),
          fakeApple,
          NOW,
        );
        expect(await row("n2")).toMatchObject({
          status: "active",
          storeStatus: "active",
        });

        await handleAppleNotification(
          db,
          appleNotification({
            uuid: "n2-4",
            type: "EXPIRED",
            subtype: "VOLUNTARY",
            signedDate: nowPlus(4),
            tx: expired,
            renewal: { autoRenewStatus: 0 },
          }),
          fakeApple,
          NOW,
        );
        expect(await row("n2")).toMatchObject({
          status: "canceled",
          storeStatus: "expired",
        });
      });

      it("ignorerer ukendte køb og TEST-notifikationer", async () => {
        const unknown = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "ukendt-1",
            type: "SUBSCRIBED",
            subtype: "INITIAL_BUY",
            signedDate: nowPlus(1),
            tx: appleTx("aldrig-bundet"),
          }),
          fakeApple,
          NOW,
        );
        expect(unknown.outcome).toBe("unknown_subscription");
        const test = await handleAppleNotification(
          db,
          JSON.stringify({ notificationType: "TEST", notificationUUID: "t-1" }),
          fakeApple,
          NOW,
        );
        expect(test.outcome).toBe("test");
      });
    });

    describe("Google Play", () => {
      it("verifyGoogle binder, acknowledger én gang og er idempotent", async () => {
        const orgId = await trialUser("g1");
        const { client, acknowledged } = fakeGoogle({
          "tok-g1": googlePurchase("g1"),
        });
        const result = await verifyGooglePurchase(db, {
          userId: "g1",
          orgId,
          productId: "privat",
          purchaseToken: "tok-g1",
          client,
          now: NOW,
        });
        expect(result).toMatchObject({
          source: "google",
          planTier: "privat",
          status: "active",
          productId: "privat",
        });
        await verifyGooglePurchase(db, {
          userId: "g1",
          orgId,
          productId: "privat",
          purchaseToken: "tok-g1",
          client,
          now: NOW,
        });
        expect(acknowledged).toEqual([["privat", "tok-g1"]]);
        expect(await row("g1")).toMatchObject({
          storeProvider: "google",
          storePurchaseToken: "tok-g1",
          storeOriginalTransactionId: null,
        });
      });

      it("afviser forkert konto, forkert produkt og acknowledger ikke afventende køb", async () => {
        const orgId = await trialUser("g2");
        const { client, acknowledged } = fakeGoogle({
          "tok-anden": googlePurchase("en-anden"),
          "tok-g2": googlePurchase("g2"),
          "tok-afventer": googlePurchase("g2", {
            subscriptionState: "SUBSCRIPTION_STATE_PENDING",
          }),
        });
        await expect(
          verifyGooglePurchase(db, {
            userId: "g2",
            orgId,
            productId: "privat",
            purchaseToken: "tok-anden",
            client,
            now: NOW,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          verifyGooglePurchase(db, {
            userId: "g2",
            orgId,
            productId: "solo",
            purchaseToken: "tok-g2",
            client,
            now: NOW,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        const pending = await verifyGooglePurchase(db, {
          userId: "g2",
          orgId,
          productId: "privat",
          purchaseToken: "tok-afventer",
          client,
          now: NOW,
        });
        expect(pending.source).toBe("none");
        expect(acknowledged).toEqual([]);
        expect((await row("g2"))?.status).toBe("trialing");
      });

      it("RTDN: plan-skift via linkedPurchaseToken, gammelt token ignoreres, on hold → Gratis", async () => {
        const orgId = await trialUser("g3");
        const purchases: Record<string, GooglePurchaseData> = {
          "tok-g3-a": googlePurchase("g3"),
        };
        const { client, acknowledged } = fakeGoogle(purchases);
        await verifyGooglePurchase(db, {
          userId: "g3",
          orgId,
          productId: "privat",
          purchaseToken: "tok-g3-a",
          client,
          now: NOW,
        });

        // Opgradering til Selvstændig årlig: nyt token, gammelt udløber.
        purchases["tok-g3-b"] = googlePurchase(
          "g3",
          { linkedPurchaseToken: "tok-g3-a" },
          { productId: "solo", offerDetails: { basePlanId: "yearly" } },
        );
        purchases["tok-g3-a"] = googlePurchase("g3", {
          subscriptionState: "SUBSCRIPTION_STATE_EXPIRED",
          acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
        });

        let r = await handleGooglePlayNotification(
          db,
          pubsub("msg-1", {
            subscriptionNotification: {
              notificationType: 4,
              purchaseToken: "tok-g3-b",
            },
          }),
          client,
          NOW,
        );
        expect(r.outcome).toBe("applied");
        expect(await row("g3")).toMatchObject({
          storePurchaseToken: "tok-g3-b",
          planTier: "solo",
          billingCycle: "yearly",
          status: "active",
        });
        // Webhooken acknowledger selv, hvis appen ikke nåede det.
        expect(acknowledged).toContainEqual(["solo", "tok-g3-b"]);

        // Det gamle tokens udløb må ikke nedgradere rækken.
        r = await handleGooglePlayNotification(
          db,
          pubsub("msg-2", {
            subscriptionNotification: {
              notificationType: 13,
              purchaseToken: "tok-g3-a",
            },
          }),
          client,
          NOW,
        );
        expect(r.outcome).toBe("unknown_subscription");
        expect((await row("g3"))?.status).toBe("active");

        // Gen-levering af samme Pub/Sub-besked.
        r = await handleGooglePlayNotification(
          db,
          pubsub("msg-1", {
            subscriptionNotification: { purchaseToken: "tok-g3-b" },
          }),
          client,
          NOW,
        );
        expect(r.outcome).toBe("duplicate");

        // Betaling fejler → on hold → Gratis.
        purchases["tok-g3-b"].subscriptionState = "SUBSCRIPTION_STATE_ON_HOLD";
        r = await handleGooglePlayNotification(
          db,
          pubsub("msg-3", {
            subscriptionNotification: {
              notificationType: 5,
              purchaseToken: "tok-g3-b",
            },
          }),
          client,
          NOW,
        );
        expect(await row("g3")).toMatchObject({
          status: "canceled",
          storeStatus: "billing_retry",
        });

        // Refundering/tilbagekaldelse (voided) → udløbet hos Google.
        purchases["tok-g3-b"].subscriptionState = "SUBSCRIPTION_STATE_EXPIRED";
        r = await handleGooglePlayNotification(
          db,
          pubsub("msg-4", {
            voidedPurchaseNotification: { purchaseToken: "tok-g3-b" },
          }),
          client,
          NOW,
        );
        expect(r.notificationType).toBe("voided");
        expect(await row("g3")).toMatchObject({
          status: "canceled",
          storeStatus: "expired",
        });
      });

      it("RTDN fra en anden app ignoreres", async () => {
        const { client } = fakeGoogle({});
        const r = await handleGooglePlayNotification(
          db,
          {
            message: {
              messageId: "fremmed",
              data: Buffer.from(
                JSON.stringify({ packageName: "dk.andet.app" }),
              ).toString("base64"),
            },
          },
          client,
          NOW,
        );
        expect(r.outcome).toBe("ignored_wrong_package");
      });
    });

    describe("ejerskab og rækkefølge (review-fund)", () => {
      const nowPlus = (minutes: number) => NOW.getTime() + minutes * 60_000;

      it("en sen notifikation for et udløbet køb rører ikke en række web har overtaget", async () => {
        const orgId = await trialUser("o1");
        await verifyApplePurchase(db, {
          userId: "o1",
          orgId,
          signedTransaction: JSON.stringify(appleTx("o1")),
          verifier: fakeApple,
          now: NOW,
        });
        const expired = appleTx("o1", { expiresDate: NOW.getTime() - 1000 });
        await handleAppleNotification(
          db,
          appleNotification({
            uuid: "o1-1",
            type: "EXPIRED",
            subtype: "VOLUNTARY",
            signedDate: nowPlus(1),
            tx: expired,
            renewal: { autoRenewStatus: 0 },
          }),
          fakeApple,
          NOW,
        );
        // Kunden køber Team på web; Alunta-webhooken overtager rækken.
        await db
          .update(subscriptions)
          .set({
            status: "active",
            planTier: "team",
            maxSeats: 5,
            seatCount: 2,
            aluntaSubscriptionId: "alunta-o1",
          })
          .where(eq(subscriptions.userId, "o1"));

        // Uger senere: Apple refunderer det gamle køb.
        const refund = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "o1-2",
            type: "REFUND",
            signedDate: nowPlus(60),
            tx: { ...expired, revocationDate: nowPlus(59) },
          }),
          fakeApple,
          NOW,
        );
        expect(refund.outcome).toBe("store_columns_only");
        expect(await row("o1")).toMatchObject({
          status: "active",
          planTier: "team",
          maxSeats: 5,
          storeStatus: "revoked",
        });

        // Det gamle køb genoptages i iOS-indstillinger, mens web løber:
        // intet skrives, admin får besked om dobbeltbetaling.
        vi.mocked(notifyAdmin).mockClear();
        const resub = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "o1-3",
            type: "SUBSCRIBED",
            subtype: "RESUBSCRIBE",
            signedDate: nowPlus(61),
            tx: appleTx("o1", {
              transactionId: "tx-o1-2",
              purchaseDate: nowPlus(61),
              expiresDate: NOW.getTime() + 30 * DAY,
            }),
            renewal: { autoRenewStatus: 1 },
          }),
          fakeApple,
          NOW,
        );
        expect(resub.outcome).toBe("conflict_web_subscription");
        expect(notifyAdmin).toHaveBeenCalledWith(
          "subscription_duplicate",
          expect.objectContaining({ userId: "o1" }),
        );
        expect(await row("o1")).toMatchObject({
          status: "active",
          planTier: "team",
          storeStatus: "revoked",
        });
      });

      it("refundering af en tidligere periode tager ikke den aktuelle", async () => {
        const orgId = await trialUser("o2");
        const current = appleTx("o2", {
          transactionId: "tx-o2-2",
          purchaseDate: NOW.getTime() - DAY,
        });
        await verifyApplePurchase(db, {
          userId: "o2",
          orgId,
          signedTransaction: JSON.stringify(current),
          verifier: fakeApple,
          now: NOW,
        });
        const r = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "o2-1",
            type: "REFUND",
            signedDate: nowPlus(1),
            tx: appleTx("o2", {
              transactionId: "tx-o2-1",
              purchaseDate: NOW.getTime() - 400 * DAY,
              expiresDate: NOW.getTime() - 35 * DAY,
              revocationDate: nowPlus(0),
            }),
          }),
          fakeApple,
          NOW,
        );
        expect(r.outcome).toBe("past_period");
        expect(await row("o2")).toMatchObject({
          status: "active",
          storeStatus: "active",
        });
      });

      it("verifyApple nedgraderer aldrig et kendt køb (grace period bevares)", async () => {
        const orgId = await trialUser("o3");
        await verifyApplePurchase(db, {
          userId: "o3",
          orgId,
          signedTransaction: JSON.stringify(appleTx("o3")),
          verifier: fakeApple,
          now: NOW,
        });
        const lapsed = appleTx("o3", {
          expiresDate: NOW.getTime() - 1000,
          signedDate: nowPlus(1),
        });
        await handleAppleNotification(
          db,
          appleNotification({
            uuid: "o3-1",
            type: "DID_FAIL_TO_RENEW",
            subtype: "GRACE_PERIOD",
            signedDate: nowPlus(1),
            tx: lapsed,
            renewal: {
              isInBillingRetryPeriod: true,
              gracePeriodExpiresDate: NOW.getTime() + 6 * DAY,
            },
          }),
          fakeApple,
          NOW,
        );
        // Appen sender samme (udløbne) transaktion igen, nyere signeret.
        const result = await verifyApplePurchase(db, {
          userId: "o3",
          orgId,
          signedTransaction: JSON.stringify({
            ...lapsed,
            signedDate: nowPlus(5),
          }),
          verifier: fakeApple,
          now: NOW,
        });
        expect(result).toMatchObject({ source: "apple", status: "active" });
        expect((await row("o3"))?.storeStatus).toBe("grace_period");
      });

      it("en samtidig skrivning med et nyt købs-id vinder over en forældet læsning", async () => {
        const orgId = await trialUser("o4");
        const { client } = fakeGoogle({ "tok-o4-a": googlePurchase("o4") });
        await verifyGooglePurchase(db, {
          userId: "o4",
          orgId,
          productId: "privat",
          purchaseToken: "tok-o4-a",
          client,
          now: NOW,
        });
        const staleRead = await row("o4");
        // Den nye tokens notifikation når at skrive først …
        await db
          .update(subscriptions)
          .set({ storePurchaseToken: "tok-o4-b", planTier: "solo" })
          .where(eq(subscriptions.userId, "o4"));
        // … og det gamle tokens udløb, læst før, må ikke overskrive den.
        const r = await applyStoreSnapshot(
          db,
          staleRead as NonNullable<typeof staleRead>,
          {
            provider: "google",
            productId: "privat",
            planTier: "privat",
            cycle: "monthly",
            environment: "Production",
            storeState: "expired",
            autoRenew: false,
            purchaseToken: "tok-o4-a",
            eventAt: new Date(nowPlus(10)),
          },
          { now: new Date(nowPlus(10)) },
        );
        expect(r.applied).toBe(false);
        expect(await row("o4")).toMatchObject({
          storePurchaseToken: "tok-o4-b",
          planTier: "solo",
          status: "active",
        });
      });

      it("gen-verificering af et erstattet Google-token giver ikke CONFLICT", async () => {
        const orgId = await trialUser("o5");
        const purchases: Record<string, GooglePurchaseData> = {
          "tok-o5-b": googlePurchase("o5", {
            linkedPurchaseToken: "tok-o5-a",
          }),
        };
        const { client } = fakeGoogle(purchases);
        await verifyGooglePurchase(db, {
          userId: "o5",
          orgId,
          productId: "privat",
          purchaseToken: "tok-o5-b",
          client,
          now: NOW,
        });
        purchases["tok-o5-a"] = googlePurchase("o5", {
          subscriptionState: "SUBSCRIPTION_STATE_EXPIRED",
        });
        const result = await verifyGooglePurchase(db, {
          userId: "o5",
          orgId,
          productId: "privat",
          purchaseToken: "tok-o5-a",
          client,
          now: NOW,
        });
        expect(result).toMatchObject({ source: "google", status: "active" });
        expect((await row("o5"))?.storePurchaseToken).toBe("tok-o5-b");
      });

      it("knytter en org-løs række til organisationen ved køb", async () => {
        await db.insert(members).values({
          id: "m-o6",
          organizationId: "org-o6",
          userId: "o6",
          role: "owner",
        });
        await db.insert(subscriptions).values({
          userId: "o6",
          organizationId: null,
          billingCycle: "monthly",
          status: "trialing",
          trialEndsAt: new Date(NOW.getTime() + DAY),
        });
        await verifyApplePurchase(db, {
          userId: "o6",
          orgId: "org-o6",
          signedTransaction: JSON.stringify(appleTx("o6")),
          verifier: fakeApple,
          now: NOW,
        });
        expect((await row("o6"))?.organizationId).toBe("org-o6");
      });
    });

    describe("sweep for tabte notifikationer", () => {
      it("henter Google-rækker over perioden frisk og melder Apple-rækker", async () => {
        const later = new Date(NOW.getTime() + 40 * DAY);
        const orgG = await trialUser("s1");
        const purchases: Record<string, GooglePurchaseData> = {
          "tok-s1": googlePurchase("s1"),
        };
        const { client } = fakeGoogle(purchases);
        await verifyGooglePurchase(db, {
          userId: "s1",
          orgId: orgG,
          productId: "privat",
          purchaseToken: "tok-s1",
          client,
          now: NOW,
        });
        const orgA = await trialUser("s2");
        await verifyApplePurchase(db, {
          userId: "s2",
          orgId: orgA,
          signedTransaction: JSON.stringify(appleTx("s2")),
          verifier: fakeApple,
          now: NOW,
        });
        // Udløbet hos Google, men notifikationen gik tabt.
        purchases["tok-s1"].subscriptionState = "SUBSCRIPTION_STATE_EXPIRED";

        const result = await sweepStoreSubscriptions(db, client, later);
        expect(result.googleUpdated).toBeGreaterThanOrEqual(1);
        expect(await row("s1")).toMatchObject({
          status: "canceled",
          storeStatus: "expired",
        });
        const s2 = await row("s2");
        expect(result.appleOverdueIds).toContain(s2?.id);
        // Apple-rækken gættes der ikke på.
        expect(s2?.status).toBe("active");
      });
    });

    describe("ejerskab, anden runde (review-fund)", () => {
      const nowPlus = (minutes: number) => NOW.getTime() + minutes * 60_000;

      /** Butikskøb der er refunderet, hvorefter rækken er overtaget af web. */
      async function takenOverByWeb(userId: string) {
        const orgId = await trialUser(userId);
        await verifyApplePurchase(db, {
          userId,
          orgId,
          signedTransaction: JSON.stringify(appleTx(userId)),
          verifier: fakeApple,
          now: NOW,
        });
        await handleAppleNotification(
          db,
          appleNotification({
            uuid: `${userId}-refund`,
            type: "REFUND",
            signedDate: nowPlus(1),
            tx: appleTx(userId, { revocationDate: nowPlus(1) }),
          }),
          fakeApple,
          NOW,
        );
        await db
          .update(subscriptions)
          .set({ status: "active", aluntaSubscriptionId: `alunta-${userId}` })
          .where(eq(subscriptions.userId, userId));
      }

      it("billing retry på et overtaget køb gør ikke rækken butiksejet igen", async () => {
        await takenOverByWeb("p1");
        const r = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "p1-fail",
            type: "DID_FAIL_TO_RENEW",
            signedDate: nowPlus(5),
            tx: appleTx("p1", { expiresDate: NOW.getTime() - 1000 }),
            renewal: { autoRenewStatus: 1, isInBillingRetryPeriod: true },
          }),
          fakeApple,
          NOW,
        );
        expect(r.outcome).toBe("store_columns_only");
        expect(await row("p1")).toMatchObject({
          storeStatus: "revoked",
          status: "active",
          aluntaSubscriptionId: "alunta-p1",
        });
      });

      it("et genoplivet køb overskriver ikke en admin-tildelt Team-plan", async () => {
        const orgId = await trialUser("p2");
        await verifyApplePurchase(db, {
          userId: "p2",
          orgId,
          signedTransaction: JSON.stringify(appleTx("p2")),
          verifier: fakeApple,
          now: NOW,
        });
        await handleAppleNotification(
          db,
          appleNotification({
            uuid: "p2-exp",
            type: "EXPIRED",
            signedDate: nowPlus(1),
            tx: appleTx("p2", { expiresDate: NOW.getTime() - 1000 }),
            renewal: { autoRenewStatus: 0 },
          }),
          fakeApple,
          NOW,
        );
        await db
          .update(subscriptions)
          .set({ status: "active", planTier: "team", maxSeats: 5 })
          .where(eq(subscriptions.userId, "p2"));
        const r = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "p2-resub",
            type: "SUBSCRIBED",
            subtype: "RESUBSCRIBE",
            signedDate: nowPlus(2),
            tx: appleTx("p2", {
              purchaseDate: nowPlus(2),
              expiresDate: NOW.getTime() + 30 * DAY,
            }),
            renewal: { autoRenewStatus: 1 },
          }),
          fakeApple,
          NOW,
        );
        expect(r.outcome).toBe("conflict_web_subscription");
        expect(await row("p2")).toMatchObject({
          planTier: "team",
          maxSeats: 5,
        });
      });

      it("et genoptaget køb på en Gratis-række giver adgangen tilbage", async () => {
        const orgId = await trialUser("p3");
        await verifyApplePurchase(db, {
          userId: "p3",
          orgId,
          signedTransaction: JSON.stringify(appleTx("p3")),
          verifier: fakeApple,
          now: NOW,
        });
        await handleAppleNotification(
          db,
          appleNotification({
            uuid: "p3-exp",
            type: "EXPIRED",
            signedDate: nowPlus(1),
            tx: appleTx("p3", { expiresDate: NOW.getTime() - 1000 }),
            renewal: { autoRenewStatus: 0 },
          }),
          fakeApple,
          NOW,
        );
        expect((await row("p3"))?.status).toBe("canceled");
        const r = await handleAppleNotification(
          db,
          appleNotification({
            uuid: "p3-resub",
            type: "SUBSCRIBED",
            subtype: "RESUBSCRIBE",
            signedDate: nowPlus(2),
            tx: appleTx("p3", {
              transactionId: "tx-p3-2",
              purchaseDate: nowPlus(2),
              expiresDate: NOW.getTime() + 30 * DAY,
            }),
            renewal: { autoRenewStatus: 1 },
          }),
          fakeApple,
          NOW,
        );
        expect(r.outcome).toBe("applied");
        expect(await row("p3")).toMatchObject({
          status: "active",
          storeStatus: "active",
        });
      });

      it("skriver ikke, hvis Alunta overtog rækken mellem læsning og skrivning", async () => {
        const orgId = await trialUser("p4");
        await db
          .update(subscriptions)
          .set({
            status: "canceled",
            storeProvider: "apple",
            storeStatus: "expired",
            storeOriginalTransactionId: "otx-p4",
          })
          .where(eq(subscriptions.userId, "p4"));
        const staleRead = await row("p4");
        await db
          .update(subscriptions)
          .set({ status: "active", aluntaSubscriptionId: "alunta-p4" })
          .where(eq(subscriptions.userId, "p4"));
        const r = await applyStoreSnapshot(
          db,
          staleRead as NonNullable<typeof staleRead>,
          {
            provider: "apple",
            productId: "dk.timetrack.app.solo.monthly",
            planTier: "solo",
            cycle: "monthly",
            environment: "Production",
            storeState: "active",
            autoRenew: true,
            originalTransactionId: "otx-p4",
            eventAt: new Date(nowPlus(3)),
          },
          { now: NOW, requireNoActiveWeb: true },
        );
        expect(r.applied).toBe(false);
        expect(await row("p4")).toMatchObject({
          status: "active",
          aluntaSubscriptionId: "alunta-p4",
          storeStatus: "expired",
          organizationId: orgId,
        });
      });
    });
  },
);
