import type { Metadata } from "next";
import Link from "next/link";
import { FeatureRows } from "@/components/marketing/FeatureRows";
import { mk } from "@/components/marketing/mk";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Timeregistrering til Billy",
  description:
    "Timeregistrering til Billy: registrér tid pr. kunde og projekt, og få et fakturagrundlag, du kan eksportere eller koble til Billy. Prøv TimeTrack gratis.",
  alternates: { canonical: "/billy-timeregistrering" },
};

// Schema-teksten (text) og den viste besvarelse (answer) holdes sammen, så
// FAQPage-markup og synligt indhold ikke glider fra hinanden.
const FAQ = [
  {
    question: "Skal jeg bruge integrationen for at komme i gang?",
    text: "Nej. Start med rapport og CSV, og forbind Billy senere, hvis du vil.",
    answer: (
      <p>
        Nej. Start med rapport og CSV, og forbind Billy senere, hvis du vil.
      </p>
    ),
  },
  {
    question: "Hvordan får jeg et fakturagrundlag?",
    text: "Registrér tid pr. kunde og projekt, og lav en rapport pr. periode. Eksportér den, og brug den som specifikation.",
    answer: (
      <p>
        Registrér tid pr. kunde og projekt, og lav en rapport pr. periode.
        Eksportér den, og brug den som specifikation.
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
];

export default function BillyTimeregistreringPage() {
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
      href: "/billy",
      title: "TimeTrack + Billy",
      description: "Integration og eksport til Billy.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Gør timer til fakturagrundlag.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Registrér timer pr. kunde og projekt.",
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
      title="Timeregistrering til Billy"
      subtitle="Registrér tid pr. kunde og projekt, og få et fakturagrundlag, der er nemt at eksportere eller koble til Billy."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Billy hænger typisk sammen med timeregistrering og fakturagrundlag:"
    >
      <FeatureRows
        title="Fra timer til faktura i Billy"
        intro="TimeTrack samler timerne pr. kunde og periode, så fakturaen kan sendes til Billy som kladde."
        items={[
          {
            title: "Fakturagrundlag pr. kunde",
            text: "Få en klar specifikation pr. kunde og periode.",
          },
          {
            title: "CSV eller direkte til Billy",
            text: "Hent rapporten som CSV, eller forbind Billy og send fakturaen derhen som kladde.",
          },
          {
            title: "Timer registreret undervejs",
            text: "Registrér timerne, mens du arbejder, i stedet for at samle dem til sidst.",
          },
        ]}
      />
    </SEOPageLayout>
  );
}
