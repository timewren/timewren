import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hvem må ramme hvilket betalingsflow (docs/specs/timewren-cloud.md →
 * "Betaling på TimeWren"): TimeTrack-konti kan aldrig ramme Stripe-flowet,
 * TimeWren-konti aldrig Alunta, butikker eller desktop-licensen. Uden
 * flagene (selvhost/timetrack.dk) er alt som før.
 */

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/i18n/server-text", () => ({
  tr: async (_ns: string, key: string) => key,
}));

import {
  assertCheckoutAvailable,
  assertCheckoutAvailableForBuyer,
  assertStripeCheckoutAvailable,
  assertStripeCheckoutOrganization,
} from "../assert-checkout";
import { billingProviderForBrand } from "../brand-billing";

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "MULTIBRAND_ENABLED",
  "TIMEWREN_APP_ENABLED",
  "BRANDS_CONFIG",
] as const;
const saved: Record<string, string | undefined> = {};

function dbWithBrand(brand: string) {
  return {
    query: { users: { findFirst: vi.fn(async () => ({ brand })) } },
  } as never;
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.MULTIBRAND_ENABLED = "1";
  process.env.TIMEWREN_APP_ENABLED = "1";
  process.env.BRANDS_CONFIG = JSON.stringify({
    timewren: { hosts: ["timewren.com", "www.timewren.com"] },
  });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("Stripe-flowet (TimeWren)", () => {
  it("TimeWren-konto: tilladt", async () => {
    await expect(
      assertStripeCheckoutAvailable(dbWithBrand("timewren"), "u1"),
    ).resolves.toBeUndefined();
  });

  it("organisationen skal også være TimeWren", async () => {
    const orgDb = (brand: string | null) =>
      ({
        query: {
          organizations: {
            findFirst: vi.fn(async () => (brand ? { brand } : undefined)),
          },
        },
      }) as never;
    await expect(
      assertStripeCheckoutOrganization(orgDb("timewren"), "o1"),
    ).resolves.toBeUndefined();
    for (const brand of ["timetrack", null]) {
      await expect(
        assertStripeCheckoutOrganization(orgDb(brand), "o1"),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "subscription.checkoutNotForAccount",
      });
    }
  });

  it("TimeTrack-konto: afvist", async () => {
    await expect(
      assertStripeCheckoutAvailable(dbWithBrand("timetrack"), "u1"),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "subscription.checkoutNotForAccount",
    });
  });

  it.each([
    ["STRIPE_SECRET_KEY", ""],
    ["MULTIBRAND_ENABLED", "0"],
  ])("selvhost (%s=%s): ingen betaling", async (key, value) => {
    process.env[key] = value;
    await expect(
      assertStripeCheckoutAvailable(dbWithBrand("timewren"), "u1"),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("TimeTracks flows (Alunta, butikker, desktop)", () => {
  it("TimeWren-konto afvises i Alunta og butikker", async () => {
    await expect(
      assertCheckoutAvailable(dbWithBrand("timewren"), "u1"),
    ).rejects.toMatchObject({ message: "subscription.checkoutNotForAccount" });
  });

  it("TimeTrack-konto er uændret", async () => {
    await expect(
      assertCheckoutAvailable(dbWithBrand("timetrack"), "u1"),
    ).resolves.toBeUndefined();
  });

  it("desktop-licensen: afvist på TimeWren-host og for TimeWren-adresse", async () => {
    await expect(
      assertCheckoutAvailableForBuyer(dbWithBrand("timetrack"), {
        host: "timewren.com",
        email: "a@example.com",
      }),
    ).rejects.toBeTruthy();
    await expect(
      assertCheckoutAvailableForBuyer(dbWithBrand("timewren"), {
        host: "timetrack.dk",
        email: "a@example.com",
      }),
    ).rejects.toBeTruthy();
    await expect(
      assertCheckoutAvailableForBuyer(dbWithBrand("timetrack"), {
        host: "timetrack.dk",
        email: "a@example.com",
      }),
    ).resolves.toBeUndefined();
  });

  it("uden flagene: ingen afvisning og intet opslag", async () => {
    process.env.MULTIBRAND_ENABLED = "0";
    const db = dbWithBrand("timewren");
    await expect(assertCheckoutAvailable(db, "u1")).resolves.toBeUndefined();
    expect(
      (db as unknown as { query: { users: { findFirst: unknown } } }).query
        .users.findFirst,
    ).not.toHaveBeenCalled();
  });
});

describe("billingEnabled.provider pr. brand", () => {
  it("TimeTrack: alunta; TimeWren: stripe; TimeWren uden nøgle: ingen", () => {
    expect(billingProviderForBrand("timetrack")).toBe("alunta");
    expect(billingProviderForBrand("timewren")).toBe("stripe");
    process.env.STRIPE_SECRET_KEY = "";
    expect(billingProviderForBrand("timewren")).toBeNull();
    expect(billingProviderForBrand("timetrack")).toBe("alunta");
  });
});
