import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WEBHOOK_SECRET = "whsec_unit_test_secret";

const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
const conflicts: Array<{
  table: unknown;
  values: Record<string, unknown>;
  opts: unknown;
}> = [];
const updates: Array<Record<string, unknown>> = [];
const deletes: unknown[] = [];
let existingLicense: Record<string, unknown> | undefined;

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      webhookEvents: {
        findFirst: vi.fn(async (_arg: unknown) => undefined),
      },
      users: { findFirst: vi.fn(async () => undefined) },
      desktopLicenses: { findFirst: vi.fn(async () => existingLicense) },
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return Object.assign(Promise.resolve(), {
          onConflictDoUpdate: async (opts: unknown) => {
            conflicts.push({ table, values, opts });
          },
        });
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        deletes.push(table);
      },
    }),
  },
}));

const sendLicenseKeyEmail = vi.fn(async () => undefined);
vi.mock("@/lib/email/desktop-license", () => ({
  sendLicenseKeyEmail: (...args: unknown[]) =>
    (sendLicenseKeyEmail as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));

import { db } from "@/lib/db";
import { POST } from "../route";

const stripe = new Stripe("sk_test_dummy_not_a_real_key");

function signedRequest(payload: object, opts: { timestamp?: number } = {}) {
  const body = JSON.stringify(payload);
  const header = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
    timestamp: opts.timestamp,
  });
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": header },
    body,
  });
}

const checkoutCompleted = {
  id: "evt_test_checkout",
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_1",
      object: "checkout.session",
      mode: "payment",
      customer: "cus_test_1",
      customer_email: "buyer@example.com",
      customer_details: { email: "buyer@example.com" },
      subscription: null,
      payment_intent: "pi_test_1",
      amount_total: 49900,
      metadata: {
        tier: "lifetime",
        license_tier: "lifetime",
        max_devices: "3",
      },
    },
  },
};

const chargeRefunded = (refunded: boolean) => ({
  id: "evt_test_refund",
  object: "event",
  type: "charge.refunded",
  data: {
    object: {
      id: "ch_test_1",
      object: "charge",
      refunded,
      payment_intent: "pi_test_1",
    },
  },
});

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    inserts.length = 0;
    conflicts.length = 0;
    updates.length = 0;
    deletes.length = 0;
    existingLicense = undefined;
    sendLicenseKeyEmail.mockClear();
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy_not_a_real_key";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  // Restore console spies even when an assertion fails mid-test.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("afviser kald uden stripe-signature", async () => {
    const res = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("afviser en payload signeret med en forkert secret", async () => {
    const body = JSON.stringify(checkoutCompleted);
    const header = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: "whsec_wrong",
    });
    const res = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": header },
        body,
      }),
    );
    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it("afviser en korrekt signeret payload med for gammelt tidsstempel (tolerance)", async () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    const res = await POST(
      signedRequest(checkoutCompleted, { timestamp: tenMinutesAgo }),
    );
    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it("opretter licens og sender mail på signeret checkout.session.completed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(signedRequest(checkoutCompleted));
    expect(res.status).toBe(200);

    const license = inserts.find((i) => "licenseKey" in i.values)?.values;
    expect(license).toMatchObject({
      email: "buyer@example.com",
      tier: "lifetime",
      maxDevices: 3,
      isActive: true,
      stripeCustomerId: "cus_test_1",
      stripeSubscriptionId: null,
      stripePaymentIntentId: "pi_test_1",
      amountPaidDkk: 499,
      expiresAt: null,
    });
    expect(sendLicenseKeyEmail).toHaveBeenCalledTimes(1);
    expect(
      inserts.find((i) => i.values.eventId === "evt_test_checkout")?.values,
    ).toMatchObject({ source: "stripe", status: "success" });

    // Licensnøglen og kundens mail må aldrig havne i loggen.
    const key = String(license?.licenseKey);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(key);
    expect(logged).not.toContain("buyer@example.com");
  });

  it("behandler et event igen, når den tidligere kørsel fejlede", async () => {
    const findFirst = vi.mocked(db.query.webhookEvents.findFirst);
    findFirst.mockClear();
    const res = await POST(signedRequest(checkoutCompleted));
    expect(res.status).toBe(200);

    // Dedup må kun matche rækker, der ikke har status 'error'.
    const arg = findFirst.mock.calls[0]?.[0] as { where: unknown };
    const seen = new WeakSet<object>();
    const whereJson = JSON.stringify(arg.where, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return undefined;
        seen.add(v);
      }
      return v;
    });
    expect(whereJson).toContain('"error"');
    // ...and it must be a "not equal" condition, not eq(status, 'error').
    expect(whereJson).toContain("<>");

    // Registreringen er en upsert, så eventId's unique-constraint holder.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].values).toMatchObject({
      eventId: "evt_test_checkout",
      status: "success",
    });
  });

  it("registrerer fejl som upsert og svarer 500", async () => {
    sendLicenseKeyEmail.mockRejectedValueOnce(new Error("Resend nede"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(signedRequest(checkoutCompleted));
    expect(error).toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].values).toMatchObject({
      eventId: "evt_test_checkout",
      status: "error",
      errorMessage: "Resend nede",
    });
  });

  it("genbruger eksisterende licens ved gentaget checkout-event", async () => {
    existingLicense = {
      licenseKey: "TT-TEST-TEST-TEST-TEST",
      tier: "lifetime",
      maxDevices: 3,
      email: "buyer@example.com",
    };
    const res = await POST(signedRequest(checkoutCompleted));
    expect(res.status).toBe(200);
    expect(inserts.find((i) => "licenseKey" in i.values)).toBeUndefined();
    expect(sendLicenseKeyEmail).toHaveBeenCalledTimes(1);
    expect(sendLicenseKeyEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        licenseKey: "TT-TEST-TEST-TEST-TEST",
        tier: "lifetime",
        maxDevices: 3,
      }),
    );
  });

  it("genbruger eksisterende abonnementslicens (opslag på subscription-id)", async () => {
    const findFirst = vi.mocked(db.query.desktopLicenses.findFirst);
    findFirst.mockClear();
    existingLicense = {
      licenseKey: "TT-SUBS-SUBS-SUBS-SUBS",
      tier: "solo",
      maxDevices: 2,
      email: "buyer@example.com",
    };
    const subscriptionCheckout = {
      ...checkoutCompleted,
      id: "evt_test_subscription_checkout",
      data: {
        object: {
          ...checkoutCompleted.data.object,
          mode: "subscription",
          subscription: "sub_test_1",
          payment_intent: null,
        },
      },
    };
    const res = await POST(signedRequest(subscriptionCheckout));
    expect(res.status).toBe(200);
    expect(inserts.find((i) => "licenseKey" in i.values)).toBeUndefined();
    expect(sendLicenseKeyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ licenseKey: "TT-SUBS-SUBS-SUBS-SUBS" }),
    );

    // The lookup must go through stripe_subscription_id with the session's id.
    const seen = new WeakSet<object>();
    const whereJson = JSON.stringify(
      (findFirst.mock.calls[0]?.[0] as { where: unknown } | undefined)?.where,
      (_k, v) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return undefined;
          seen.add(v);
        }
        return v;
      },
    );
    expect(whereJson).toContain("stripe_subscription_id");
    expect(whereJson).toContain("sub_test_1");
  });

  it("deaktiverer licensen og frigør devices på fuld refundering", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    existingLicense = { id: "lic_1", licenseKey: "TT-TEST-KEY-NOT-LOGGED" };
    const res = await POST(signedRequest(chargeRefunded(true)));
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ isActive: false }]);
    expect(deletes).toHaveLength(1);
    // Refund logging identifies the license by id, never by key.
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "TT-TEST-KEY-NOT-LOGGED",
    );
  });

  it("lader licensen stå ved delvis refundering", async () => {
    existingLicense = { id: "lic_1", licenseKey: "TT-TEST" };
    const res = await POST(signedRequest(chargeRefunded(false)));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });
});
