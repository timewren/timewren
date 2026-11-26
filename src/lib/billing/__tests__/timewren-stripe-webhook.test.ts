import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleTimewrenStripeEvent,
  type TimewrenWebhookDeps,
} from "../timewren-stripe-webhook";

/**
 * Webhook-mapping for TimeWren Cloud: alle events, brand-mismatch og
 * gamle abonnementer. Abonnementet "hentes" fra en falsk Stripe, og
 * databasen er en falsk med kendte svar, så intet rammer Stripe eller
 * Postgres. Idempotens (webhook_events) testes i route-testen.
 */

vi.mock("@/lib/db", () => ({ db: {} }));

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "MULTIBRAND_ENABLED",
  "TIMEWREN_APP_ENABLED",
] as const;
const saved: Record<string, string | undefined> = {};

type Row = {
  id: string;
  userId: string;
  organizationId: string | null;
  status: string;
  pastDueSince: Date | null;
  trialEndsAt: Date;
  cancelAtPeriodEnd: boolean | null;
  stripeSubscriptionId: string | null;
};

interface FakeState {
  org: { id: string; brand: string } | undefined;
  /** Svar på subscriptions.findFirst i kaldsrækkefølge: stripe-id, org, user. */
  lookups: Array<Row | undefined>;
  updates: Record<string, unknown>[];
  inserts: Record<string, unknown>[];
}

function fakeDb(state: FakeState) {
  let call = 0;
  return {
    query: {
      organizations: { findFirst: vi.fn(async () => state.org) },
      subscriptions: {
        findFirst: vi.fn(async () => state.lookups[call++]),
      },
      users: {
        findFirst: vi.fn(async () => ({
          id: "user_tw_1",
          email: "owner@example.com",
          name: "Owner",
        })),
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(values);
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          state.inserts.push(values);
          return [{ id: "row_new" }];
        },
      }),
    }),
  };
}

const MD = {
  brand: "timewren",
  organizationId: "org_tw_1",
  userId: "user_tw_1",
  planTier: "solo",
};

function stripeSub(over: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_tw_1",
    object: "subscription",
    customer: "cus_tw_1",
    status: "active",
    metadata: MD,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    ended_at: null,
    trial_end: null,
    items: {
      data: [
        {
          id: "si_1",
          quantity: 1,
          current_period_start: 1_800_000_000,
          current_period_end: 1_802_592_000,
          price: {
            id: "price_tw_solo",
            lookup_key: "timewren_solo_monthly_eur",
            metadata: { brand: "timewren", plan_tier: "solo" },
          },
        },
      ],
    },
    ...over,
  } as unknown as Stripe.Subscription;
}

function event(type: string, object: unknown): Stripe.Event {
  return {
    id: `evt_${type}`,
    object: "event",
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

const existingRow: Row = {
  id: "row_1",
  userId: "user_tw_1",
  organizationId: "org_tw_1",
  status: "free",
  pastDueSince: null,
  trialEndsAt: new Date("2027-01-01T00:00:00Z"),
  cancelAtPeriodEnd: false,
  stripeSubscriptionId: null,
};

let state: FakeState;
let current: Stripe.Subscription;
let deps: TimewrenWebhookDeps & {
  sendPaymentFailed: ReturnType<typeof vi.fn>;
  sendCancellation: ReturnType<typeof vi.fn>;
  retrieveSubscription: ReturnType<typeof vi.fn>;
  retrieveInvoice: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.MULTIBRAND_ENABLED = "1";
  process.env.TIMEWREN_APP_ENABLED = "1";
  state = {
    org: { id: "org_tw_1", brand: "timewren" },
    lookups: [undefined, { ...existingRow }],
    updates: [],
    inserts: [],
  };
  current = stripeSub();
  deps = {
    db: fakeDb(state) as unknown as TimewrenWebhookDeps["db"],
    readSyncStartedAt: async () => "2027-01-10 12:00:00",
    withSubscriptionLock: (_id, _orgId, fn) => fn(deps.db),
    retrieveSubscription: vi.fn(async () => current),
    retrieveInvoice: vi.fn(
      async (id: string) =>
        ({ id, status: "open", amount_due: 1375 }) as Stripe.Invoice,
    ),
    sendPaymentFailed: vi.fn(async () => undefined),
    sendCancellation: vi.fn(async () => undefined),
    appUrl: "https://timewren.com",
    formatAmount: (c: number) => `€${(c / 100).toFixed(2)}`,
    now: () => new Date("2027-01-10T12:00:00Z"),
  };
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("TimeWren Stripe-webhook", () => {
  it("checkout.session.completed: Gratis-rækken bliver Selvstændig (frisk fra Stripe)", async () => {
    const res = await handleTimewrenStripeEvent(
      event("checkout.session.completed", {
        object: "checkout.session",
        mode: "subscription",
        subscription: "sub_tw_1",
        metadata: MD,
      }),
      deps,
    );
    expect(res).toEqual({ outcome: "applied", subscriptionRowId: "row_1" });
    expect(deps.retrieveSubscription).toHaveBeenCalledWith("sub_tw_1");
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({
      status: "active",
      planTier: "solo",
      seatCount: 1,
      maxSeats: 1,
      stripeCustomerId: "cus_tw_1",
      stripeSubscriptionId: "sub_tw_1",
      stripePriceId: "price_tw_solo",
      organizationId: "org_tw_1",
      cancelAtPeriodEnd: false,
      pastDueSince: null,
    });
  });

  it("checkout i betalingstilstand (desktop-lignende) ignoreres", async () => {
    const res = await handleTimewrenStripeEvent(
      event("checkout.session.completed", {
        object: "checkout.session",
        mode: "payment",
        subscription: null,
        metadata: MD,
      }),
      deps,
    );
    expect(res.outcome).toBe("ignored");
    expect(state.updates).toHaveLength(0);
  });

  it.each(["customer.subscription.created", "customer.subscription.updated"])(
    "%s: Team med 3 sæder og prøve",
    async (type) => {
      current = stripeSub({
        status: "trialing",
        trial_end: 1_801_000_000,
        metadata: { ...MD, planTier: "team" },
        items: {
          data: [
            {
              id: "si_1",
              quantity: 3,
              current_period_start: 1,
              current_period_end: 2,
              price: {
                id: "price_tw_team",
                lookup_key: "timewren_team_monthly_eur",
                metadata: { brand: "timewren", plan_tier: "team" },
              },
            },
          ],
        },
      });
      const res = await handleTimewrenStripeEvent(event(type, current), deps);
      expect(res.outcome).toBe("applied");
      expect(state.updates[0]).toMatchObject({
        status: "trialing",
        planTier: "team",
        seatCount: 3,
        maxSeats: 3,
        isTrial: true,
        trialEndsAt: new Date(1_801_000_000 * 1000),
      });
    },
  );

  it("customer.subscription.deleted: lander på Gratis", async () => {
    state.lookups = [
      { ...existingRow, status: "active", stripeSubscriptionId: "sub_tw_1" },
    ];
    current = stripeSub({ status: "canceled", canceled_at: 1_801_000_000 });
    const res = await handleTimewrenStripeEvent(
      event("customer.subscription.deleted", current),
      deps,
    );
    expect(res.outcome).toBe("applied");
    expect(state.updates[0]).toMatchObject({
      status: "free",
      planTier: "free",
      seatCount: 1,
    });
  });

  it("et gammelt abonnement, der slutter, rører ikke det nye", async () => {
    state.lookups = [
      undefined,
      { ...existingRow, status: "active", stripeSubscriptionId: "sub_new" },
    ];
    current = stripeSub({ status: "canceled" });
    const res = await handleTimewrenStripeEvent(
      event("customer.subscription.deleted", current),
      deps,
    );
    expect(res).toEqual({
      outcome: "ignored",
      reason: "superseded-subscription",
    });
    expect(state.updates).toHaveLength(0);
  });

  it("opsigelse ved periodens slutning sender TimeWren-mailen én gang", async () => {
    state.lookups = [
      { ...existingRow, status: "active", stripeSubscriptionId: "sub_tw_1" },
    ];
    current = stripeSub({ cancel_at_period_end: true });
    const cancellation = event("customer.subscription.updated", current);
    cancellation.data.previous_attributes = { cancel_at_period_end: false };
    await handleTimewrenStripeEvent(cancellation, deps);
    expect(state.updates[0]).toMatchObject({ cancelAtPeriodEnd: true });
    expect(deps.sendCancellation).toHaveBeenCalledWith({
      to: "owner@example.com",
      userName: "Owner",
      endDate: new Date(1_802_592_000 * 1000),
      reactivateUrl: "https://timewren.com/dashboard/settings/subscription",
      userId: "user_tw_1",
      idempotencyKey: "timewren-cancellation/evt_customer.subscription.updated",
    });

    // Allerede opsagt: ingen ny mail.
    deps.sendCancellation.mockClear();
    state.lookups = [
      {
        ...existingRow,
        status: "active",
        stripeSubscriptionId: "sub_tw_1",
        cancelAtPeriodEnd: true,
      },
    ];
    deps.db = fakeDb(state) as unknown as TimewrenWebhookDeps["db"];
    await handleTimewrenStripeEvent(
      event("customer.subscription.updated", current),
      deps,
    );
    expect(deps.sendCancellation).not.toHaveBeenCalled();
  });

  it("retries cancellation delivery after the subscription update committed", async () => {
    current = stripeSub({ cancel_at_period_end: true });
    const cancellation = event("customer.subscription.updated", current);
    cancellation.data.previous_attributes = { cancel_at_period_end: false };
    deps.sendCancellation.mockRejectedValueOnce(new Error("mail unavailable"));

    await expect(handleTimewrenStripeEvent(cancellation, deps)).rejects.toThrow(
      "mail unavailable",
    );
    expect(state.updates[0]).toMatchObject({ cancelAtPeriodEnd: true });
    state.lookups.push({ ...existingRow, cancelAtPeriodEnd: true });

    await handleTimewrenStripeEvent(cancellation, deps);
    expect(deps.sendCancellation).toHaveBeenCalledTimes(2);
    expect(deps.sendCancellation.mock.calls[0]?.[0].idempotencyKey).toBe(
      deps.sendCancellation.mock.calls[1]?.[0].idempotencyKey,
    );
  });

  it("ignores a delayed cancellation event after reactivation", async () => {
    const cancellation = event(
      "customer.subscription.updated",
      stripeSub({ cancel_at: 1_802_592_000 }),
    );
    cancellation.data.previous_attributes = { cancel_at: null };
    await handleTimewrenStripeEvent(cancellation, deps);
    expect(state.updates[0]).toMatchObject({ cancelAtPeriodEnd: false });
    expect(deps.sendCancellation).not.toHaveBeenCalled();
  });

  it("invoice.paid: frisk status fra Stripe (past_due → active)", async () => {
    state.lookups = [
      {
        ...existingRow,
        status: "past_due",
        pastDueSince: new Date("2027-01-02T00:00:00Z"),
        stripeSubscriptionId: "sub_tw_1",
      },
    ];
    const res = await handleTimewrenStripeEvent(
      event("invoice.paid", {
        object: "invoice",
        amount_due: 1100,
        parent: {
          subscription_details: { subscription: "sub_tw_1", metadata: MD },
        },
      }),
      deps,
    );
    expect(res.outcome).toBe("applied");
    expect(state.updates[0]).toMatchObject({
      status: "active",
      pastDueSince: null,
    });
    expect(deps.sendPaymentFailed).not.toHaveBeenCalled();
  });

  it("invoice.payment_failed: past_due og mail med EUR-beløb på brandets host", async () => {
    state.lookups = [
      { ...existingRow, status: "active", stripeSubscriptionId: "sub_tw_1" },
    ];
    current = stripeSub({ status: "past_due" });
    const res = await handleTimewrenStripeEvent(
      event("invoice.payment_failed", {
        id: "in_a",
        object: "invoice",
        amount_due: 1375,
        parent: {
          subscription_details: { subscription: "sub_tw_1", metadata: MD },
        },
      }),
      deps,
    );
    expect(res.outcome).toBe("applied");
    expect(state.updates[0]).toMatchObject({
      status: "past_due",
      pastDueSince: new Date("2027-01-10T12:00:00Z"),
    });
    expect(deps.sendPaymentFailed).toHaveBeenCalledWith({
      to: "owner@example.com",
      userName: "Owner",
      amountDue: "€13.75",
      billingPortalUrl: "https://timewren.com/dashboard/settings/subscription",
      userId: "user_tw_1",
    });
  });

  it("invoice.payment_failed ved Stripes genforsøg: status opdateres, ingen ny mail", async () => {
    state.lookups = [
      { ...existingRow, status: "past_due", stripeSubscriptionId: "sub_tw_1" },
    ];
    current = stripeSub({ status: "past_due" });
    const res = await handleTimewrenStripeEvent(
      event("invoice.payment_failed", {
        id: "in_a",
        object: "invoice",
        amount_due: 1100,
        attempt_count: 2,
        parent: {
          subscription_details: { subscription: "sub_tw_1", metadata: MD },
        },
      }),
      deps,
    );
    expect(res.outcome).toBe("applied");
    expect(state.updates[0]).toMatchObject({ status: "past_due" });
    expect(deps.sendPaymentFailed).not.toHaveBeenCalled();
  });

  it("invoice.payment_failed efter at fakturaen alligevel blev betalt: ingen mail", async () => {
    state.lookups = [
      { ...existingRow, status: "active", stripeSubscriptionId: "sub_tw_1" },
    ];
    current = stripeSub({ status: "active" });
    deps.retrieveInvoice.mockResolvedValueOnce({ id: "in_a", status: "paid" });
    const res = await handleTimewrenStripeEvent(
      event("invoice.payment_failed", {
        id: "in_a",
        object: "invoice",
        amount_due: 1100,
        attempt_count: 1,
        parent: {
          subscription_details: { subscription: "sub_tw_1", metadata: MD },
        },
      }),
      deps,
    );
    expect(res.outcome).toBe("applied");
    expect(state.updates[0]).toMatchObject({ status: "active" });
    expect(deps.sendPaymentFailed).not.toHaveBeenCalled();
  });

  it("forsinket fejl for betalt faktura A, mens nyere faktura B gør abonnementet past_due: ingen mail", async () => {
    state.lookups = [
      { ...existingRow, status: "past_due", stripeSubscriptionId: "sub_tw_1" },
    ];
    current = stripeSub({ status: "past_due" });
    deps.retrieveInvoice.mockResolvedValueOnce({
      id: "in_a",
      status: "paid",
      amount_due: 1100,
    });
    await handleTimewrenStripeEvent(
      event("invoice.payment_failed", {
        id: "in_a",
        object: "invoice",
        amount_due: 1100,
        attempt_count: 1,
        parent: {
          subscription_details: { subscription: "sub_tw_1", metadata: MD },
        },
      }),
      deps,
    );
    expect(deps.retrieveInvoice).toHaveBeenCalledWith("in_a");
    expect(deps.sendPaymentFailed).not.toHaveBeenCalled();
  });

  it("åben faktura, mens abonnementet stadig er active: mail med fakturaens aktuelle beløb", async () => {
    state.lookups = [
      { ...existingRow, status: "active", stripeSubscriptionId: "sub_tw_1" },
    ];
    current = stripeSub({ status: "active" });
    deps.retrieveInvoice.mockResolvedValueOnce({
      id: "in_b",
      status: "open",
      amount_due: 2200,
    });
    await handleTimewrenStripeEvent(
      event("invoice.payment_failed", {
        id: "in_b",
        object: "invoice",
        amount_due: 1100,
        attempt_count: 1,
        parent: {
          subscription_details: { subscription: "sub_tw_1", metadata: MD },
        },
      }),
      deps,
    );
    expect(deps.sendPaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ amountDue: "€22.00" }),
    );
  });

  it("Stripe og opsigelsesmail kører uden for abonnementets transaktion", async () => {
    const order: string[] = [];
    deps.retrieveSubscription.mockImplementation(async () => {
      order.push("retrieve");
      return current;
    });
    current = stripeSub({ cancel_at_period_end: true });
    current.items.data[0].quantity = 3;
    state.lookups = [{ ...existingRow, status: "active" }];
    deps.sendCancellation.mockImplementation(async () => {
      order.push("mail");
    });
    const lockedDb = deps.db;
    deps.withSubscriptionLock = vi.fn(async (id, orgId, fn) => {
      expect(orgId).toBe("org_tw_1");
      order.push(`lock:${id}`);
      const out = await fn(lockedDb);
      order.push("unlock");
      return out;
    }) as TimewrenWebhookDeps["withSubscriptionLock"];
    const cancellation = event("customer.subscription.updated", current);
    cancellation.data.previous_attributes = { cancel_at_period_end: false };
    const res = await handleTimewrenStripeEvent(cancellation, deps);
    expect(res).toEqual({ outcome: "applied", subscriptionRowId: "row_1" });
    expect(order).toEqual(["retrieve", "lock:sub_tw_1", "unlock", "mail"]);
    expect(state.updates).toHaveLength(1);
  });

  it("faktura uden abonnement ignoreres", async () => {
    const res = await handleTimewrenStripeEvent(
      event("invoice.paid", { object: "invoice", parent: null }),
      deps,
    );
    expect(res.outcome).toBe("ignored");
  });

  it("afviser, når organisationen ikke er en TimeWren-organisation", async () => {
    state.org = { id: "org_tw_1", brand: "timetrack" };
    const res = await handleTimewrenStripeEvent(
      event("customer.subscription.updated", current),
      deps,
    );
    expect(res).toEqual({
      outcome: "rejected",
      reason: "organization-brand-mismatch",
    });
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("afviser, når abonnementets metadata.brand ikke er timewren", async () => {
    current = stripeSub({ metadata: { ...MD, brand: "timetrack" } });
    const res = await handleTimewrenStripeEvent(
      event("customer.subscription.updated", current),
      deps,
    );
    expect(res).toEqual({
      outcome: "rejected",
      reason: "subscription-brand-mismatch",
    });
    expect(state.updates).toHaveLength(0);
  });

  it("afviser, når rækken hører til en anden organisation", async () => {
    state.lookups = [
      {
        ...existingRow,
        organizationId: "org_other",
        stripeSubscriptionId: "sub_tw_1",
      },
    ];
    const res = await handleTimewrenStripeEvent(
      event("customer.subscription.updated", current),
      deps,
    );
    expect(res).toEqual({
      outcome: "rejected",
      reason: "row-organization-mismatch",
    });
    expect(state.updates).toHaveLength(0);
  });

  it("ingen række: opretter én til køberen", async () => {
    state.lookups = [undefined, undefined, undefined];
    const res = await handleTimewrenStripeEvent(
      event("customer.subscription.created", current),
      deps,
    );
    expect(res).toEqual({ outcome: "applied", subscriptionRowId: "row_new" });
    expect(state.inserts[0]).toMatchObject({
      userId: "user_tw_1",
      organizationId: "org_tw_1",
      billingCycle: "monthly",
      status: "active",
      planTier: "solo",
    });
  });

  it("caps local seats without sending a stale quantity update to Stripe", async () => {
    current = stripeSub({
      items: {
        data: [
          {
            id: "si_9",
            quantity: 3,
            current_period_start: 1,
            current_period_end: 2,
            price: {
              id: "price_tw_solo",
              lookup_key: "timewren_solo_monthly_eur",
              metadata: { brand: "timewren", plan_tier: "solo" },
            },
          },
        ],
      },
    });
    await handleTimewrenStripeEvent(
      event("customer.subscription.updated", current),
      deps,
    );
    expect(deps.retrieveSubscription).toHaveBeenCalledTimes(1);
    expect(state.updates[0]).toMatchObject({ seatCount: 1, maxSeats: 1 });
  });

  it("slået fra (selvhost): intet sker", async () => {
    process.env.STRIPE_SECRET_KEY = "";
    const res = await handleTimewrenStripeEvent(
      event("customer.subscription.updated", current),
      deps,
    );
    expect(res.outcome).toBe("ignored");
    expect(deps.retrieveSubscription).not.toHaveBeenCalled();
  });
});
