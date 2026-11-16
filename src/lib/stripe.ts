import Stripe from "stripe";

let client: Stripe | null = null;

/**
 * Lazily-instantiated Stripe client using STRIPE_SECRET_KEY.
 *
 * Used for direct Stripe flows (one-time desktop license checkout + the
 * webhook handler). Cloud subscriptions go through Alunta, not this client.
 */
export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
    client = new Stripe(key);
  }
  return client;
}
