"use client";

import { Crown } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Diskret Founding-kunde-mærke. Ren markering: ingen funktion afhænger af det.
 */
export function FoundingCustomerBadge({ size = "sm" }: { size?: "xs" | "sm" }) {
  const t = useTranslations("shell.org");
  const cls =
    size === "xs"
      ? "gap-1 px-1.5 py-px text-[10px]"
      : "gap-1 px-2 py-0.5 text-xs";
  return (
    <span
      data-testid="founding-customer-badge"
      className={`inline-flex shrink-0 items-center rounded-full bg-amber-100 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 ${cls}`}
    >
      <Crown className={size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"} />
      {t("founding")}
    </span>
  );
}
