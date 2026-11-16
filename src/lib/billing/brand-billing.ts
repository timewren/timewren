import { accountBrand } from "@/lib/auth/account-brand";
import { type BrandKey, DEFAULT_BRAND_KEY } from "@/lib/brands/registry";
import type { db as Db } from "@/lib/db";

/**
 * Kan brandet sende kunder videre til betaling (docs/specs/timewren-cloud.md
 * → 10, "Betaling")? TimeTrack: ja, Alunta som altid. TimeWren: ikke endnu.
 * Alunta-checkout og kvitteringer er TimeTracks (DKK, TimeTrack-navn), så
 * TimeWren-konti starter på Gratis uden prøveperiode, og opgradering vises
 * som "kommer snart". Gælder kun TimeWren-konti, dvs. kun med
 * MULTIBRAND_ENABLED=1 og TIMEWREN_APP_ENABLED=1 (ellers er alle timetrack).
 */
export function isCheckoutAvailableForBrand(brand: BrandKey): boolean {
  return brand === DEFAULT_BRAND_KEY;
}

export async function isCheckoutAvailableForUser(
  db: typeof Db,
  userId: string,
): Promise<boolean> {
  return isCheckoutAvailableForBrand(await accountBrand(db, userId));
}
