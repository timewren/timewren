import { Crown } from "lucide-react";
import { useUiText } from "./use-ui-text";

interface FoundingTierBadgeProps {
  tier: string;
  discountPercent?: number;
  showDiscount?: boolean;
  size?: "sm" | "md";
}

export function FoundingTierBadge({
  tier,
  discountPercent,
  showDiscount = false,
  size = "sm",
}: FoundingTierBadgeProps) {
  const t = useUiText();
  if (tier !== "founding_member") return null;

  const sizeClasses =
    size === "md" ? "px-3 py-1.5 text-sm gap-1.5" : "px-2 py-0.5 text-xs gap-1";

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 ${sizeClasses}`}
    >
      <Crown className={size === "md" ? "h-4 w-4" : "h-3 w-3"} />
      {t("founding")}
      {showDiscount && discountPercent != null && discountPercent > 0 && (
        <span className="opacity-75">({discountPercent}%)</span>
      )}
    </span>
  );
}
