import { describe, expect, it, vi } from "vitest";

// desktop.ts pulls in ../trpc → auth → db; mock the connection so importing
// the router doesn't open a real one.
vi.mock("@/lib/db", () => ({ db: {} }));

import { buildDesktopCheckoutSessionParams } from "../desktop";

describe("buildDesktopCheckoutSessionParams", () => {
  it("charges exactly the price id it's given — createLifetimeCheckout passes STRIPE_DESKTOP_LIFETIME_PRICE_ID from env, never a hardcoded id", () => {
    const params = buildDesktopCheckoutSessionParams({
      email: "buyer@example.com",
      appUrl: "https://timetrack.dk",
      priceId: "price_from_env_12345",
      maxDevices: 3,
      taxEnabled: false,
    });

    expect(params.line_items).toEqual([
      { price: "price_from_env_12345", quantity: 1 },
    ]);
  });

  it("redirects to the download success/cancel pages with the right metadata", () => {
    const params = buildDesktopCheckoutSessionParams({
      email: "buyer@example.com",
      appUrl: "https://timetrack.dk",
      priceId: "price_x",
      maxDevices: 3,
      taxEnabled: false,
    });

    expect(params.success_url).toBe(
      "https://timetrack.dk/download/success?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(params.cancel_url).toBe("https://timetrack.dk/download?canceled=1");
    expect(params.metadata).toEqual({
      tier: "lifetime",
      license_tier: "lifetime",
      max_devices: "3",
    });
    expect(params.automatic_tax).toBeUndefined();
  });

  it("enables Stripe Tax only when taxEnabled is true", () => {
    const params = buildDesktopCheckoutSessionParams({
      email: "buyer@example.com",
      appUrl: "https://timetrack.dk",
      priceId: "price_x",
      maxDevices: 3,
      taxEnabled: true,
    });

    expect(params.automatic_tax).toEqual({ enabled: true });
  });
});
