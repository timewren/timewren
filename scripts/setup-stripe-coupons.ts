/**
 * One-time script to create Stripe coupons for founding member tiers.
 * Run with: npx tsx scripts/setup-stripe-coupons.ts
 *
 * Outputs env var values to add to .env.local
 */
import * as dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config({ path: ".env.local" });

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  const stripe = new Stripe(key);

  const coupons = [
    {
      envKey: "STRIPE_COUPON_FOUNDING_MEMBER",
      name: "Grundlægger – 25% for altid",
      percent_off: 25,
      duration: "forever" as const,
    },
    {
      envKey: "STRIPE_COUPON_EARLY_ADOPTER",
      name: "Tidlig Bruger – 20% for altid",
      percent_off: 20,
      duration: "forever" as const,
    },
    {
      envKey: "STRIPE_COUPON_BETA_USER",
      name: "Beta Bruger – 15% første år",
      percent_off: 15,
      duration: "repeating" as const,
      duration_in_months: 12,
    },
  ];

  console.log("Creating Stripe coupons...\n");

  const envLines: string[] = [];

  for (const coupon of coupons) {
    const params: Stripe.CouponCreateParams = {
      name: coupon.name,
      percent_off: coupon.percent_off,
      duration: coupon.duration,
    };
    if (coupon.duration === "repeating" && "duration_in_months" in coupon) {
      params.duration_in_months = coupon.duration_in_months;
    }

    const created = await stripe.coupons.create(params);
    envLines.push(`${coupon.envKey}=${created.id}`);
    console.log(`  Created: ${coupon.name} → ${created.id}`);
  }

  console.log("\n# Add these to .env.local:");
  for (const line of envLines) {
    console.log(line);
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
