import type { Metadata } from "next";
import Link from "next/link";
import { FeatureRows } from "@/components/marketing/FeatureRows";
import { mk } from "@/components/marketing/mk";
import { OnlineStopwatch } from "@/components/marketing/OnlineStopwatch";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Online stopur: gratis, med omgange og uden login",
  description:
    "Gratis online stopur, der virker med det samme: start, stop, omgange og nulstil med ét klik. Med en gratis konto kan du gemme tiden pr. kunde og projekt.",
  alternates: { canonical: "/online-stopur" },
};

// Schema-teksten (text) og den viste besvarelse (answer) holdes sammen, så
// FAQPage-markup og synligt indhold aldrig glider fra hinanden.
const FAQ = [
  {
    question: "Kan jeg bruge stopuret gratis?",
    text: "Ja. Stopuret er gratis og kræver ingen login. Du kan bruge det med det samme.",
    answer: (
      <p>
        Ja. Stopuret er gratis og kræver ingen login. Du kan bruge det med det
        samme.
      </p>
    ),
  },
  {
    question: "Kan jeg gemme mine tider?",
    text: "Stopuret på denne side gemmer ikke tider. Opret en gratis TimeTrack-konto for at gemme timer pr. kunde og projekt.",
    answer: (
      <p>
        Stopuret på denne side gemmer ikke tider. Opret en gratis{" "}
        <Link className={mk.link} href="/register">
          TimeTrack-konto
        </Link>{" "}
        for at gemme timer pr. kunde og projekt.
      </p>
    ),
  },
  {
    question: "Hvad er forskellen på et stopur og TimeTrack?",
    text: "Et stopur måler tid. TimeTrack gør det samme, men gemmer timerne pr. kunde og projekt, laver rapporter og gør det lettere at fakturere.",
    answer: (
      <p>
        Et stopur måler tid. TimeTrack gør det samme, men gemmer timerne pr.
        kunde og projekt, laver rapporter og gør det lettere at fakturere.
      </p>
    ),
  },
  {
    question: "Virker stopuret på mobil?",
    text: "Ja. Stopuret virker i browseren på telefon, tablet og computer, og knapperne er store nok til at ramme med en finger.",
    answer: (
      <p>
        Ja. Stopuret virker i browseren på telefon, tablet og computer, og
        knapperne er store nok til at ramme med en finger.
      </p>
    ),
  },
];

export default function OnlineStopurPage() {
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
      href: "/klippekort",
      title: "Klippekort",
      description: "Sælg forudbetalte timer til dine kunder.",
    },
    {
      href: "/features",
      title: "Funktioner",
      description: "Se alle funktioner i TimeTrack.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Online stopur"
      subtitle="Start stopuret med et klik. Gratis og uden login: det virker med det samme."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Fra stopur til timeregistrering:"
      ctaTitle="Vil du gemme dine timer?"
      ctaSubtitle="Med TimeTrack gemmer du timer pr. kunde og projekt, får rapporter og kan bruge timerne som fakturagrundlag."
    >
      <section className={mk.section}>
        <div className={mk.wrap}>
          <ToolUsageTracker tool="online-stopur">
            <OnlineStopwatch />
          </ToolUsageTracker>
        </div>
      </section>

      <FeatureRows
        title="Fra stopur til timeregistrering"
        intro="Et stopur viser, hvor længe du har arbejdet. TimeTrack gemmer tiden, så du kan bruge den bagefter."
        items={[
          {
            title: "Tiden gemmes pr. kunde",
            text: "Start en timer, vælg kunde og projekt, og gem tiden, når du stopper.",
          },
          {
            title: "Historik pr. dag, uge og måned",
            text: "Se alle dine timer sorteret pr. dag, uge eller måned.",
          },
          {
            title: "Rapport og CSV",
            text: "Eksportér timer til CSV, lav rapporter pr. periode, og brug dem som fakturagrundlag.",
          },
        ]}
      />
    </SEOPageLayout>
  );
}
