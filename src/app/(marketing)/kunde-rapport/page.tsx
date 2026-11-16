import type { Metadata } from "next";
import Link from "next/link";
import { FeatureRows } from "@/components/marketing/FeatureRows";
import { mk } from "@/components/marketing/mk";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Kunderapport (timer pr. kunde)",
  description:
    "Send en klar kunderapport: timer pr. periode og leverancer, så fakturaen bliver lettere at godkende. Prøv TimeTrack gratis.",
  alternates: { canonical: "/kunde-rapport" },
};

// Schema-teksten (text) og den viste besvarelse (answer) holdes sammen, så
// FAQPage-markup og synligt indhold ikke glider fra hinanden.
const FAQ = [
  {
    question: "Skal rapporten sendes hver uge?",
    text: "Ikke nødvendigvis. Mange sender den månedligt, men ugentligt kan give færre overraskelser.",
    answer: (
      <p>
        Ikke nødvendigvis. Mange sender den månedligt, men ugentligt kan give
        færre overraskelser.
      </p>
    ),
  },
  {
    question: "Skal jeg sende rapporten sammen med faktura?",
    text: "Ja. Det gør fakturaen lettere at godkende og giver færre spørgsmål.",
    answer: (
      <p>Ja. Det gør fakturaen lettere at godkende og giver færre spørgsmål.</p>
    ),
  },
  {
    question: "Hvor starter jeg?",
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
];

export default function KundeRapportPage() {
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
      description: "Få timerne ind.",
    },
    {
      href: "/timerapport",
      title: "Timerapport",
      description: "Rapport over timer pr. periode.",
    },
    {
      href: "/fakturagrundlag",
      title: "Fakturagrundlag",
      description: "Tydelig specifikation.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Dokumentation pr. periode.",
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
      title="Kunderapport (timer pr. kunde)"
      subtitle="Når du sender en rapport til kunden, bliver fakturaen sjældent et problem. Det handler om en tydelig specifikation: timer pr. periode og hvad der er leveret."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
    >
      <FeatureRows
        title="Rapporten viser, hvad fakturaen bygger på"
        items={[
          {
            title: "Timer og leverancer",
            text: "Kunden kan se, hvilke timer der er brugt, og hvad der er leveret.",
          },
          {
            title: "Uge eller måned",
            text: "Rapporten samles pr. uge eller måned, pr. kunde og projekt.",
          },
          {
            title: "Du vælger detaljegraden",
            text: "Du bestemmer detaljegraden i rapporten, fx hvilke kolonner den viser, og om timerne grupperes pr. projekt eller pr. dag.",
          },
        ]}
      />

      <section className={mk.section}>
        <div
          className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
        >
          <h2 className={mk.h2}>Hvad skal en kunderapport indeholde?</h2>
          <div>
            <ul className={`${mk.body} list-disc space-y-3 pl-6`}>
              <li>Periode (fx 1.-31. jan.)</li>
              <li>Timer pr. projekt eller område</li>
              <li>
                Eventuelt korte beskrivelser, så rapporten ikke er en sort boks
              </li>
            </ul>
            <p className={`${mk.fine} mt-6`}>
              Se også{" "}
              <Link className={mk.link} href="/timerapport">
                timerapport
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
