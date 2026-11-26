import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Desktop licence checkout per brand: TimeTrack in DKK, TimeWren in EUR.
// Stripe is a fake; nothing here creates a real Stripe object.

const findUser = vi.hoisted(() => vi.fn(async () => undefined as unknown));
const findSubscription = vi.hoisted(() =>
  vi.fn(async () => undefined as unknown),
);
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: findUser },
      subscriptions: { findFirst: findSubscription },
    },
  },
}));

const pricesList = vi.hoisted(() => vi.fn());
const sessionsCreate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    prices: { list: pricesList },
    checkout: { sessions: { create: sessionsCreate } },
  }),
}));

const EUR_69 = {
  id: "price_timewren_desktop",
  lookup_key: "timewren_desktop_lifetime_eur",
  currency: "eur",
  type: "one_time",
  unit_amount: 6900,
};

async function load() {
  vi.resetModules();
  return import("../desktop");
}

beforeEach(() => {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy_not_a_real_key");
  vi.stubEnv("STRIPE_DESKTOP_LIFETIME_PRICE_ID", "price_timetrack_dkk");
  findUser.mockReset().mockResolvedValue(undefined);
  findSubscription.mockReset().mockResolvedValue(undefined);
  pricesList.mockReset().mockResolvedValue({ data: [EUR_69] });
  sessionsCreate
    .mockReset()
    .mockResolvedValue({ url: "https://checkout.stripe.test/c/pay_1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildTimewrenDesktopCheckoutSessionParams", () => {
  it("is a one-time payment for the given EUR price, shown as TimeWren, on TimeWren's host", async () => {
    const { buildTimewrenDesktopCheckoutSessionParams } = await load();
    const params = buildTimewrenDesktopCheckoutSessionParams({
      email: "buyer@example.com",
      appUrl: "https://timewren.com/",
      priceId: "price_from_lookup",
      maxDevices: 3,
      locale: "da",
    });
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([
      { price: "price_from_lookup", quantity: 1 },
    ]);
    expect(params.customer_email).toBe("buyer@example.com");
    expect(params.success_url).toBe("https://timewren.com/da/desktop#bought");
    expect(params.cancel_url).toBe("https://timewren.com/da/desktop#buy");
    expect(params.success_url).not.toContain("timetrack");
    expect(params.branding_settings).toEqual({ display_name: "TimeWren" });
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.tax_id_collection).toEqual({ enabled: true });
    expect(params.locale).toBe("da");
  });

  it("marks the session desktop_brand, never brand (that would route it to the Cloud handler)", async () => {
    const { buildTimewrenDesktopCheckoutSessionParams } = await load();
    const params = buildTimewrenDesktopCheckoutSessionParams({
      email: "buyer@example.com",
      appUrl: "https://timewren.com",
      priceId: "price_x",
      maxDevices: 3,
    });
    expect(params.metadata).toEqual({
      tier: "lifetime",
      license_tier: "lifetime",
      max_devices: "3",
      desktop_brand: "timewren",
      locale: "en",
    });
    expect(params.metadata).not.toHaveProperty("brand");
    expect(params.invoice_creation?.invoice_data?.metadata).not.toHaveProperty(
      "brand",
    );
    expect(params.success_url).toBe("https://timewren.com/desktop#bought");
  });

  it("falls back to English for an unsupported locale", async () => {
    const { buildTimewrenDesktopCheckoutSessionParams } = await load();
    const params = buildTimewrenDesktopCheckoutSessionParams({
      email: "b@example.com",
      appUrl: "https://timewren.com",
      priceId: "price_x",
      maxDevices: 3,
      locale: "xx",
    });
    expect(params.locale).toBe("en");
  });
});

describe("startDesktopLifetimeCheckout on the TimeWren host", () => {
  it("charges the €69 price found by lookup key and returns the Stripe URL", async () => {
    const { startDesktopLifetimeCheckout } = await load();
    const res = await startDesktopLifetimeCheckout({
      email: "buyer@example.com",
      host: "timewren.com",
      locale: "de",
    });
    expect(res).toEqual({ url: "https://checkout.stripe.test/c/pay_1" });
    expect(pricesList).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup_keys: ["timewren_desktop_lifetime_eur"],
      }),
    );
    const params = sessionsCreate.mock.calls[0][0];
    expect(params.line_items).toEqual([
      { price: "price_timewren_desktop", quantity: 1 },
    ]);
    expect(params.line_items[0].price).not.toBe("price_timetrack_dkk");
    expect(params.metadata.desktop_brand).toBe("timewren");
    expect(params.success_url).toBe("https://timewren.com/de/desktop#bought");
  });

  it("works on the www host too", async () => {
    const { startDesktopLifetimeCheckout } = await load();
    await startDesktopLifetimeCheckout({
      email: "buyer@example.com",
      host: "www.timewren.com",
    });
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    expect(sessionsCreate.mock.calls[0][0].metadata.desktop_brand).toBe(
      "timewren",
    );
  });

  it.each([
    ["wrong amount", { ...EUR_69, unit_amount: 4900 }],
    ["wrong currency", { ...EUR_69, currency: "dkk" }],
  ])("refuses to sell at a %s", async (_n, price) => {
    pricesList.mockResolvedValue({ data: [price] });
    const { startDesktopLifetimeCheckout } = await load();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      startDesktopLifetimeCheckout({
        email: "buyer@example.com",
        host: "timewren.com",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("is not available without a Stripe key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const { startDesktopLifetimeCheckout } = await load();
    await expect(
      startDesktopLifetimeCheckout({
        email: "buyer@example.com",
        host: "timewren.com",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("does not need TimeTrack's DKK price id", async () => {
    vi.stubEnv("STRIPE_DESKTOP_LIFETIME_PRICE_ID", "");
    const { startDesktopLifetimeCheckout } = await load();
    await expect(
      startDesktopLifetimeCheckout({
        email: "buyer@example.com",
        host: "timewren.com",
      }),
    ).resolves.toHaveProperty("url");
  });

  it("refuses a buyer who already has an active Cloud subscription", async () => {
    findUser.mockResolvedValue({ id: "u1", brand: "timewren" });
    findSubscription.mockResolvedValue({ status: "active" });
    const { startDesktopLifetimeCheckout } = await load();
    await expect(
      startDesktopLifetimeCheckout({
        email: "cloud@example.com",
        host: "timewren.com",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("lets a TimeTrack Cloud subscriber buy a TimeWren licence (Cloud is per brand)", async () => {
    findUser.mockResolvedValue({ id: "u2", brand: "timetrack" });
    findSubscription.mockResolvedValue({ status: "active" });
    const { startDesktopLifetimeCheckout } = await load();
    await expect(
      startDesktopLifetimeCheckout({
        email: "tt@example.com",
        host: "timewren.com",
      }),
    ).resolves.toHaveProperty("url");
  });

  it("sends no customer_update with customer_email (Stripe rejects it)", async () => {
    const { buildTimewrenDesktopCheckoutSessionParams } = await load();
    const params = buildTimewrenDesktopCheckoutSessionParams({
      email: "buyer@example.com",
      appUrl: "https://timewren.com",
      priceId: "price_x",
      maxDevices: 3,
    });
    expect(params.customer_email).toBe("buyer@example.com");
    expect(params).not.toHaveProperty("customer_update");
    expect(params.billing_address_collection).toBe("required");
  });
});

describe("startDesktopLifetimeCheckout on the TimeTrack host (unchanged)", () => {
  it("still sells the DKK price from STRIPE_DESKTOP_LIFETIME_PRICE_ID with TimeTrack's URLs", async () => {
    const { startDesktopLifetimeCheckout } = await load();
    await startDesktopLifetimeCheckout({
      email: "buyer@example.com",
      host: "timetrack.dk",
    });
    expect(pricesList).not.toHaveBeenCalled();
    const params = sessionsCreate.mock.calls[0][0];
    expect(params.line_items).toEqual([
      { price: "price_timetrack_dkk", quantity: 1 },
    ]);
    expect(params.metadata).not.toHaveProperty("desktop_brand");
    expect(params.success_url).toContain("/download/success");
  });

  it("is not available without the DKK price id", async () => {
    vi.stubEnv("STRIPE_DESKTOP_LIFETIME_PRICE_ID", "");
    const { startDesktopLifetimeCheckout } = await load();
    await expect(
      startDesktopLifetimeCheckout({
        email: "buyer@example.com",
        host: "timetrack.dk",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
