import { accountBrand } from "@/lib/auth/account-brand";
import { type BrandKey, DEFAULT_BRAND_KEY } from "@/lib/brands/registry";
import type { db as Db } from "@/lib/db";
import { isStripeBillingBrand } from "./timewren-stripe";

/**
 * Kan brandet bruge TimeTracks betaling (Alunta, App Store, Google Play,
 * desktop-licensen; docs/specs/timewren-cloud.md → "Betaling på TimeWren")?
 * TimeTrack: ja, som altid. TimeWren: nej. Alunta-checkout og kvitteringer
 * er TimeTracks (DKK, TimeTrack-navn); TimeWren-konti betaler i stedet med
 * Stripe i EUR (lib/billing/timewren-stripe.ts) og starter på Gratis.
 * Gælder kun TimeWren-konti, dvs. kun med MULTIBRAND_ENABLED=1 og
 * TIMEWREN_APP_ENABLED=1 (ellers er alle timetrack).
 */
export function isCheckoutAvailableForBrand(brand: BrandKey): boolean {
  return brand === DEFAULT_BRAND_KEY;
}

/**
 * Brandets betaling: "alunta" (TimeTrack), "stripe" (TimeWren Cloud, når
 * slået til) eller null (TimeWren uden betaling: Gratis).
 */
export function billingProviderForBrand(
  brand: BrandKey,
): "alunta" | "stripe" | null {
  if (isCheckoutAvailableForBrand(brand)) return "alunta";
  return isStripeBillingBrand(brand) ? "stripe" : null;
}

export async function isCheckoutAvailableForUser(
  db: typeof Db,
  userId: string,
): Promise<boolean> {
  return isCheckoutAvailableForBrand(await accountBrand(db, userId));
}
