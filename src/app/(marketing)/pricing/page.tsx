import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { FAQAccordion } from "@/components/marketing/FAQAccordion";
import { FounderNote } from "@/components/marketing/FounderNote";
import { mk } from "@/components/marketing/mk";
import { TestimonialQuote } from "@/components/marketing/TestimonialQuote";
import { TrustBadge } from "@/components/marketing/TrustBadge";
import { Navigation } from "@/components/Navigation";
import { PRIVAT_MAX_ACTIVE_CLIENTS } from "@/lib/billing/plan-gate";
import {
  appLinkHref,
  BUSINESS_BASE_PRICE_MONTHLY,
  BUSINESS_BASE_PRICE_YEARLY,
  BUSINESS_MAX_SEATS,
  TEAM_BASE_PRICE_MONTHLY,
  TEAM_BASE_PRICE_YEARLY,
  TEAM_MAX_SEATS,
} from "@/lib/config";
import {
  AFTER_TRIAL_SOLO,
  AFTER_TRIAL_TEAM,
  FREE_LIMITS,
  kr,
  NO_STRINGS,
  PLAN_PRICES,
  type PlanKey,
  TRIAL_DAYS,
  VAT_NOTE,
} from "@/lib/marketing/pricing-copy";

const DESCRIPTION = `Priser på TimeTrack: Gratis, Privat ${PLAN_PRICES.privat.price}, Selvstændig ${PLAN_PRICES.selvstaendig.price}, Team ${PLAN_PRICES.team.price} og Virksomhed ${PLAN_PRICES.virksomhed.price}. Ekskl. moms. Prøv planen gratis i ${TRIAL_DAYS} dage uden betalingskort.`;

const SEATS_ANSWER = `Team koster ${PLAN_PRICES.team.price} (${PLAN_PRICES.team.extra}, op til ${TEAM_MAX_SEATS}). Virksomhed koster ${PLAN_PRICES.virksomhed.price} (${PLAN_PRICES.virksomhed.extra}). Er I flere end ${BUSINESS_MAX_SEATS}, så skriv til mig. ${VAT_NOTE}`;

const DATA_ANSWER =
  "Databasen ligger hos Hetzner i Tyskland, og filer og backup hos Hetzner i Finland. Enkelte underleverandører, fx til mail og fejlrapporter, er amerikanske.";

export const metadata: Metadata = {
  title: "Priser",
  description: DESCRIPTION,
  openGraph: { title: "Priser", description: DESCRIPTION },
  alternates: { canonical: "/pricing" },
};

type Row = {
  key: PlanKey;
  forWho: string;
  extraLines: string[];
  features: string[];
  signup: string;
  highlight?: boolean;
};

const ROWS: Row[] = [
  {
    key: "selvstaendig",
    forWho: "Til selvstændige",
    extraLines: [PLAN_PRICES.selvstaendig.extra ?? ""],
    features: [
      "Én bruger og ubegrænset antal kunder",
      "Klippekort og kundeportal",
      "Fakturagrundlag til Billy og Dinero, PDF og CSV",
      "Web, browserudvidelse, desktop-app og app til iPhone",
    ],
    signup: "/register",
    highlight: true,
  },
  {
    key: "team",
    forWho: "Til små bureauer og teams",
    extraLines: [
      `Fra ${kr(TEAM_BASE_PRICE_MONTHLY)}/md. for 2 brugere, eller ${kr(TEAM_BASE_PRICE_YEARLY)}/år`,
      `Op til ${TEAM_MAX_SEATS} brugere`,
    ],
    features: [
      "Alt fra Selvstændig",
      "Fælles kunder, projekter og klippekort",
      "Teamoverblik pr. dag og uge",
      "Timepriser pr. medlem",
    ],
    signup: "/register?plan=team",
  },
  {
    key: "virksomhed",
    forWho: "Til virksomheder med lovkravet",
    extraLines: [
      `Fra ${kr(BUSINESS_BASE_PRICE_MONTHLY)}/md. for 5 brugere, eller ${kr(BUSINESS_BASE_PRICE_YEARLY)}/år`,
      `Flere end ${BUSINESS_MAX_SEATS} brugere: skriv til mig`,
    ],
    features: [
      "Alt fra Team",
      "Check ind og ud, ferie, fravær og flex",
      "Godkendelser og løneksport",
      "Login med Microsoft Entra",
    ],
    signup: "/register?plan=business",
  },
  {
    key: "privat",
    forWho: "Til privatpersoner",
    extraLines: [PLAN_PRICES.privat.extra ?? ""],
    features: [
      `Én bruger og op til ${PRIVAT_MAX_ACTIVE_CLIENTS} aktive kunder`,
      "Med fakturering og klippekort",
    ],
    signup: "/register?plan=privat",
  },
  {
    key: "gratis",
    forWho: "Til at komme i gang",
    extraLines: [],
    features: [
      `${PLAN_PRICES.gratis.includes[0].toUpperCase()}${PLAN_PRICES.gratis.includes.slice(1)}`,
      "Alle apps er med",
    ],
    signup: "/register",
  },
];

const faqItems = [
  {
    question: `Hvad sker der efter de ${TRIAL_DAYS} dage?`,
    answer: (
      <>
        <p>
          {AFTER_TRIAL_SOLO} {FREE_LIMITS}
        </p>
        <p className="mt-2">{AFTER_TRIAL_TEAM}</p>
      </>
    ),
  },
  {
    question: "Er der binding?",
    answer:
      "Nej, ikke på månedsabonnementet. Du kan opsige, når du vil, og fortsætter så på Gratis uden at miste data. Betaler du for et år ad gangen, svarer prisen til 10 måneder.",
  },
  {
    question: "Hvilken plan skal et bureau prøve?",
    answer: `Team. I prøver Team gratis i ${TRIAL_DAYS} dage, og det koster bagefter ${PLAN_PRICES.team.price}, ${PLAN_PRICES.team.extra}.`,
  },
  { question: "Hvad koster ekstra brugere?", answer: SEATS_ANSWER },
  {
    question: "Kan jeg skifte plan senere?",
    answer:
      "Ja. Start alene på Selvstændig. Får du brug for flere hænder, skifter du til Team under Indstillinger → Abonnement og inviterer dem derfra. Dine kunder, projekter og klippekort bliver på samme konto.",
  },
  {
    question: "Skal jeg bruge Billy eller Dinero?",
    answer:
      "Nej. Du kan bruge TimeTrack uden integrationer og hente timerne som PDF og CSV.",
  },
  {
    question: "Hvor ligger mine data?",
    answer: (
      <>
        {DATA_ANSWER}{" "}
        <Link className={mk.link} href="/tillid">
          Se alle databehandlere, backup og sletning
        </Link>
        .
      </>
    ),
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: `Hvad sker der efter de ${TRIAL_DAYS} dage?`,
      acceptedAnswer: {
        "@type": "Answer",
        text: `${AFTER_TRIAL_SOLO} ${FREE_LIMITS} ${AFTER_TRIAL_TEAM}`,
      },
    },
    {
      "@type": "Question",
      name: "Er der binding?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Nej, ikke på månedsabonnementet. Du kan opsige, når du vil.",
      },
    },
    {
      "@type": "Question",
      name: "Hvad koster ekstra brugere?",
      acceptedAnswer: { "@type": "Answer", text: SEATS_ANSWER },
    },
    {
      "@type": "Question",
      name: "Hvor ligger mine data?",
      acceptedAnswer: { "@type": "Answer", text: DATA_ANSWER },
    },
  ],
};

export default function PricingPage() {
  return (
    <div className={mk.page}>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Navigation />

      <main>
        <section className="pt-28 pb-12 sm:pt-36 sm:pb-16">
          <div className={mk.wrap}>
            <TrustBadge />
            <h1 className={`${mk.h1Small} mt-4 max-w-4xl`}>
              Prøv den plan, der passer, gratis i {TRIAL_DAYS} dage
            </h1>
            <p className={`${mk.lead} mt-6 max-w-2xl`}>
              {AFTER_TRIAL_SOLO} {VAT_NOTE}
            </p>
          </div>
        </section>

        <section aria-label="Planer" className="pb-16">
          <div className={mk.wrap}>
            <ul className="border-t border-tt-streg">
              {ROWS.map((r) => {
                const p = PLAN_PRICES[r.key];
                return (
                  <li
                    key={r.key}
                    className={`-mx-4 grid gap-6 border-b border-tt-streg px-4 py-8 sm:-mx-6 sm:px-6 lg:grid-cols-[1fr_1fr_1.3fr_12rem] lg:items-start lg:gap-10 ${
                      r.highlight ? "rounded-[14px] bg-tt-gran-lys" : ""
                    }`}
                  >
                    <div>
                      <h2 className="text-2xl font-bold tracking-[-0.02em] text-tt-blaek">
                        {p.name}
                      </h2>
                      <p className="mt-1 text-tt-graa">{r.forWho}</p>
                    </div>
                    <div>
                      <p className="text-[32px] font-bold leading-none tracking-[-0.03em] text-tt-blaek">
                        {p.amount}
                        {p.unit ? (
                          <span className="ml-1.5 text-base font-medium tracking-normal text-tt-graa">
                            {p.unit}
                          </span>
                        ) : null}
                      </p>
                      {r.key === "team" || r.key === "virksomhed" ? (
                        <p className="mt-2 text-sm text-tt-graa">{p.extra}</p>
                      ) : null}
                      {r.extraLines.filter(Boolean).map((l) => (
                        <p key={l} className="mt-1 text-sm text-tt-graa">
                          {l}
                        </p>
                      ))}
                    </div>
                    <ul className="space-y-1.5 text-[15px] text-tt-blaek">
                      {r.features.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    <div>
                      <a
                        href={appLinkHref(r.signup)}
                        className={`plausible-event-name=CTA+Click lg:w-full ${r.highlight ? mk.btnPrimary : mk.btnSecondary}`}
                      >
                        {r.key === "gratis"
                          ? "Opret gratis konto"
                          : `Prøv ${p.name}`}
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className={`${mk.fine} mt-6 max-w-3xl space-y-2`}>
              <p>
                {VAT_NOTE} {NO_STRINGS}
              </p>
              <p>{AFTER_TRIAL_TEAM}</p>
              <p>
                Desktop-appen, browserudvidelsen og appen til iPhone og iPad er
                med i alle planer.{" "}
                <Link href="/team-prisberegner" className={mk.link}>
                  Beregn prisen for jeres team
                </Link>
              </p>
            </div>
          </div>
        </section>

        <section className={mk.section}>
          <div className={mk.wrap}>
            <TestimonialQuote excerpt="Ikke alene er systemet nemt og overskueligt at bruge, men servicen er også i top." />
          </div>
        </section>

        <section className={mk.section}>
          <div
            className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
          >
            <div>
              <h2 className={mk.h2}>Spørgsmål om pris</h2>
              <FounderNote className="mt-8" />
            </div>
            <FAQAccordion title="" items={faqItems} />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
