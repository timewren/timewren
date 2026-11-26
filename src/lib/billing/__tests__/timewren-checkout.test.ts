import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Checkout og kundeportal for TimeWren Cloud mod en falsk Stripe: kunden
 * genbruges, sæder og prøve, host-URL'er og ét abonnement pr. organisation.
 */

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/i18n/server-text", () => ({
  tr: async (_ns: string, key: string) => key,
}));
const seatUsage = vi.hoisted(() => ({ total: 1 }));
vi.mock("../seat-usage", () => ({
  countSeatUsage: async () => ({ ...seatUsage }),
}));

import {
  createTimewrenCheckout,
  createTimewrenPortal,
  type GoverningSubscription,
  type TimewrenCheckoutOptions,
} from "../timewren-checkout";
import { resetTimewrenStripeCache } from "../timewren-stripe-server";

const TIERS = ["privat", "solo", "team", "business"] as const;

function fakeStripe() {
  return {
    prices: {
      list: vi.fn(async () => ({
        data: TIERS.map((t) => ({
          id: `price_${t}`,
          lookup_key: `timewren_${t}_monthly_eur`,
          currency: "eur",
          product: `prod_${t}`,
          metadata: { brand: "timewren", plan_tier: t },
        })),
      })),
    },
    customers: {
      create: vi.fn(async (_p: unknown, _o?: unknown) => ({ id: "cus_new" })),
    },
    subscriptions: {
      list: vi.fn(async (_p: unknown) => ({
        data: [] as Array<{ status: string; metadata: object }>,
      })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async (_p: unknown) => ({
          url: "https://checkout.stripe.com/c/1",
        })),
        list: vi.fn(async (_p: unknown) => ({
          data: [] as Array<{ id: string; metadata: object }>,
        })),
        expire: vi.fn(async (_id: string) => ({})),
        retrieve: vi.fn(async (_id: string) => ({ status: "expired" })),
      },
    },
    billingPortal: {
      configurations: {
        list: vi.fn(async () => ({
          data: [
            {
              id: "bpc_tw",
              metadata: { brand: "timewren" },
              features: {
                subscription_update: {
                  trial_update_behavior: "continue_trial",
                },
              },
            } as object,
          ],
        })),
        create: vi.fn(),
        update: vi.fn(async (_id: string, _p: unknown) => ({})),
      },
      sessions: {
        create: vi.fn(async () => ({ url: "https://billing.stripe.com/p/1" })),
      },
    },
  };
}

const updates: Record<string, unknown>[] = [];
const db = {
  query: {
    users: {
      findFirst: vi.fn(async () => ({
        email: "owner@example.com",
        locale: "de",
      })),
    },
    members: {
      findFirst: vi.fn(async () => null as { userId: string } | null),
    },
  },
  update: () => ({
    set: (v: Record<string, unknown>) => ({
      where: async () => {
        updates.push(v);
      },
    }),
  }),
} as never;

const freeRow = {
  id: "row_1",
  status: "free",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
};

let stripe: ReturnType<typeof fakeStripe>;

beforeEach(() => {
  resetTimewrenStripeCache();
  stripe = fakeStripe();
  updates.length = 0;
  seatUsage.total = 1;
});

function base() {
  return {
    db,
    stripe: stripe as unknown as Stripe,
    userId: "user_tw_1",
    orgId: "org_tw_1",
    appUrl: "https://timewren.com",
  };
}

/** Et enkelt kald: låsen er en ren gennemkørsel, rækken er givet. */
function checkout(
  opts: Omit<TimewrenCheckoutOptions, "withOrgLock" | "loadSub"> & {
    sub: GoverningSubscription | null;
    db: Parameters<TimewrenCheckoutOptions["loadSub"]>[0];
  },
) {
  const { sub, ...rest } = opts;
  return createTimewrenCheckout({
    ...rest,
    withOrgLock: (fn) => fn(rest.db),
    loadSub: async () => sub,
  });
}

describe("createTimewrenCheckout", () => {
  it("ny kunde: oprettes med kontoens mail, gemmes, og prøven gives", async () => {
    const res = await checkout({
      ...base(),
      sub: freeRow,
      tier: "solo",
    });
    expect(res.url).toBe("https://checkout.stripe.com/c/1");
    expect(stripe.prices.list).toHaveBeenCalledWith({
      lookup_keys: [
        "timewren_privat_monthly_eur",
        "timewren_solo_monthly_eur",
        "timewren_team_monthly_eur",
        "timewren_business_monthly_eur",
      ],
      active: true,
      limit: 10,
    });
    expect(stripe.customers.create).toHaveBeenCalledWith(
      {
        email: "owner@example.com",
        metadata: {
          brand: "timewren",
          organizationId: "org_tw_1",
        },
      },
      { idempotencyKey: "timewren-customer:org_tw_1" },
    );
    expect(updates[0]).toMatchObject({ stripeCustomerId: "cus_new" });
    const params = stripe.checkout.sessions.create.mock.calls[0][0] as
      | Stripe.Checkout.SessionCreateParams
      | undefined;
    expect(params).toMatchObject({
      customer: "cus_new",
      line_items: [{ price: "price_solo", quantity: 1 }],
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      branding_settings: { display_name: "TimeWren" },
      locale: "de",
      subscription_data: {
        trial_period_days: 14,
        metadata: { brand: "timewren", planTier: "solo" },
      },
    });
    expect(params?.success_url).toMatch(/^https:\/\/timewren\.com\//);
  });

  it("eksisterende kunde genbruges; ingen prøve efter et tidligere abonnement", async () => {
    await checkout({
      ...base(),
      sub: {
        id: "row_1",
        status: "free",
        stripeCustomerId: "cus_old",
        stripeSubscriptionId: "sub_old",
      },
      tier: "team",
      seats: 4,
    });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    const params = stripe.checkout.sessions.create.mock.calls[0][0] as
      | Stripe.Checkout.SessionCreateParams
      | undefined;
    expect(params?.customer).toBe("cus_old");
    expect(params?.line_items).toEqual([{ price: "price_team", quantity: 4 }]);
    expect(params?.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("Team: aldrig færre sæder end i brug", async () => {
    seatUsage.total = 7;
    await checkout({
      ...base(),
      sub: freeRow,
      tier: "team",
      seats: 3,
    });
    const params = stripe.checkout.sessions.create.mock.calls[0][0] as
      | Stripe.Checkout.SessionCreateParams
      | undefined;
    expect(params?.line_items?.[0]?.quantity).toBe(7);
  });

  it("løbende abonnement: afvist, planskift sker i portalen", async () => {
    await expect(
      checkout({
        ...base(),
        sub: {
          id: "row_1",
          status: "active",
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_1",
        },
        tier: "business",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("abonnement i Stripe, som webhooken ikke har skrevet endnu: afvist", async () => {
    stripe.subscriptions.list.mockResolvedValueOnce({
      data: [{ status: "trialing", metadata: { brand: "timewren" } }],
    });
    await expect(
      checkout({
        ...base(),
        sub: { ...freeRow, stripeCustomerId: "cus_1" },
        tier: "solo",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "subscription.stripeAlreadyActive",
    });
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_1",
      status: "all",
      limit: 20,
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("et ældre åbent TimeWren-checkout udløber, før et nyt oprettes", async () => {
    stripe.checkout.sessions.list.mockResolvedValueOnce({
      data: [
        { id: "cs_old", metadata: { brand: "timewren" } },
        { id: "cs_desktop", metadata: {} },
      ],
    });
    await checkout({
      ...base(),
      sub: { ...freeRow, stripeCustomerId: "cus_1" },
      tier: "solo",
    });
    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
      customer: "cus_1",
      status: "open",
      limit: 20,
    });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_old");
    expect(
      stripe.checkout.sessions.expire.mock.invocationCallOrder[0],
    ).toBeLessThan(stripe.checkout.sessions.create.mock.invocationCallOrder[0]);
  });

  it("abonnementstjekket kommer efter udløbet af åbne checkouts", async () => {
    stripe.checkout.sessions.list.mockResolvedValueOnce({
      data: [{ id: "cs_old", metadata: { brand: "timewren" } }],
    });
    await checkout({
      ...base(),
      sub: { ...freeRow, stripeCustomerId: "cus_1" },
      tier: "solo",
    });
    expect(
      stripe.checkout.sessions.expire.mock.invocationCallOrder[0],
    ).toBeLessThan(stripe.subscriptions.list.mock.invocationCallOrder[0]);
  });

  it("et åbent checkout, der gennemføres undervejs: afvist, intet nyt", async () => {
    stripe.checkout.sessions.list.mockResolvedValueOnce({
      data: [{ id: "cs_a", metadata: { brand: "timewren" } }],
    });
    stripe.checkout.sessions.expire.mockRejectedValueOnce(
      new Error("This Checkout Session is not open"),
    );
    stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
      status: "complete",
    });
    await expect(
      checkout({
        ...base(),
        sub: { ...freeRow, stripeCustomerId: "cus_1" },
        tier: "solo",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "subscription.stripeAlreadyActive",
    });
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_a");
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("et checkout, der udløb af sig selv undervejs: et nyt oprettes", async () => {
    stripe.checkout.sessions.list.mockResolvedValueOnce({
      data: [{ id: "cs_a", metadata: { brand: "timewren" } }],
    });
    stripe.checkout.sessions.expire.mockRejectedValueOnce(
      new Error("This Checkout Session is not open"),
    );
    const res = await checkout({
      ...base(),
      sub: { ...freeRow, stripeCustomerId: "cus_1" },
      tier: "solo",
    });
    expect(res.url).toBe("https://checkout.stripe.com/c/1");
  });

  it("ny kunde gemmes gennem låsens forbindelse før Stripe Checkout", async () => {
    stripe.checkout.sessions.create.mockRejectedValueOnce(
      new Error("No such price"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const txUpdates: unknown[] = [];
    const tx = {
      ...(db as object),
      update: () => ({
        set: (v: unknown) => ({
          where: async () => {
            txUpdates.push(v);
          },
        }),
      }),
    } as never;
    await expect(
      createTimewrenCheckout({
        ...base(),
        withOrgLock: (fn) => fn(tx),
        loadSub: async () => freeRow,
        tier: "solo",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(updates).toEqual([]);
    expect(txUpdates[0]).toMatchObject({ stripeCustomerId: "cus_new" });
  });

  it("Stripe-fejl giver en neutral fejl uden detaljer", async () => {
    stripe.checkout.sessions.create.mockRejectedValueOnce(
      new Error("No such price"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      checkout({ ...base(), sub: freeRow, tier: "solo" }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "subscription.stripeUnavailable",
    });
  });
});

describe("createTimewrenCheckout: samtidige kald", () => {
  /**
   * Ejer og admin starter checkout samtidig, før Stripe-kunden er gemt. En
   * rigtig lås (kø af løfter) som pg_advisory_xact_lock, én fælles række og en
   * Stripe, der husker kunder pr. idempotensnøgle og åbne checkouts.
   */
  function world() {
    const row: GoverningSubscription = { ...freeRow };
    let tail: Promise<unknown> = Promise.resolve();
    const withOrgLock = <T>(fn: (d: never) => Promise<T>): Promise<T> => {
      const run = tail.then(() => fn(sharedDb as never));
      tail = run.catch(() => {});
      return run;
    };
    const sharedDb = {
      query: {
        users: {
          findFirst: vi.fn(async () => ({
            email: "x@example.com",
            locale: "da",
          })),
        },
        members: { findFirst: vi.fn(async () => ({ userId: "user_owner" })) },
      },
      update: () => ({
        set: (v: Partial<GoverningSubscription>) => ({
          where: async () => {
            Object.assign(row, v);
          },
        }),
      }),
    } as never;
    const byKey = new Map<string, string>();
    const sessions: Array<{ id: string; status: string; metadata: object }> =
      [];
    const tick = () => new Promise((r) => setTimeout(r, 1));
    stripe.customers.create.mockImplementation(async (_p, o) => {
      await tick();
      const key = (o as { idempotencyKey: string }).idempotencyKey;
      if (!byKey.has(key)) byKey.set(key, `cus_${byKey.size + 1}`);
      return { id: byKey.get(key) as string };
    });
    stripe.checkout.sessions.list.mockImplementation(async () => {
      await tick();
      return { data: sessions.filter((x) => x.status === "open") };
    });
    stripe.checkout.sessions.expire.mockImplementation(async (id) => {
      await tick();
      const found = sessions.find((x) => x.id === id);
      if (found) found.status = "expired";
      return {};
    });
    stripe.checkout.sessions.create.mockImplementation(async () => {
      await tick();
      const id = `cs_${sessions.length + 1}`;
      sessions.push({ id, status: "open", metadata: { brand: "timewren" } });
      return { url: `https://checkout.stripe.com/c/${id}` };
    });
    const call = (userId: string) =>
      createTimewrenCheckout({
        ...base(),
        userId,
        withOrgLock,
        loadSub: async () => ({ ...row }),
        tier: "solo",
      });
    return { row, sessions, call, byKey };
  }

  it("én kunde og kun ét checkout, der kan betales", async () => {
    const w = world();
    await Promise.all([w.call("user_owner"), w.call("user_admin")]);
    expect(w.byKey.size).toBe(1);
    expect(w.row.stripeCustomerId).toBe("cus_1");
    expect(w.sessions).toHaveLength(2);
    expect(w.sessions.filter((x) => x.status === "open")).toHaveLength(1);
    // Begge kald bad om en kunde med samme parametre (ejerens mail).
    const emails = stripe.customers.create.mock.calls.map(
      (c) => (c[0] as { email: string }).email,
    );
    expect(new Set(emails).size).toBeLessThanOrEqual(1);
  });

  it("uden lås ville begge checkouts stå åbne (testen kan se kapløbet)", async () => {
    const w = world();
    const unlocked = (userId: string) =>
      createTimewrenCheckout({
        ...base(),
        userId,
        withOrgLock: (fn) => fn(base().db),
        loadSub: async () => ({ ...w.row, stripeCustomerId: "cus_1" }),
        tier: "solo",
      });
    await Promise.all([unlocked("user_owner"), unlocked("user_admin")]);
    expect(w.sessions.filter((x) => x.status === "open")).toHaveLength(2);
  });
});

describe("createTimewrenPortal", () => {
  it("bruger TimeWren-opsætningen og returnerer til brandets host", async () => {
    const res = await createTimewrenPortal({
      stripe: stripe as unknown as Stripe,
      appUrl: "https://timewren.com",
      sub: { ...freeRow, stripeCustomerId: "cus_1" },
    });
    expect(res.url).toBe("https://billing.stripe.com/p/1");
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_1",
      configuration: "bpc_tw",
      return_url: "https://timewren.com/dashboard/settings/subscription",
    });
    expect(stripe.billingPortal.configurations.create).not.toHaveBeenCalled();
  });

  it("ældre opsætning uden continue_trial rettes, så prøven bevares", async () => {
    stripe.billingPortal.configurations.list.mockResolvedValueOnce({
      data: [{ id: "bpc_tw", metadata: { brand: "timewren" } }],
    });
    await createTimewrenPortal({
      stripe: stripe as unknown as Stripe,
      appUrl: "https://timewren.com",
      sub: { ...freeRow, stripeCustomerId: "cus_1" },
    });
    expect(stripe.billingPortal.configurations.update).toHaveBeenCalledWith(
      "bpc_tw",
      {
        features: {
          subscription_update: { trial_update_behavior: "continue_trial" },
        },
      },
    );
  });

  it("uden Stripe-kunde: afvist", async () => {
    await expect(
      createTimewrenPortal({
        stripe: stripe as unknown as Stripe,
        appUrl: "https://timewren.com",
        sub: freeRow,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
