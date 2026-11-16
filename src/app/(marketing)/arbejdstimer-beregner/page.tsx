import type { Metadata } from "next";
import { ArbejdstimerBeregner } from "@/components/marketing/ArbejdstimerBeregner";
import { FeatureRows } from "@/components/marketing/FeatureRows";
import { mk } from "@/components/marketing/mk";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Beregn arbejdstimer: gratis beregner med pauser",
  description:
    "Beregn arbejdstimer mellem to tidspunkter og træk pausen fra. Se timer pr. dag, uge og måned, som decimaltal, og hvad du tjener. Gratis og uden login.",
  alternates: { canonical: "/arbejdstimer-beregner" },
  openGraph: {
    title: "Beregn arbejdstimer: gratis beregner med pauser",
    description:
      "Gratis arbejdstimer-beregner. Beregn timer med pausefradrag og se daglig, ugentlig og månedlig tid.",
    url: "/arbejdstimer-beregner",
    type: "website",
  },
};

const FAQ = [
  {
    question: "Hvordan beregner jeg arbejdstimer?",
    answer:
      "Indtast start- og sluttid, og træk eventuel pause fra. Beregneren viser automatisk antal timer som decimaltal og i formatet timer:minutter.",
  },
  {
    question: "Hvad er forskellen på brutto- og nettotimer?",
    answer:
      "Bruttotimer er den samlede tid fra start til slut. Nettotimer er efter fradrag af pauser. Det er nettotimerne, der typisk faktureres.",
  },
  {
    question: "Hvordan omregner jeg timer til decimal?",
    answer:
      "Divider minutter med 60. Fx giver 7 timer og 30 minutter 7,50 timer som decimaltal. Beregneren gør det automatisk.",
  },
  {
    question: "Virker beregneren for natarbejde?",
    answer:
      "Ja. Hvis sluttiden er tidligere end starttiden (fx 22:00 til 06:00), beregnes det som natarbejde hen over midnat.",
  },
];

export default function ArbejdstimerBeregnerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  const relatedLinks = [
    {
      href: "/online-stopur",
      title: "Online stopur",
      description: "Start et stopur med et klik.",
    },
    {
      href: "/ugentlig-timerapport",
      title: "Ugentlig timerapport",
      description: "Gratis timeseddel-skabelon.",
    },
    {
      href: "/timepris-beregner",
      title: "Timepris-beregner",
      description: "Beregn din freelance timepris.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Arbejdstimer-beregner"
      subtitle="Beregn arbejdstimer mellem to tidspunkter med pausefradrag. Gratis og uden login."
      jsonLd={faqSchema}
      faqItems={FAQ}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Andre gratis værktøjer til timeregistrering:"
      ctaTitle="Lad timeren regne for dig"
      ctaSubtitle="Start en timer, så regner TimeTrack timerne ud for dig, med pauser trukket fra."
    >
      <section className={mk.section}>
        <div className={mk.wrap}>
          <ToolUsageTracker tool="arbejdstimer-beregner">
            <ArbejdstimerBeregner />
          </ToolUsageTracker>
          <ToolLeadCapture tool="arbejdstimer-beregner" />
        </div>
      </section>

      <FeatureRows
        title="Når du slipper for at regne selv"
        intro="TimeTrack registrerer timerne, mens du arbejder, så du ikke skal regne dem ud bagefter."
        items={[
          {
            title: "Timer med pause",
            text: "Start en timer, sæt den på pause, og stop den, når du er færdig. Pausen tæller ikke med i timerne.",
          },
          {
            title: "Rapport pr. uge og måned",
            text: "Se timerne samlet pr. uge, måned eller projekt, og hent dem som CSV.",
          },
          {
            title: "Fakturagrundlag pr. kunde",
            text: "Timerne kan bruges som fakturagrundlag, så du ikke skal samle dem bagefter.",
          },
        ]}
      />
    </SEOPageLayout>
  );
}
