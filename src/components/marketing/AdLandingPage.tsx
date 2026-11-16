import Link from "next/link";
import { Logo } from "@/components/Logo";
import { FAQAccordion } from "@/components/marketing/FAQAccordion";
import { FounderNote } from "@/components/marketing/FounderNote";
import { HeroKlippekort } from "@/components/marketing/home/HeroKlippekort";
import { LovkravKort } from "@/components/marketing/LovkravKort";
import { mk } from "@/components/marketing/mk";
import { SHOTS, Shot } from "@/components/marketing/Shot";
import { TeamPrisBeregner } from "@/components/marketing/TeamPrisBeregner";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { appLinkHref } from "@/lib/config";
import type { AdLanding } from "@/lib/marketing/ad-landings";
import {
  AFTER_TRIAL_SOLO_SHORT,
  AFTER_TRIAL_TEAM,
  NO_STRINGS,
  PLAN_PRICES,
  TRIAL_DAYS,
  VAT_NOTE,
} from "@/lib/marketing/pricing-copy";

// Samme Plausible-event som segmentsiderne, så LP-klik lander i funnelen.
const PLAUSIBLE_CTA_CLASS = "plausible-event-name=CTA+Click";

/**
 * Skabelon for Google Ads-landingssiderne (/lp/<slug>). Bevidst uden den
 * fulde navigation: siden har én handling, og hvert ekstra link er et sted
 * at forsvinde hen fra et betalt klik. Samme hero-mønster som forsiden.
 */
export function AdLandingPage({ landing }: { landing: AdLanding }) {
  const signupHref = appLinkHref(
    `/register?plan=${landing.plan}&ref=lp-${landing.slug}`,
  );
  const price = PLAN_PRICES[landing.pricePlan];
  const isTeamish =
    landing.pricePlan === "team" || landing.pricePlan === "virksomhed";

  const cta = (label = `Prøv gratis i ${TRIAL_DAYS} dage`) => (
    <a href={signupHref} className={`${PLAUSIBLE_CTA_CLASS} ${mk.btnPrimary}`}>
      {label}
    </a>
  );

  return (
    <div className={mk.page}>
      <header className="border-b border-tt-streg">
        <div className={`${mk.wrap} flex items-center justify-between py-3`}>
          <Link href="/" aria-label="TimeTrack forside" className="rounded-lg">
            <Logo size="md" />
          </Link>
          <a
            href={signupHref}
            className={`${PLAUSIBLE_CTA_CLASS} inline-flex min-h-10 items-center rounded-lg bg-tt-gran px-4 text-[15px] font-semibold text-tt-paa-gran hover:bg-tt-gran-moerk`}
          >
            Prøv gratis
          </a>
        </div>
      </header>

      <main>
        <section className="pt-12 pb-16 sm:pt-16 sm:pb-20">
          <div className={mk.wrap}>
            <h1 className={`${mk.h1Small} max-w-4xl`}>{landing.hero.title}</h1>
            <div className="mt-10 grid items-start gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16 [&>*]:min-w-0">
              <div>
                <p className={`${mk.lead} max-w-xl`}>{landing.hero.subtitle}</p>
                <div className="mt-8 mb-4">{cta()}</div>
                <p className={`${mk.fine} max-w-xl`}>
                  Intet betalingskort. {price.name} koster {price.price}
                  {price.extra ? `, ${price.extra}` : ""}, ekskl. moms.{" "}
                  {isTeamish ? null : AFTER_TRIAL_SOLO_SHORT}
                </p>
                {isTeamish ? (
                  <FounderNote variant="nedtonet" className="mt-8 max-w-xl" />
                ) : (
                  <FounderNote className="mt-9 max-w-xl" />
                )}
              </div>
              {landing.visual === "klippekort" ? (
                <HeroKlippekort />
              ) : landing.visual === "lovkrav" ? (
                <LovkravKort showLink={false} />
              ) : (
                <Shot
                  shot={SHOTS.uge}
                  caption="Skærmbillede af ugeoversigten med opdigtede testdata."
                  priority
                />
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="fordele-heading" className={mk.section}>
          <div
            className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
          >
            <h2 id="fordele-heading" className={mk.h2}>
              Det får du
            </h2>
            <dl className="border-t border-tt-streg">
              {landing.benefits.map((b) => (
                <div
                  key={b.title}
                  className="grid gap-1 border-b border-tt-streg py-5 sm:grid-cols-[220px_1fr] sm:gap-6"
                >
                  <dt className="font-semibold text-tt-blaek">{b.title}</dt>
                  <dd className={mk.body}>{b.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {landing.extra === "team-prisberegner" && (
          <section aria-labelledby="beregner-heading" className={mk.section}>
            <div className={mk.wrap}>
              <h2 id="beregner-heading" className={`${mk.h2} mb-8`}>
                Hvad koster det for jer?
              </h2>
              <ToolUsageTracker tool="team-prisberegner">
                <TeamPrisBeregner
                  defaultNeedsHr={landing.plan === "business"}
                  signupRef={`lp-${landing.slug}`}
                />
              </ToolUsageTracker>
            </div>
          </section>
        )}

        <section aria-labelledby="start-heading" className={mk.section}>
          <div className={`${mk.wrap} grid gap-12 lg:grid-cols-2 lg:gap-16`}>
            <div>
              <h2 id="start-heading" className={mk.h2}>
                Sådan kommer du i gang
              </h2>
              <ol className="mt-8 border-t border-tt-streg">
                {landing.steps.map((step, i) => (
                  <li
                    key={step}
                    className="flex gap-4 border-b border-tt-streg py-4"
                  >
                    <span className="w-5 shrink-0 text-sm font-semibold text-tt-graa tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-tt-blaek">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="lg:pt-2">
              <p className="text-[40px] font-bold leading-none tracking-[-0.03em] text-tt-blaek sm:text-[56px]">
                {price.amount}
                <span className="ml-2 text-lg font-medium tracking-normal text-tt-graa">
                  {price.unit}
                </span>
              </p>
              <p className={`${mk.body} mt-3`}>
                {price.name}
                {price.extra ? `, ${price.extra}` : ""}. {price.includes}.{" "}
                {VAT_NOTE}
              </p>
              <div className={`${mk.fine} mt-5 space-y-2`}>
                <p>{NO_STRINGS}</p>
                <p>
                  {isTeamish
                    ? AFTER_TRIAL_TEAM
                    : `${AFTER_TRIAL_SOLO_SHORT} Gratis har ${PLAN_PRICES.gratis.includes}.`}
                </p>
              </div>
              <div className="mt-6">{cta()}</div>
            </div>
          </div>
        </section>

        <section className={mk.section}>
          <div className={`${mk.wrap} max-w-3xl`}>
            <FAQAccordion
              title="Spørgsmål"
              items={landing.faq.map((f) => ({
                question: f.question,
                answer: <p>{f.answer}</p>,
              }))}
            />
          </div>
        </section>

        <section className="border-t border-tt-streg bg-tt-flade py-16 sm:py-20">
          <div className={mk.wrap}>
            <h2 className={`${mk.h2} max-w-3xl`}>
              Prøv {price.name} gratis i {TRIAL_DAYS} dage
            </h2>
            <div className="mt-8">{cta()}</div>
          </div>
        </section>
      </main>

      <footer className="py-6">
        <ul
          className={`${mk.wrap} flex flex-wrap gap-x-5 gap-y-2 text-sm text-tt-graa`}
        >
          <li>
            <Link href="/" className="hover:text-tt-blaek">
              timetrack.dk
            </Link>
          </li>
          <li>
            <Link href="/tillid" className="hover:text-tt-blaek">
              Tillid og data
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="hover:text-tt-blaek">
              Privatliv
            </Link>
          </li>
          <li>
            <Link href="/terms" className="hover:text-tt-blaek">
              Vilkår
            </Link>
          </li>
          <li>
            <Link href="/cookies" className="hover:text-tt-blaek">
              Cookies
            </Link>
          </li>
        </ul>
      </footer>
    </div>
  );
}
