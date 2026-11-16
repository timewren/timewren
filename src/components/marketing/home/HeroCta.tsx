"use client";

import Link from "next/link";
import { usePlausible } from "next-plausible";
import { mk } from "@/components/marketing/mk";
import { appLinkHref } from "@/lib/config";
import { TRIAL_DAYS } from "@/lib/marketing/pricing-copy";

/**
 * Forsidens to knapper og den sekundære vej til timeren uden konto.
 * Sender samme Plausible-event som resten af sitet (cta_signup_click).
 */
export function HeroCta({
  location = "home_hero",
  showTimerLink = true,
}: {
  location?: string;
  showTimerLink?: boolean;
}) {
  const plausible = usePlausible();
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
        <Link href="/pricing" className={mk.btnSecondary}>
          Se priser
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
