import Link from "next/link";
import { Footer } from "@/components/Footer";
import { AppStoreBadge } from "@/components/marketing/AppStoreBadge";
import { FounderNote } from "@/components/marketing/FounderNote";
import { HeroKlippekort } from "@/components/marketing/home/HeroKlippekort";
import { HeroTimer } from "@/components/marketing/home/HeroTimer";
import { LovkravKort } from "@/components/marketing/LovkravKort";
import { mk } from "@/components/marketing/mk";
import { SegmentRows } from "@/components/marketing/SegmentRows";
import { SHOTS, Shot } from "@/components/marketing/Shot";
import { TestimonialQuote } from "@/components/marketing/TestimonialQuote";
import { TrustBadge } from "@/components/marketing/TrustBadge";
import { Navigation } from "@/components/Navigation";
import { appLinkHref } from "@/lib/config";
import {
  AFTER_TRIAL_SOLO_SHORT,
  AFTER_TRIAL_TEAM,
  FREE_LIMITS,
  NO_STRINGS,
  PLAN_PRICES,
  TRIAL_DAYS,
  VAT_NOTE,
} from "@/lib/marketing/pricing-copy";
import type { Segment } from "@/lib/marketing/segments";

// Samme Plausible tagged event som CTASection, så segmentsidernes CTA-klik
// lander i den eksisterende funnel.
const PLAUSIBLE_CTA_CLASS = "plausible-event-name=CTA+Click";

/**
 * Delt skabelon for segmentsiderne (/selvstaendig, /teams-og-bureauer,
 * /virksomheder, /privat). Samme hero-mønster som forsiden, tilpasset
 * segmentet (docs/BRAND.md §7 og §9). Indholdet kommer fra
 * src/lib/marketing/segments.ts, priserne fra pricing-copy.ts.
 */
export function SegmentPage({ segment }: { segment: Segment }) {
  const signupHref = appLinkHref(`/register?ref=segment-${segment.slug}`);
  const price = PLAN_PRICES[segment.plan];
  const isTeamish = segment.trial === "team";

  const cta = (
    <div className="mt-8 mb-4 flex flex-wrap items-center gap-3">
      <a
        href={signupHref}
        className={`${PLAUSIBLE_CTA_CLASS} ${mk.btnPrimary}`}
      >
        Prøv gratis i {TRIAL_DAYS} dage
      </a>
      <Link href="/pricing" className={mk.btnSecondary}>
        Se priser
      </Link>
    </div>
  );

  const priceLine =
    segment.plan === "privat"
      ? `Gratis med ${PLAN_PRICES.gratis.includes}, eller ${price.name} ${price.price} ekskl. moms.`
      : `${price.name} ${price.price}${price.extra ? `, ${price.extra}` : ""}, ekskl. moms. ${isTeamish ? "Intet betalingskort for at prøve." : `${AFTER_TRIAL_SOLO_SHORT} Intet betalingskort.`}`;

  return (
    <div className={mk.page}>
      <Navigation />

      <main>
        {/* Hero */}
        <section className="pt-28 pb-16 sm:pt-36 sm:pb-20">
          <div className={mk.wrap}>
            <TrustBadge />
            <h1 className={`${mk.h1Small} mt-4 max-w-4xl`}>
              {segment.hero.title}
            </h1>
            <div className="mt-10 grid items-start gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16 [&>*]:min-w-0">
              <div>
                <p className={`${mk.lead} max-w-xl`}>{segment.hero.subtitle}</p>
                {segment.painPoint ? (
                  <p className={`${mk.body} mt-4 max-w-xl`}>
                    {segment.painPoint}
                  </p>
                ) : null}
                {cta}
                <p className={`${mk.fine} max-w-xl`}>{priceLine}</p>
                {segment.founder === "standard" ? (
                  <FounderNote className="mt-9 max-w-xl" />
                ) : null}
              </div>
              <HeroVisual segment={segment} />
            </div>
          </div>
        </section>

        {segment.slug === "selvstaendig" ? (
          <section aria-label="Kundecitat" className={mk.section}>
            <div className={mk.wrap}>
              <TestimonialQuote excerpt="Det er nemt at registrere sin tid og bevare overblikket, så man kan bruge energien på det arbejde, der faktisk skaber værdi." />
            </div>
          </section>
        ) : null}

        {/* Det får du: rækker, ikke ens ikon-kort */}
        <section aria-labelledby="punkter-heading" className={mk.section}>
          <div
            className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
          >
            <h2 id="punkter-heading" className={mk.h2}>
              Det får du med {price.name}
            </h2>
            <dl className="border-t border-tt-streg">
              {segment.points.map((p) => (
                <div
                  key={p.title}
                  className="grid gap-1 border-b border-tt-streg py-5 sm:grid-cols-[220px_1fr] sm:gap-6"
                >
                  <dt className="font-semibold text-tt-blaek">{p.title}</dt>
                  <dd className={mk.body}>{p.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <SegmentExtra segment={segment} />

        {/* Pris */}
        <section aria-labelledby="pris-heading" className={mk.section}>
          <div
            className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
          >
            <h2 id="pris-heading" className={mk.h2}>
              Hvad det koster
            </h2>
            <div>
              <p className="text-[40px] font-bold leading-none tracking-[-0.03em] text-tt-blaek sm:text-[56px]">
                {segment.plan === "privat" ? "0 kr. eller " : null}
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
              <div className={`${mk.fine} mt-6 max-w-2xl space-y-2`}>
                <p>{NO_STRINGS}</p>
                <p>
                  {isTeamish
                    ? AFTER_TRIAL_TEAM
                    : `${AFTER_TRIAL_SOLO_SHORT} ${FREE_LIMITS}`}
                </p>
              </div>
              <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
                <Link href="/pricing" className={mk.link}>
                  Se alle planer og priser
                </Link>
                {isTeamish ? (
                  <Link href="/team-prisberegner" className={mk.link}>
                    Beregn prisen for jeres team
                  </Link>
                ) : null}
              </p>
            </div>
          </div>
        </section>

        {/* Andre spor */}
        <section aria-labelledby="andre-heading" className={mk.section}>
          <div className={mk.wrap}>
            <h2 id="andre-heading" className={mk.h2}>
              TimeTrack til andre
            </h2>
            <SegmentRows exclude={segment.slug} className="mt-10" />
          </div>
        </section>

        {/* Afslutning */}
        <section className="border-t border-tt-streg py-20 sm:py-24">
          <div className={mk.wrap}>
            <h2 className={`${mk.h2} max-w-3xl`}>
              Prøv det i {TRIAL_DAYS} dage, uden betalingskort
            </h2>
            {cta}
            {segment.founder === "nedtonet" ? (
              <FounderNote variant="nedtonet" className="mt-6 max-w-2xl" />
            ) : null}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function HeroVisual({ segment }: { segment: Segment }) {
  switch (segment.visual) {
    case "klippekort":
      return <HeroKlippekort />;
    case "timer":
      return (
        <div id="timer" className="scroll-mt-20">
          <HeroTimer />
        </div>
      );
    case "extension":
      return (
        <Shot
          shot={SHOTS.extension}
          caption="Skærmbillede af browserudvidelsen med testdata. Udvidelsen får det nye udseende i en senere version."
          framed
          maxWidth={320}
          priority
        />
      );
    case "lovkrav":
      return <LovkravKort />;
  }
}

function SegmentExtra({ segment }: { segment: Segment }) {
  if (segment.slug === "selvstaendig") {
    return (
      <section aria-labelledby="portal-heading" className={mk.section}>
        <div
          className={`${mk.wrap} grid items-center gap-12 lg:grid-cols-2 lg:gap-16 [&>*]:min-w-0`}
        >
          <div>
            <h2 id="portal-heading" className={mk.h2}>
              Kunden ser det samme som dig
            </h2>
            <p className={`${mk.lead} mt-5 max-w-xl`}>
              Del et link til kundeportalen, så kunden selv kan se saldo og
              posteringer. Det sparer mails om, hvad timerne er gået til.
            </p>
          </div>
          <Shot
            shot={SHOTS.portal}
            caption="Skærmbillede fra kundeportalen med opdigtede testdata."
            framed
            maxWidth={360}
          />
        </div>
      </section>
    );
  }

  if (segment.slug === "teams-og-bureauer") {
    return (
      <>
        <section aria-labelledby="voks-heading" className={mk.section}>
          <div className={mk.wrap}>
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-16">
              <h2 id="voks-heading" className={mk.h2}>
                Startede du alene?
              </h2>
              <p className={`${mk.body} max-w-xl lg:pt-3`}>
                Start på Selvstændig. Ansætter du, skifter du til Team under
                Indstillinger → Abonnement og inviterer dem derfra. Dine kunder,
                projekter og klippekort bliver på samme konto.
              </p>
            </div>
          </div>
        </section>
        <section aria-labelledby="team-heading" className={mk.section}>
          <div className={mk.wrap}>
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-16">
              <h2 id="team-heading" className={mk.h2}>
                Hvem har registreret hvad i denne uge
              </h2>
              <p className={`${mk.body} max-w-xl lg:pt-3`}>
                Teamoverblikket viser timerne pr. medarbejder og dag, så du ser
                hullerne, før du fakturerer. Klik på en dag for at se, hvad
                tiden er gået til.
              </p>
            </div>
            <Shot
              shot={SHOTS.team}
              caption="Skærmbillede af teamoverblikket med opdigtede testdata."
              className="mt-10"
            />
          </div>
        </section>
        <section aria-labelledby="portal-heading" className={mk.section}>
          <div
            className={`${mk.wrap} grid items-center gap-12 lg:grid-cols-2 lg:gap-16 [&>*]:min-w-0`}
          >
            <div>
              <h2 id="portal-heading" className={mk.h2}>
                Ét klippekort for hele holdet
              </h2>
              <p className={`${mk.lead} mt-5 max-w-xl`}>
                Alle trækker fra den samme saldo, og kunden ser forbruget i
                kundeportalen. Så er der ét tal at tale ud fra.
              </p>
            </div>
            <Shot
              shot={SHOTS.portal}
              caption="Skærmbillede fra kundeportalen med opdigtede testdata."
              framed
              maxWidth={360}
            />
          </div>
        </section>
      </>
    );
  }

  if (segment.slug === "virksomheder") {
    const tryg = [
      {
        title: "Databehandleraftale for alle planer",
        text: "Aftalen kan læses og hentes som PDF uden login.",
        href: "/databehandleraftale",
        link: "Læs databehandleraftalen",
      },
      {
        title: "Database og backup i EU",
        text: "Hos Hetzner i Tyskland og Finland. Underleverandører uden for EU står på listen.",
        href: "/tillid#hosting",
        link: "Se hosting og underleverandører",
      },
      {
        title: "Jeres data kan altid hentes ud",
        text: "Ejere og administratorer kan selv hente alle organisationens data som én fil.",
        href: "/tillid#eksport",
        link: "Sådan virker eksporten",
      },
      {
        title: "Hvis TimeTrack en dag lukker",
        text: "I får besked på mail mindst 6 måneder før, og data kan hentes hele perioden.",
        href: "/tillid#kontinuitet",
        link: "Læs om kontinuitet",
      },
    ];
    return (
      <section
        aria-labelledby="tryg-heading"
        className={`${mk.section} bg-tt-flade`}
      >
        <div
          className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
        >
          <div>
            <h2 id="tryg-heading" className={mk.h2}>
              Tryghed, før I skifter
            </h2>
            <p className={`${mk.body} mt-4`}>
              TimeTrack er lavet af Mahoje v/ Mads Holst Jensen, CVR 39413892.
            </p>
          </div>
          <dl className="border-t border-tt-streg">
            {tryg.map((t) => (
              <div key={t.title} className="border-b border-tt-streg py-5">
                <dt className="font-semibold text-tt-blaek">{t.title}</dt>
                <dd className={`${mk.body} mt-1`}>
                  {t.text}{" "}
                  <Link href={t.href} className={mk.link}>
                    {t.link}
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    );
  }

  // privat
  return (
    <section aria-labelledby="app-heading" className={mk.section}>
      <div
        className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
      >
        <h2 id="app-heading" className={mk.h2}>
          På telefonen
        </h2>
        <div>
          <p className={`${mk.body} max-w-2xl`}>
            Appen til iPhone og iPad ligger i App Store og kan bruges uden
            konto. Android-appen kommer snart i Google Play, og indtil da virker
            TimeTrack i telefonens browser, hvor du kan lægge den på
            hjemmeskærmen.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <AppStoreBadge brand="timetrack" height={44} />
            <Link href="/download" className={mk.link}>
              Hent appen
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
