import { afterEach, describe, expect, it, vi } from "vitest";
import { capacityLimitsApply } from "../capacity-gate";

describe("capacityLimitsApply (#1010)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("gælder ikke uden billing-env", () => {
    expect(capacityLimitsApply({})).toBe(false);
  });

  it.each([
    { ALUNTA_API_KEY: "key" },
    { STRIPE_SECRET_KEY: "sk_test_x" },
    { STORE_BILLING_ENABLED: "1" },
  ])("gælder med Cloud-env %o", (env) => {
    expect(capacityLimitsApply(env)).toBe(true);
  });

  it("læser process.env som standard", () => {
    vi.stubEnv("ALUNTA_API_KEY", "key");
    expect(capacityLimitsApply()).toBe(true);
  });
});
