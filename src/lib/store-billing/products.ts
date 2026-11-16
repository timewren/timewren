/**
 * Produktkataloget for køb i appen (kontrakt 23/10-2026). Kun Privat og
 * Selvstændig kan købes i appen; Team og Virksomhed kun på websitet. Ren
 * modul uden server-imports, så web-UI'et kan bruge labels og links herfra.
 */

export type StoreProvider = "apple" | "google";
export type StorePlanTier = "privat" | "solo";
export type StoreCycle = "monthly" | "yearly";

/** iOS-bundle og Android-package (samme id på begge platforme). */
export const STORE_APP_ID = "dk.timetrack.app";
/** App Store Connect app-id (Apple ID), kræves af Apples verifier i Production. */
export const APPLE_APP_APPLE_ID = 6812371822;

export interface StoreProduct {
  platform: "ios" | "android";
  productId: string;
  basePlanId?: string;
  planTier: StorePlanTier;
  cycle: StoreCycle;
}

const TIERS: StorePlanTier[] = ["privat", "solo"];
const CYCLES: StoreCycle[] = ["monthly", "yearly"];

export const STORE_PRODUCTS: readonly StoreProduct[] = [
  ...TIERS.flatMap((planTier) =>
    CYCLES.map((cycle) => ({
      platform: "ios" as const,
      productId: `${STORE_APP_ID}.${planTier}.${cycle}`,
      planTier,
      cycle,
    })),
  ),
  ...TIERS.flatMap((planTier) =>
    CYCLES.map((cycle) => ({
      platform: "android" as const,
      productId: planTier,
      basePlanId: cycle,
      planTier,
      cycle,
    })),
  ),
];

/** Apple-produkt-id → plan. null for ukendte produkter (fx et fremtidigt id). */
export function appleProduct(
  productId: string | null | undefined,
): StoreProduct | null {
  return (
    STORE_PRODUCTS.find(
      (p) => p.platform === "ios" && p.productId === productId,
    ) ?? null
  );
}

/** Google-produkt + basisplan → plan. null for ukendte kombinationer. */
export function googleProduct(
  productId: string | null | undefined,
  basePlanId: string | null | undefined,
): StoreProduct | null {
  return (
    STORE_PRODUCTS.find(
      (p) =>
        p.platform === "android" &&
        p.productId === productId &&
        p.basePlanId === basePlanId,
    ) ?? null
  );
}

export function storeProviderLabel(provider: string | null | undefined) {
  return provider === "google" ? "Google Play" : "App Store";
}

/** Hvor brugeren ændrer eller opsiger et butiksabonnement. */
export function storeManageUrl(
  provider: string | null | undefined,
  productId?: string | null,
): string {
  if (provider === "google") {
    const params = new URLSearchParams({ package: STORE_APP_ID });
    if (productId) params.set("sku", productId);
    return `https://play.google.com/store/account/subscriptions?${params.toString()}`;
  }
  return "https://apps.apple.com/account/subscriptions";
}
