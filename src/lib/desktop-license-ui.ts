import { DESKTOP_LIFETIME_PRICE } from "@/lib/config";

/** Buy-button label for the desktop lifetime license, e.g. "Køb licens (499 kr)". */
export function desktopBuyButtonLabel(
  priceDkk: number = DESKTOP_LIFETIME_PRICE,
): string {
  return `Køb licens (${priceDkk} kr)`;
}
