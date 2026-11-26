import type Stripe from "stripe";
import {
  includedSeatsForTier,
  maxSeatsForTier,
  TIMEWREN_DESKTOP_LIFETIME_PRICE_EUR,
} from "@/lib/config";
import {
  isPerSeatTier,
  TIMEWREN_DESKTOP_LOOKUP_KEY,
  TIMEWREN_LOOKUP_KEYS,
  TIMEWREN_PAID_TIERS,
  TIMEWREN_STRIPE_BRAND,
  type TimewrenPaidTier,
} from "./timewren-stripe";

/**
 * Stripe-opslag for TimeWren Cloud: priser på lookup_key og portalens
 * opsætning. Klienten gives udefra, så tests aldrig rammer rigtig Stripe.
 */

export type TimewrenPrices = Record<TimewrenPaidTier, Stripe.Price>;

const PRICE_CACHE_MS = 10 * 60 * 1000;
let priceCache: { at: number; prices: TimewrenPrices } | null = null;

/** Kun til tests. */
export function resetTimewrenStripeCache() {
  priceCache = null;
  portalConfigId = null;
}

/**
 * De fire månedlige EUR-priser, slået op på lookup_key. Fejler højt, hvis en
 * mangler eller ikke er EUR, i stedet for at sende kunden til en forkert pris.
 */
export async function timewrenPrices(stripe: Stripe): Promise<TimewrenPrices> {
  if (priceCache && Date.now() - priceCache.at < PRICE_CACHE_MS) {
    return priceCache.prices;
  }
  const list = await stripe.prices.list({
    lookup_keys: TIMEWREN_PAID_TIERS.map((t) => TIMEWREN_LOOKUP_KEYS[t]),
    active: true,
    limit: 10,
  });
  const prices = {} as TimewrenPrices;
  for (const tier of TIMEWREN_PAID_TIERS) {
    const price = list.data.find(
      (p) => p.lookup_key === TIMEWREN_LOOKUP_KEYS[tier],
    );
    if (price?.currency !== "eur") {
      throw new Error(`TimeWren Stripe price missing for ${tier}`);
    }
    prices[tier] = price;
  }
  priceCache = { at: Date.now(), prices };
  return prices;
}

/**
 * Desktop-livstidslicensens pris, slået op på lookup_key. Fejler højt, hvis
 * den mangler eller ikke er en engangspris på præcis
 * TIMEWREN_DESKTOP_LIFETIME_PRICE_EUR i EUR: en forkert pris må aldrig sælge
 * licensen til et andet beløb.
 */
export async function timewrenDesktopPrice(
  stripe: Stripe,
): Promise<Stripe.Price> {
  const list = await stripe.prices.list({
    lookup_keys: [TIMEWREN_DESKTOP_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  const price = list.data.find(
    (p) => p.lookup_key === TIMEWREN_DESKTOP_LOOKUP_KEY,
  );
  if (
    price?.currency !== "eur" ||
    price.type !== "one_time" ||
    price.unit_amount !== TIMEWREN_DESKTOP_LIFETIME_PRICE_EUR * 100
  ) {
    throw new Error("TimeWren Stripe desktop price missing or wrong");
  }
  return price;
}

let portalConfigId: string | null = null;

/**
 * Kundeportalens opsætning for TimeWren (skift plan og sæder, kort, opsig,
 * fakturaer). `STRIPE_TIMEWREN_PORTAL_CONFIGURATION` vinder; ellers genbruges
 * en opsætning med metadata brand=timewren, eller den oprettes én gang. Kontoens
 * standardportal (TimeTracks desktop-licenser) røres ikke.
 */
export async function timewrenPortalConfiguration(
  stripe: Stripe,
  appUrl: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const fromEnv = env.STRIPE_TIMEWREN_PORTAL_CONFIGURATION?.trim();
  if (fromEnv) return fromEnv;
  if (portalConfigId) return portalConfigId;

  const existing = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  });
  const found = existing.data.find(
    (c) => c.metadata?.brand === TIMEWREN_STRIPE_BRAND,
  );
  if (found) {
    // Opsætninger fra før continue_trial afslutter prøven og fakturerer
    // straks, når kunden ændrer plan eller sæder i prøveperioden.
    if (
      found.features?.subscription_update?.trial_update_behavior !==
      "continue_trial"
    ) {
      await stripe.billingPortal.configurations.update(found.id, {
        features: {
          subscription_update: { trial_update_behavior: "continue_trial" },
        },
      });
    }
    portalConfigId = found.id;
    return found.id;
  }

  const created = await stripe.billingPortal.configurations.create(
    portalConfigurationParams(await timewrenPrices(stripe), appUrl),
  );
  portalConfigId = created.id;
  return created.id;
}

export function portalConfigurationParams(
  prices: TimewrenPrices,
  appUrl: string,
): Stripe.BillingPortal.ConfigurationCreateParams {
  const base = appUrl.replace(/\/+$/, "");
  const byProduct = new Map<
    string,
    Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product
  >();
  for (const tier of TIMEWREN_PAID_TIERS) {
    const price = prices[tier];
    const product =
      typeof price.product === "string" ? price.product : price.product.id;
    const entry = byProduct.get(product) ?? {
      product,
      prices: [],
      adjustable_quantity: { enabled: false },
    };
    entry.prices.push(price.id);
    if (isPerSeatTier(tier)) {
      entry.adjustable_quantity = {
        enabled: true,
        minimum: includedSeatsForTier(tier),
        maximum: maxSeatsForTier(tier),
      };
    }
    byProduct.set(product, entry);
  }
  return {
    business_profile: {
      headline: "TimeWren",
      privacy_policy_url: `${base}/privacy`,
      terms_of_service_url: `${base}/terms`,
    },
    default_return_url: `${base}/dashboard/settings/subscription`,
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "name", "address", "tax_id"],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price", "quantity", "promotion_code"],
        proration_behavior: "create_prorations",
        // Stripes standard (end_trial) ville opkræve en Team-kunde, der
        // retter sæder på dag 2, før de lovede 14 dage er gået.
        trial_update_behavior: "continue_trial",
        products: [...byProduct.values()],
      },
    },
    metadata: { brand: TIMEWREN_STRIPE_BRAND },
  };
}
