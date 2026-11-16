import type { ReactNode } from "react";
import { mk } from "./mk";

/**
 * Hero til SEO- og indholdssider (docs/BRAND.md → Layout: venstrestillet,
 * asymmetrisk). `align="center"` er bevaret i typen for ældre kald, men
 * heroen er altid venstrestillet nu.
 */
export function MarketingHero({
  badge,
  title,
  subtitle,
  children,
  right,
}: {
  /** Lille label over overskriften. Bruges sparsomt (ingen versal-eyebrows). */
  badge?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  /** Forældet: heroen er altid venstrestillet. */
  align?: "center" | "left";
  right?: ReactNode;
}) {
  const hasRight = !!right;

  return (
    <section className="pt-28 pb-14 sm:pt-36 sm:pb-20">
      <div
        className={`${mk.wrap} ${hasRight ? "grid items-center gap-12 lg:grid-cols-2 lg:gap-16 [&>*]:min-w-0" : ""}`}
      >
        <div className="max-w-3xl">
          {badge && <div className="mb-5">{badge}</div>}
          <h1 className={mk.h1Small}>{title}</h1>
          {subtitle && (
            <p className={`${mk.lead} mt-6 max-w-2xl`}>{subtitle}</p>
          )}
          {children}
        </div>
        {right && <div className="relative">{right}</div>}
      </div>
    </section>
  );
}
