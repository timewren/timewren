import type { ReactNode } from "react";

const variants = {
  blue: "text-tt-gran",
  green: "text-tt-gran",
  amber: "text-tt-graa",
  slate: "text-tt-graa",
  purple: "text-tt-gran",
} as const;

/** Lille, rolig kontekst-linje over en overskrift (ikon + tekst). */
export function PillBadge({
  children,
  icon,
  variant = "blue",
}: {
  children: ReactNode;
  icon?: ReactNode;
  variant?: keyof typeof variants;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-sm font-medium [&_svg]:h-4 [&_svg]:w-4 ${variants[variant]}`}
    >
      {icon}
      {children}
    </span>
  );
}
