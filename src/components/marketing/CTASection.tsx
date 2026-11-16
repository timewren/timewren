import Link from "next/link";
import type { ReactNode } from "react";
import { appLinkHref } from "@/lib/config";
import { NO_STRINGS, TRIAL_DAYS } from "@/lib/marketing/pricing-copy";
import { mk } from "./mk";

// Plausible tagged event (taggedEvents er slået til i PlausibleProvider):
// klik på CTA'er tracker automatisk som "CTA Click", segmenterbart pr. side
// i Plausible. Det giver funnel-tal (besøg → CTA-klik) for alle SEO- og
// værktøjssider uden per-side instrumentering.
const PLAUSIBLE_CTA_CLASS = "plausible-event-name=CTA+Click";

/**
 * Afslutnings-CTA på marketing-sider. `checkmarks` er bevaret i typen for
 * ældre kald, men vises ikke længere som punkter: betingelserne står i én
 * sætning (docs/BRAND.md, reviewens P3).
 */
export function CTASection({
  title = `Prøv TimeTrack gratis i ${TRIAL_DAYS} dage`,
  subtitle,
  primaryHref,
  primaryLabel = `Prøv gratis i ${TRIAL_DAYS} dage`,
  secondaryHref,
  secondaryLabel,
  variant = "gradient",
  children,
}: {
  title?: string;
  subtitle?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  /** "gradient" er den store afslutnings-sektion (navnet er historisk). */
  variant?: "gradient" | "card" | "inline";
  children?: ReactNode;
  /** Forældet: vises ikke længere. */
  checkmarks?: string[];
}) {
  // /register ligger på app-hosten; relative links ville gå via en redirect
  const href =
    !primaryHref || primaryHref === "/register"
      ? appLinkHref("/register")
      : primaryHref;

  const buttons = (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <Link href={href} className={`${PLAUSIBLE_CTA_CLASS} ${mk.btnPrimary}`}>
        {primaryLabel}
      </Link>
      {secondaryHref && secondaryLabel && (
        <Link
          href={secondaryHref}
          className={`${PLAUSIBLE_CTA_CLASS} ${mk.btnSecondary}`}
        >
          {secondaryLabel}
        </Link>
      )}
    </div>
  );

  if (variant === "inline" || variant === "card") {
    return (
      <div className="rounded-[14px] bg-tt-flade p-6 sm:p-8">
        <h3 className="text-2xl font-bold tracking-[-0.02em] text-tt-blaek">
          {title}
        </h3>
        {subtitle && <p className={`${mk.body} mt-2`}>{subtitle}</p>}
        {variant === "card" ? children : null}
        {buttons}
        {variant === "inline" ? children : null}
      </div>
    );
  }

  return (
    <section
      id="get-started"
      className="border-t border-tt-streg bg-tt-flade py-20 sm:py-24"
    >
      <div className={mk.wrap}>
        <h2 className={`${mk.h2} max-w-3xl`}>{title}</h2>
        {subtitle && <p className={`${mk.lead} mt-5 max-w-2xl`}>{subtitle}</p>}
        {children || buttons}
        <p className={`${mk.fine} mt-6 max-w-2xl`}>{NO_STRINGS}</p>
      </div>
    </section>
  );
}
