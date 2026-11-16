import { Crown } from "lucide-react";

/** Support-prioritet: sagen kommer fra en Founding-kunde (kun markering). */
export function FoundingSupportBadge() {
  return (
    <span
      data-testid="founding-support-badge"
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
    >
      <Crown className="h-3 w-3" />
      Founding-kunde
    </span>
  );
}
