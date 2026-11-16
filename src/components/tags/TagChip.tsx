import { X } from "lucide-react";
import { useTranslations } from "next-intl";

interface TagChipProps {
  name: string;
  color: string;
  inherited?: boolean;
  onRemove?: () => void;
  size?: "sm" | "md";
}

export function TagChip({
  name,
  color,
  inherited,
  onRemove,
  size = "md",
}: TagChipProps) {
  const t = useTranslations("tags");
  const sizeClasses =
    size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClasses}`}
      style={{
        backgroundColor: `${color}20`,
        color,
        borderLeft: `3px solid ${color}`,
      }}
      title={inherited ? t("inherited") : undefined}
    >
      {name}
      {inherited && (
        <span className="opacity-50" role="img" aria-label="inherited">
          ↓
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100"
          aria-label={t("remove")}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
