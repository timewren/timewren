import type { Metadata } from "next";
import Link from "next/link";
import { ArbejdstimerBeregner } from "@/components/marketing/ArbejdstimerBeregner";
import { FeatureRows } from "@/components/marketing/FeatureRows";
import { MonthlyWorkHours } from "@/components/marketing/MonthlyWorkHours";
import { mk } from "@/components/marketing/mk";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { appLinkHref } from "@/lib/config";

export const metadata: Metadata = {
  title: "Arbejdstimer beregner med pause og nattevagt",
  description:
    "Indtast mødetid, sluttid og pause. Få arbejdstiden i timer og minutter eller decimaltimer. Beregn også vagter over midnat, gratis og uden login.",
  alternates: { canonical: "/arbejdstimer-beregner" },
  openGraph: {
    title: "Arbejdstimer beregner med pause og nattevagt",
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
      href: "/arbejdstimer-pr-maaned",
      title: "Arbejdstimer pr. måned",
      description: "Se månedens norm ved fuldtid og deltid med helligdage.",
    },
    {
      href: "/overarbejde-beregner",
      title: "Beregn overarbejde",
      description: "Sammenlign dine timer med den aftalte norm.",
    },
    {
      href: "/afrunding-af-timer",
      title: "Afrund timer til fakturaen",
      description: "Rund en registrering op til fx nærmeste kvarter.",
    },
  ];

  return (
    <SEOPageLayout
      title="Beregn arbejdstimer med pause"
      showHeroCta={false}
      subtitle="Beregn arbejdstimer mellem to tidspunkter med pausefradrag. Gratis og uden login."
      jsonLd={faqSchema}
      faqItems={FAQ}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Andre gratis værktøjer til timeregistrering:"
      ctaTitle="Lad timeren regne for dig"
      ctaSubtitle="Start en timer, så regner TimeTrack timerne ud for dig, med pauser trukket fra."
    >
      <section className="pb-12 sm:pb-16">
        <div className={mk.wrap}>
          <ToolUsageTracker tool="arbejdstimer-beregner">
            <ArbejdstimerBeregner />
          </ToolUsageTracker>
          <p className={`${mk.body} mt-4`}>
            Fra kl. 8 til 16 med 30 minutters pause arbejder du 7 timer og 30
            minutter (7,5 timer).
          </p>
          <p className={`${mk.fine} mt-2`}>
            Find månedens normtimer for{" "}
            <a href="#timer-2026" className={mk.link}>
              2026
            </a>{" "}
            eller{" "}
            <a href="#timer-2027" className={mk.link}>
              2027
            </a>
            .
          </p>
        </div>
      </section>

      <div className={`${mk.wrap} pb-12 sm:pb-16`}>
        <MonthlyWorkHours year={2026} />
        <MonthlyWorkHours year={2027} />
        <p className={`${mk.fine} mt-4 max-w-4xl`}>
          Normerne fordeler ugetimerne ligeligt på mandag til fredag og trækker
          helligdage på hverdage fra. * Grundlovsdag, juleaftensdag og
          nytårsaftensdag er med i normen, når de falder på en hverdag.
        </p>
      </div>

      <section className="pb-12 sm:pb-16">
        <div className={mk.wrap}>
          <p className={mk.body}>
            Skal tiden gemmes på en kunde eller opgave?{" "}
            <Link href={appLinkHref("/register")} className={mk.link}>
              Prøv timeren i TimeTrack
            </Link>
            .
          </p>
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
