import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { TIMEWREN_DESKTOP_LOOKUP_KEY } from "../timewren-stripe";
import { timewrenDesktopPrice } from "../timewren-stripe-server";

function stripeWith(prices: Array<Partial<Stripe.Price>>) {
  const list = vi.fn(async () => ({ data: prices }));
  return { client: { prices: { list } } as unknown as Stripe, list };
}

const good = {
  id: "price_desktop_eur",
  lookup_key: TIMEWREN_DESKTOP_LOOKUP_KEY,
  currency: "eur",
  type: "one_time",
  unit_amount: 6900,
} as const;

describe("timewrenDesktopPrice", () => {
  it("finds the €69 one-time price by lookup key, never by a hardcoded id", async () => {
    const { client, list } = stripeWith([good]);
    const price = await timewrenDesktopPrice(client);
    expect(price.id).toBe("price_desktop_eur");
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup_keys: ["timewren_desktop_lifetime_eur"],
        active: true,
      }),
    );
  });

  it.each([
    ["missing", []],
    ["in DKK", [{ ...good, currency: "dkk" }]],
    ["a subscription price", [{ ...good, type: "recurring" }]],
    ["another amount", [{ ...good, unit_amount: 4900 }]],
    ["another lookup key", [{ ...good, lookup_key: "something_else" }]],
  ])("fails loudly when the price is %s", async (_name, prices) => {
    const { client } = stripeWith(prices);
    await expect(timewrenDesktopPrice(client)).rejects.toThrow(
      /desktop price missing or wrong/,
    );
  });
});
