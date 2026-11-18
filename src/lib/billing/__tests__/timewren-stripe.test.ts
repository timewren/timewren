import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FREE_MAX_SEATS } from "@/lib/billing/plan-gate";
import {
  checkoutQuantity,
  eventBrand,
  invoiceSubscriptionRef,
  isStripeBillingBrand,
  isTimewrenStripeEnabled,
  normalizedQuantity,
  safeReturnPath,
  subscriptionFieldsFromStripe,
  TIMEWREN_LOOKUP_KEYS,
  tierFromPrice,
  timewrenCheckoutParams,
} from "../timewren-stripe";
import { portalConfigurationParams } from "../timewren-stripe-server";

/**
 * Betaling på TimeWren Cloud (docs/specs/timewren-cloud.md → "Betaling på
 * TimeWren"): checkout-parametre, mapping fra Stripe og slå-til-reglen.
 * Ingen kald til Stripe.
 */

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "MULTIBRAND_ENABLED",
  "TIMEWREN_APP_ENABLED",
  "DEMO_MODE",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.MULTIBRAND_ENABLED = "1";
  process.env.TIMEWREN_APP_ENABLED = "1";
  delete process.env.DEMO_MODE;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const base = {
  priceId: "price_tw_solo",
  customerId: "cus_tw_1",
  organizationId: "org_tw_1",
  userId: "user_tw_1",
  appUrl: "https://timewren.com",
};

describe("slået til", () => {
  it("kun med Stripe-nøgle og begge host-auth-flag", () => {
    expect(isTimewrenStripeEnabled()).toBe(true);
    expect(isStripeBillingBrand("timewren")).toBe(true);
    expect(isStripeBillingBrand("timetrack")).toBe(false);
  });

  it.each([
    ["STRIPE_SECRET_KEY", ""],
    ["MULTIBRAND_ENABLED", "0"],
    ["TIMEWREN_APP_ENABLED", "0"],
  ])("selvhost/flag fra: %s=%s giver ingen betaling", (key, value) => {
    process.env[key] = value;
    expect(isTimewrenStripeEnabled()).toBe(false);
    expect(isStripeBillingBrand("timewren")).toBe(false);
  });
});

describe("checkout-parametre", () => {
  it("moms, momsnummer, adresse, kampagnekoder og metadata", () => {
    const p = timewrenCheckoutParams({
      ...base,
      tier: "solo",
      quantity: 1,
      withTrial: true,
    });
    expect(p.mode).toBe("subscription");
    expect(p.automatic_tax).toEqual({ enabled: true });
    expect(p.tax_id_collection).toEqual({ enabled: true });
    expect(p.billing_address_collection).toBe("required");
    expect(p.customer_update).toEqual({ address: "auto", name: "auto" });
    expect(p.allow_promotion_codes).toBe(true);
    expect(p.customer).toBe("cus_tw_1");
    expect(p.line_items).toEqual([{ price: "price_tw_solo", quantity: 1 }]);
    const md = {
      brand: "timewren",
      organizationId: "org_tw_1",
      userId: "user_tw_1",
      planTier: "solo",
    };
    expect(p.metadata).toEqual(md);
    expect(p.subscription_data?.metadata).toEqual(md);
    expect(p.subscription_data?.trial_period_days).toBe(14);
  });

  it("success/cancel på brandets host, aldrig timetrack.dk", () => {
    const p = timewrenCheckoutParams({
      ...base,
      tier: "team",
      quantity: 3,
      withTrial: false,
    });
    expect(p.success_url).toBe(
      "https://timewren.com/dashboard/settings/subscription?success=true",
    );
    expect(p.cancel_url).toBe(
      "https://timewren.com/dashboard/settings/subscription?canceled=true",
    );
    expect(JSON.stringify(p)).not.toContain("timetrack");
  });

  it("onboardingens returnPath bevares; fremmede stier afvises", () => {
    const p = timewrenCheckoutParams({
      ...base,
      tier: "solo",
      quantity: 1,
      withTrial: true,
      returnPath: "/dashboard/onboarding?step=company_info",
    });
    expect(p.success_url).toBe(
      "https://timewren.com/dashboard/onboarding?step=company_info&success=true",
    );
    expect(safeReturnPath("https://evil.example/x")).toBe(
      "/dashboard/settings/subscription",
    );
    expect(safeReturnPath("//evil.example/dashboard")).toBe(
      "/dashboard/settings/subscription",
    );
  });

  it("Privat har ingen prøveperiode; heller ikke ved et senere abonnement", () => {
    expect(
      timewrenCheckoutParams({
        ...base,
        tier: "privat",
        quantity: 1,
        withTrial: true,
      }).subscription_data?.trial_period_days,
    ).toBeUndefined();
    expect(
      timewrenCheckoutParams({
        ...base,
        tier: "business",
        quantity: 5,
        withTrial: false,
      }).subscription_data?.trial_period_days,
    ).toBeUndefined();
  });

  it("sæder: min/max pr. plan og aldrig under pladserne i brug", () => {
    expect(checkoutQuantity("solo", 4, 3)).toBe(1);
    expect(checkoutQuantity("privat", undefined, 1)).toBe(1);
    expect(checkoutQuantity("team", undefined, 1)).toBe(2);
    expect(checkoutQuantity("team", 1, 1)).toBe(2);
    expect(checkoutQuantity("team", 4, 6)).toBe(6);
    expect(checkoutQuantity("team", 99, 1)).toBe(25);
    expect(checkoutQuantity("business", undefined, 2)).toBe(5);
    expect(checkoutQuantity("business", 80, 1)).toBe(50);
  });
});

function price(tier: keyof typeof TIMEWREN_LOOKUP_KEYS, id = `price_${tier}`) {
  return {
    id,
    lookup_key: TIMEWREN_LOOKUP_KEYS[tier],
    metadata: { brand: "timewren", plan_tier: tier },
    product: `prod_${tier}`,
    currency: "eur",
  } as unknown as Stripe.Price;
}

function sub(
  over: Partial<Stripe.Subscription> & {
    tier?: keyof typeof TIMEWREN_LOOKUP_KEYS;
    quantity?: number;
  } = {},
): Stripe.Subscription {
  const { tier = "solo", quantity = 1, ...rest } = over;
  return {
    id: "sub_tw_1",
    object: "subscription",
    customer: "cus_tw_1",
    status: "active",
    metadata: {
      brand: "timewren",
      organizationId: "org_tw_1",
      userId: "user_tw_1",
      planTier: tier,
    },
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    ended_at: null,
    trial_end: null,
    items: {
      data: [
        {
          id: "si_1",
          price: price(tier),
          quantity,
          current_period_start: 1_800_000_000,
          current_period_end: 1_802_592_000,
        },
      ],
    },
    ...rest,
  } as unknown as Stripe.Subscription;
}

describe("tier fra pris", () => {
  it("lookup_key eller TimeWren-metadata; andre priser giver null", () => {
    expect(tierFromPrice(price("team"))).toBe("team");
    expect(
      tierFromPrice({
        lookup_key: null,
        metadata: { brand: "timewren", plan_tier: "business" },
      }),
    ).toBe("business");
    expect(
      tierFromPrice({
        lookup_key: "desktop_lifetime",
        metadata: { plan_tier: "business" },
      }),
    ).toBeNull();
    expect(tierFromPrice(null)).toBeNull();
  });
});

describe("abonnement fra Stripe", () => {
  const now = new Date("2027-01-10T12:00:00Z");

  it("aktivt Team med 4 sæder", () => {
    const f = subscriptionFieldsFromStripe(
      sub({ tier: "team", quantity: 4 }),
      null,
      now,
    );
    expect(f).toMatchObject({
      status: "active",
      planTier: "team",
      seatCount: 4,
      maxSeats: 4,
      stripeSubscriptionId: "sub_tw_1",
      stripeCustomerId: "cus_tw_1",
      stripePriceId: "price_team",
      currentPeriodStart: new Date(1_800_000_000 * 1000),
      currentPeriodEnd: new Date(1_802_592_000 * 1000),
      cancelAtPeriodEnd: false,
      pastDueSince: null,
      isTrial: false,
    });
  });

  it("prøve: trialEndsAt fra Stripe", () => {
    const f = subscriptionFieldsFromStripe(
      sub({ status: "trialing", trial_end: 1_801_000_000 }),
      null,
      now,
    );
    expect(f).toMatchObject({
      status: "trialing",
      isTrial: true,
      trialEndsAt: new Date(1_801_000_000 * 1000),
    });
  });

  it("past_due: pastDueSince sættes én gang og bevares", () => {
    const first = subscriptionFieldsFromStripe(
      sub({ status: "past_due" }),
      { status: "active", pastDueSince: null, trialEndsAt: now },
      now,
    );
    expect(first.pastDueSince).toEqual(now);
    const earlier = new Date("2027-01-05T00:00:00Z");
    const again = subscriptionFieldsFromStripe(
      sub({ status: "unpaid" }),
      { status: "past_due", pastDueSince: earlier, trialEndsAt: now },
      now,
    );
    expect(again).toMatchObject({ status: "past_due", pastDueSince: earlier });
  });

  it("opsagt ved periodens slutning", () => {
    expect(
      subscriptionFieldsFromStripe(
        sub({ cancel_at_period_end: true }),
        null,
        now,
      ).cancelAtPeriodEnd,
    ).toBe(true);
  });

  it("slettet/udløbet lander på Gratis", () => {
    for (const status of ["canceled", "incomplete_expired"] as const) {
      const f = subscriptionFieldsFromStripe(
        sub({ status, tier: "team", quantity: 6, canceled_at: 1_801_000_000 }),
        null,
        now,
      );
      expect(f).toMatchObject({
        status: "free",
        planTier: "free",
        seatCount: 1,
        maxSeats: FREE_MAX_SEATS,
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: "sub_tw_1",
      });
    }
  });

  it("incomplete: kun Stripe-id'er, ingen tier eller status", () => {
    const f = subscriptionFieldsFromStripe(
      sub({ status: "incomplete" }),
      null,
      now,
    );
    expect(f).not.toHaveProperty("status");
    expect(f).not.toHaveProperty("planTier");
    expect(f.stripeSubscriptionId).toBe("sub_tw_1");
  });

  it("sæder: kun det betalte, højst tierens loft", () => {
    expect(
      subscriptionFieldsFromStripe(sub({ tier: "solo", quantity: 3 }), null)
        .seatCount,
    ).toBe(1);
    expect(
      subscriptionFieldsFromStripe(sub({ tier: "team", quantity: 40 }), null)
        .maxSeats,
    ).toBe(25);
    expect(normalizedQuantity("solo", 3)).toBe(1);
    expect(normalizedQuantity("team", 40)).toBe(25);
    expect(normalizedQuantity("team", 1)).toBeNull();
    expect(normalizedQuantity("business", 7)).toBeNull();
  });
});

describe("brand på events", () => {
  it("checkout, abonnement og faktura (nyt og gammelt format)", () => {
    const ev = (object: unknown) =>
      ({ data: { object } }) as unknown as Stripe.Event;
    expect(
      eventBrand(
        ev({ object: "checkout.session", metadata: { brand: "timewren" } }),
      ),
    ).toBe("timewren");
    expect(eventBrand(ev({ object: "subscription", metadata: {} }))).toBeNull();
    // Desktop-licensens checkout har intet brand og behandles som før.
    expect(
      eventBrand(
        ev({ object: "checkout.session", metadata: { tier: "lifetime" } }),
      ),
    ).toBeNull();
    const invoice = {
      object: "invoice",
      parent: {
        subscription_details: {
          subscription: "sub_tw_1",
          metadata: { brand: "timewren" },
        },
      },
    };
    expect(eventBrand(ev(invoice))).toBe("timewren");
    expect(
      invoiceSubscriptionRef(invoice as unknown as Stripe.Invoice),
    ).toEqual({
      subscriptionId: "sub_tw_1",
      metadata: { brand: "timewren" },
    });
    const legacy = {
      object: "invoice",
      subscription: "sub_old",
      subscription_details: { metadata: { brand: "timewren" } },
    };
    expect(invoiceSubscriptionRef(legacy as unknown as Stripe.Invoice)).toEqual(
      { subscriptionId: "sub_old", metadata: { brand: "timewren" } },
    );
    expect(eventBrand(ev({ object: "charge" }))).toBeNull();
  });
});

describe("kundeportal", () => {
  it("skift mellem TimeWren-priserne, sæder kun på Team/Business", () => {
    const p = portalConfigurationParams(
      {
        privat: price("privat"),
        solo: price("solo"),
        team: price("team"),
        business: price("business"),
      },
      "https://timewren.com",
    );
    expect(p.metadata).toEqual({ brand: "timewren" });
    expect(p.default_return_url).toBe(
      "https://timewren.com/dashboard/settings/subscription",
    );
    expect(p.features.subscription_cancel).toMatchObject({
      enabled: true,
      mode: "at_period_end",
    });
    expect(p.features.invoice_history?.enabled).toBe(true);
    expect(p.features.payment_method_update?.enabled).toBe(true);
    // Plan- og sædeskift i prøven må ikke opkræve før de 14 dage er gået.
    expect(p.features.subscription_update?.trial_update_behavior).toBe(
      "continue_trial",
    );
    const products = p.features.subscription_update?.products ?? [];
    expect(products).toEqual([
      {
        product: "prod_privat",
        prices: ["price_privat"],
        adjustable_quantity: { enabled: false },
      },
      {
        product: "prod_solo",
        prices: ["price_solo"],
        adjustable_quantity: { enabled: false },
      },
      {
        product: "prod_team",
        prices: ["price_team"],
        adjustable_quantity: { enabled: true, minimum: 2, maximum: 25 },
      },
      {
        product: "prod_business",
        prices: ["price_business"],
        adjustable_quantity: { enabled: true, minimum: 5, maximum: 50 },
      },
    ]);
    expect(JSON.stringify(p)).not.toContain("timetrack");
  });
});
