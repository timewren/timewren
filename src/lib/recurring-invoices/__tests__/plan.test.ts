import { afterEach, describe, expect, it, vi } from "vitest";
import { subscriptionAllowsRecurringInvoices } from "../plan";

// Abonnements-gaten for cron-siden (#198): samme regel som
// subscribedProcedure. Ingen funktionslås (#1012): Gratis og Privat må også.

const now = new Date("2026-10-02T06:50:00Z");
const future = new Date("2026-10-20T00:00:00Z");
const past = new Date("2026-09-01T00:00:00Z");

function sub(
  over: Partial<
    Parameters<typeof subscriptionAllowsRecurringInvoices>[0] & object
  >,
) {
  return {
    status: "active",
    planTier: "solo",
    trialEndsAt: past,
    pastDueSince: null,
    ...over,
  };
}

describe("subscriptionAllowsRecurringInvoices", () => {
  it("Selvstændig, Team og Virksomhed må", () => {
    for (const tier of ["solo", "team", "business"]) {
      expect(
        subscriptionAllowsRecurringInvoices(sub({ planTier: tier }), { now }),
      ).toBe(true);
    }
  });

  it("Gratis og Privat må også (ingen funktionslås)", () => {
    expect(
      subscriptionAllowsRecurringInvoices(sub({ planTier: "free" }), { now }),
    ).toBe(true);
    expect(
      subscriptionAllowsRecurringInvoices(sub({ status: "free" }), { now }),
    ).toBe(true);
    expect(
      subscriptionAllowsRecurringInvoices(sub({ planTier: "privat" }), {
        now,
      }),
    ).toBe(true);
  });

  it("opsagt abonnement lander på Gratis og må også", () => {
    expect(
      subscriptionAllowsRecurringInvoices(sub({ status: "canceled" }), {
        now,
      }),
    ).toBe(true);
  });

  it("prøveperiode: kun mens den løber", () => {
    expect(
      subscriptionAllowsRecurringInvoices(
        sub({ status: "trialing", trialEndsAt: future }),
        { now },
      ),
    ).toBe(true);
    expect(
      subscriptionAllowsRecurringInvoices(
        sub({ status: "trialing", trialEndsAt: past }),
        { now },
      ),
    ).toBe(false);
  });

  it("past_due: 7 dages frist", () => {
    expect(
      subscriptionAllowsRecurringInvoices(
        sub({
          status: "past_due",
          pastDueSince: new Date("2026-09-28T00:00:00Z"),
        }),
        { now },
      ),
    ).toBe(true);
    expect(
      subscriptionAllowsRecurringInvoices(
        sub({ status: "past_due", pastDueSince: past }),
        { now },
      ),
    ).toBe(false);
  });

  it("intet abonnement: nej — admin: altid ja", () => {
    expect(subscriptionAllowsRecurringInvoices(null, { now })).toBe(false);
    expect(
      subscriptionAllowsRecurringInvoices(null, { now, isAdmin: true }),
    ).toBe(true);
  });
});

describe("subscriptionAllowsRecurringInvoices uden billing (#962)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("er åben for alle, også uden abonnement og på Gratis", () => {
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STORE_BILLING_ENABLED", "");
    expect(subscriptionAllowsRecurringInvoices(null, { now })).toBe(true);
    expect(
      subscriptionAllowsRecurringInvoices(sub({ planTier: "free" }), { now }),
    ).toBe(true);
  });

  it("med billing (Cloud): intet abonnement afvises, Gratis må", () => {
    expect(subscriptionAllowsRecurringInvoices(null, { now })).toBe(false);
    expect(
      subscriptionAllowsRecurringInvoices(sub({ planTier: "free" }), { now }),
    ).toBe(true);
  });
});
