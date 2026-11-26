"use client";

import Link from "next/link";
import { usePlausible } from "next-plausible";
import { mk } from "@/components/marketing/mk";
import { appLinkHref } from "@/lib/config";
import { TRIAL_DAYS } from "@/lib/marketing/pricing-copy";

const SECONDARY = {
  download: { href: "/download", label: "Hent appen" },
  pricing: { href: "/pricing", label: "Se priser" },
} as const;

/**
 * Forsidens to knapper og den sekundære vej til timeren uden konto.
 * Sender samme Plausible-event som resten af sitet (cta_signup_click).
 * I heroen er den anden knap "Hent appen"; prisen står i finprintet under.
 */
export function HeroCta({
  location = "home_hero",
  showTimerLink = true,
  secondary = "pricing",
}: {
  location?: string;
  showTimerLink?: boolean;
  secondary?: keyof typeof SECONDARY;
}) {
  const plausible = usePlausible();
  const second = SECONDARY[secondary];
  return (
    <div className="mt-8 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={appLinkHref("/register")}
          onClick={() =>
            plausible("cta_signup_click", {
              props: { location, href: "/register" },
            })
          }
          className={`plausible-event-name=CTA+Click ${mk.btnPrimary}`}
        >
          Prøv gratis i {TRIAL_DAYS} dage
        </Link>
        <Link href={second.href} className={mk.btnSecondary}>
          {second.label}
        </Link>
      </div>
      {showTimerLink ? (
        <p className="mt-4 text-[15px] text-tt-graa">
          Eller{" "}
          <a href="#timer" className={mk.link}>
            prøv timeren her, uden konto
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
