import type { Metadata } from "next";
import Link from "next/link";
import { FeatureRows } from "@/components/marketing/FeatureRows";
import { mk } from "@/components/marketing/mk";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE, PLAN_PRICES } from "@/lib/marketing/pricing-copy";

const DESCRIPTION =
  "Dinero-integration med TimeTrack: registrér tid pr. kunde, og eksportér timer til Dinero. Automatisk fakturagrundlag og rapport. Gratis at starte.";

export const metadata: Metadata = {
  title: "Dinero-integration: timeregistrering",
  description: DESCRIPTION,
  openGraph: {
    title: "Dinero-integration: timeregistrering",
    description: DESCRIPTION,
  },
  alternates: { canonical: "/dinero" },
};

// Schema-teksten (text) og den viste besvarelse (answer) holdes sammen, så
// FAQPage-markup og synligt indhold ikke glider fra hinanden.
const FAQ = [
  {
    question: "Skal jeg bruge Dinero-integrationen for at få værdi?",
    text: "Nej. Start med rapport og CSV-eksport, og slå Dinero-integrationen til, når du er klar.",
    answer: (
      <p>
        Nej. Start med rapport og CSV-eksport, og slå Dinero-integrationen til,
        når du er klar.
      </p>
    ),
  },
  {
    question: "Hvad er det typiske flow med Dinero-integrationen?",
    text: "Registrér tid pr. kunde og projekt i TimeTrack, lav en rapport pr. periode, og eksportér til Dinero som fakturagrundlag.",
    answer: (
      <p>
        Registrér tid pr. kunde og projekt i TimeTrack, lav en rapport pr.
        periode, og eksportér til Dinero som fakturagrundlag.
      </p>
    ),
  },
  {
    question: "Hvilken side skal jeg starte på?",
    text: "Start på siden om timeregistrering.",
    answer: (
      <p>
        Start på siden om{" "}
        <Link className={mk.link} href="/timeregistrering">
          timeregistrering
        </Link>
        .
      </p>
    ),
  },
  {
    question: "Hvordan sætter jeg Dinero-integrationen op?",
    text: "Gå til Indstillinger og Integrationer, tryk Forbind til Dinero, log ind med din Dinero-konto, og giv adgang. Derefter kan du eksportere kunder og fakturaer direkte fra TimeTrack.",
    answer: (
      <p>
        Gå til Indstillinger og Integrationer, tryk{" "}
        <strong>Forbind til Dinero</strong>, log ind med din Dinero-konto, og
        giv adgang. Derefter kan du eksportere kunder og fakturaer direkte fra
        TimeTrack.
      </p>
    ),
  },
  {
    question: "Koster Dinero-integrationen ekstra?",
    text: `Nej. Dinero-integrationen er med i Selvstændig-planen til ${PLAN_PRICES.selvstaendig.price} ekskl. moms. Ingen ekstra betaling.`,
    answer: (
      <p>
        Nej. Dinero-integrationen er med i{" "}
        <Link className={mk.link} href="/pricing">
          Selvstændig-planen
        </Link>{" "}
        til {PLAN_PRICES.selvstaendig.price} ekskl. moms. Ingen ekstra betaling.
      </p>
    ),
  },
];

const STEPS = [
  {
    id: "konto",
    text: "Opret en TimeTrack-konto, og tilføj kunder og projekter.",
  },
  {
    id: "registrer",
    text: "Registrér tid på opgaver, manuelt eller med en timer.",
  },
  {
    id: "forbind",
    text: (
      <>
        Gå til Indstillinger og Integrationer, og tryk{" "}
        <strong>Forbind til Dinero</strong>.
      </>
    ),
  },
  {
    id: "eksport",
    text: "Eksportér kunder og fakturaer direkte fra TimeTrack. CSV og rapporter virker stadig, hvis du foretrækker det.",
  },
];

export default function DineroPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.text },
    })),
  };

  const faqItems = FAQ.map(({ question, answer }) => ({ question, answer }));

  const relatedLinks = [
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Registrér timer pr. kunde og projekt.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Gør timer til fakturagrundlag.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Dokumentation pr. periode.",
    },
    {
      href: "/billy",
      title: "Billy",
      description: "Integration med Billy regnskab.",
    },
    {
      href: "/e-conomic",
      title: "e-conomic",
      description: "TimeTrack og e-conomic.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
    {
      href: "/features",
      title: "Funktioner",
      description: "Overblik over funktionerne.",
    },
  ];

  return (
    <SEOPageLayout
      title="TimeTrack + Dinero"
      subtitle="Registrér tid pr. kunde og projekt, og eksportér timer og fakturagrundlag direkte til Dinero."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Dinero hænger typisk sammen med timeregistrering og fakturagrundlag:"
    >
      <FeatureRows
        title="Fra timer til faktura i Dinero"
        items={[
          {
            title: "Fakturagrundlag pr. kunde",
            text: "Hold styr på timer, beløb og hvad der er leveret, pr. kunde og periode.",
          },
          {
            title: "Eksport først, integration når du vil",
            text: "Start med rapport og CSV, og slå integrationen til, når du er klar.",
          },
          {
            title: "Kunder og fakturaer direkte",
            text: "Når Dinero er forbundet, eksporterer du kunder og fakturaer direkte fra TimeTrack.",
          },
        ]}
      />

      <section className={mk.section}>
        <div
          className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
        >
          <h2 className={mk.h2}>Sådan kommer du i gang</h2>
          <div>
            <ol className="border-t border-tt-streg">
              {STEPS.map((step, i) => (
                <li
                  key={step.id}
                  className="grid grid-cols-[2rem_1fr] gap-3 border-b border-tt-streg py-5"
                >
                  <span className="font-semibold tabular-nums text-tt-gran">
                    {i + 1}.
                  </span>
                  <span className={mk.body}>{step.text}</span>
                </li>
              ))}
            </ol>
            <p className={`${mk.fine} mt-6`}>
              Har du spørgsmål, så find kontaktoplysninger på{" "}
              <Link className={mk.link} href="/contact">
                kontaktsiden
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
