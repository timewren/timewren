import { describe, expect, it } from "vitest";
import { isBillingEnabled } from "./billing-enabled";

describe("isBillingEnabled", () => {
  it("er slået fra uden nogen betalingsudbyder (selvhost)", () => {
    expect(isBillingEnabled({})).toBe(false);
  });

  it("behandler tomme og blanke værdier som ikke konfigureret", () => {
    expect(
      isBillingEnabled({ ALUNTA_API_KEY: "", STRIPE_SECRET_KEY: "  " }),
    ).toBe(false);
  });

  it("er altid slået fra i den offentlige demo (DEMO_MODE=1)", () => {
    expect(
      isBillingEnabled({
        DEMO_MODE: "1",
        ALUNTA_API_KEY: "key",
        STRIPE_SECRET_KEY: "sk_test_x",
        STORE_BILLING_ENABLED: "1",
      }),
    ).toBe(false);
  });

  it("er slået til når Alunta er konfigureret (TimeTrack Cloud)", () => {
    expect(isBillingEnabled({ ALUNTA_API_KEY: "key" })).toBe(true);
  });

  it("er slået til når Stripe er konfigureret", () => {
    expect(isBillingEnabled({ STRIPE_SECRET_KEY: "sk_test_x" })).toBe(true);
  });

  it("er slået til når køb i appen er aktiveret", () => {
    expect(isBillingEnabled({ STORE_BILLING_ENABLED: "1" })).toBe(true);
    expect(isBillingEnabled({ STORE_BILLING_ENABLED: "0" })).toBe(false);
  });

  it("læser process.env som standard", () => {
    // vitest.config.ts sætter ALUNTA_API_KEY, så testene kører som Cloud
    expect(isBillingEnabled()).toBe(true);
  });
});
