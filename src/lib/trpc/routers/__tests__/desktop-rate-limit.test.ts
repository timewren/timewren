/**
 * Offentlige køb- og refusionsprocedurer skal være throttlet pr. IP (#1103):
 * requestRefund kan ellers bruges til at afprøve licensnøgler i bulk, og
 * createLifetimeCheckout opretter en Stripe-session pr. kald.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/db", () => ({
  db: { query: { desktopLicenses: { findFirst } } },
}));

// Stop checkout før Stripe; grænsen skal ramme før dette kald.
const assertCheckout = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("checkout-stop");
  }),
);
vi.mock("@/lib/billing/assert-checkout", () => ({
  assertCheckoutAvailableForBuyer: assertCheckout,
}));

import { db } from "@/lib/db";
import { RATE_LIMIT_CONFIGS } from "@/lib/utils/rate-limiter";
import { desktopRouter } from "../desktop";

let ipSeq = 0;
function callerFor() {
  ipSeq += 1;
  const headers = new Headers({ "x-forwarded-for": `198.51.100.${ipSeq}` });
  return desktopRouter.createCaller({
    db,
    headers,
    session: null,
  } as never);
}

beforeEach(() => {
  findFirst.mockClear();
  assertCheckout.mockClear();
});

describe("rate limit på offentlige desktop-procedurer", () => {
  it("requestRefund afvises med TOO_MANY_REQUESTS efter grænsen", async () => {
    const caller = callerFor();
    const input = {
      licenseKey: "TT-AAAA-BBBB-CCCC-DDDD",
      email: "anna@example.com",
    };
    for (let i = 0; i < RATE_LIMIT_CONFIGS.desktopRefund.maxRequests; i++) {
      await expect(caller.requestRefund(input)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    findFirst.mockClear();
    await expect(caller.requestRefund(input)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("createLifetimeCheckout afvises med TOO_MANY_REQUESTS efter grænsen", async () => {
    const caller = callerFor();
    const input = { email: "anna@example.com" };
    for (let i = 0; i < RATE_LIMIT_CONFIGS.desktopCheckout.maxRequests; i++) {
      await expect(caller.createLifetimeCheckout(input)).rejects.toThrow(
        "checkout-stop",
      );
    }
    assertCheckout.mockClear();
    await expect(caller.createLifetimeCheckout(input)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(assertCheckout).not.toHaveBeenCalled();
  });
});
