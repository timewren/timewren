import { AlertTriangle, Clock, TrendingDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { HiddenCostCalculator } from "@/components/marketing/HiddenCostCalculator";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

export const metadata: Metadata = {
  title: "Ufaktureret tid-beregner: hvad koster glemte timer dig?",
  description:
    "Gratis beregner: se hvor mange kroner du taber om året på ufakturerede timer. De fleste freelancere glemmer 2-5 timer om ugen. Regn dit eget tal ud på 30 sekunder.",
  alternates: { canonical: "/ufaktureret-tid-beregner" },
  openGraph: {
    title: "Ufaktureret tid-beregner: hvad koster glemte timer dig?",
    description:
      "Se hvor mange kroner du taber om året på ufakturerede timer. Regn dit tal ud på 30 sekunder.",
    url: "/ufaktureret-tid-beregner",
    type: "website",
    images: [
      {
        url: "/api/og?badge=Gratis%20beregner&title=Hvad%20koster%20din%20ufakturerede%20tid%3F&subtitle=De%20fleste%20freelancere%20glemmer%202-5%20timer%20om%20ugen",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: [
      "/api/og?badge=Gratis%20beregner&title=Hvad%20koster%20din%20ufakturerede%20tid%3F&subtitle=De%20fleste%20freelancere%20glemmer%202-5%20timer%20om%20ugen",
    ],
  },
};

export default function UfaktureretTidBeregnerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvor meget tid glemmer freelancere typisk at fakturere?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Undersøgelser og erfaringer peger på 2-5 timer om ugen: hurtige mails, 'lige et opkald', småopgaver mellem projekter og tid der registreres bagudrettet efter hukommelsen. Ved en timepris på 800 kr er det 80.000-200.000 kr om året.",
        },
      },
      {
        "@type": "Question",
        name: "Hvorfor forsvinder timerne?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Fordi registreringen sker bagefter. Hukommelsen runder ned: 'det tog vel et kvarter'. Løsningen er at registrere mens du arbejder, med en timer der er ét klik væk.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan fanger jeg de små opgaver?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Gør registrering let: timer i browseren, hurtig manuel indtastning og faste kunde/projekt-valg. Småting er præcis dér man taber timer, så registrér dem også.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvor meget tid glemmer freelancere typisk?",
      answer: (
        <p>
          Typisk 2-5 timer om ugen: hurtige mails, "lige et opkald" og tid der
          registreres bagudrettet efter hukommelsen. Ved 800 kr/t er det
          80.000-200.000 kr om året.
        </p>
      ),
    },
    {
      question: "Hvorfor forsvinder timerne?",
      answer: (
        <p>
          Fordi registreringen sker bagefter, og hukommelsen runder ned.
          Løsningen er at registrere mens du arbejder. Se{" "}
          <Link className="underline" href="/timeregistrering">
            timeregistrering
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Hvordan fanger jeg de små opgaver?",
      answer: (
        <p>
          Gør registrering friktionsfri: timer ét klik væk i browseren og hurtig
          manuel indtastning. Småting er præcis dér man taber timer.
        </p>
      ),
    },
  ];

  return (
    <SEOPageLayout
      badge="Gratis værktøj"
      title="Hvad koster din ufakturerede tid?"
      subtitle="De fleste freelancere glemmer 2-5 timer om ugen. Regn ud hvad det koster dig om året og hvad du kan gøre ved det."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={[
        {
          href: "/timepris-beregner",
          title: "Timepris-beregner",
          description: "Find din rigtige timepris.",
        },
        {
          href: "/timeregistrering",
          title: "Timeregistrering",
          description: "Sådan fanger du timerne mens du arbejder.",
        },
        {
          href: "/blog/timeregistrering-freelancer-guide",
          title: "Guide: Timeregistrering for freelancere",
          description: "Kom i gang med konsistent registrering.",
        },
      ]}
      ctaTitle="Stop lækagen"
      ctaSubtitle="Registrér tid mens du arbejder. TimeTrack er gratis i 30 dage."
    >
      <section className="border-t bg-white px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <ToolUsageTracker tool="hidden-cost-calculator">
            <HiddenCostCalculator ctaHref="/register?ref=hidden-cost-calc-page" />
          </ToolUsageTracker>
          <ToolLeadCapture tool="hidden-cost-calculator" />
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Dér forsvinder timerne
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Småopgaverne
              </h3>
              <p className="text-slate-600">
                Mails, opkald og "lige en hurtig rettelse". Hver for sig er de
                små, men tilsammen er de dine tabte timer.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <TrendingDown className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Bagudrettet registrering
              </h3>
              <p className="text-slate-600">
                Skriver du timer ned fredag eftermiddag, runder hukommelsen ned.
                Altid.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <AlertTriangle className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Dårlig samvittighed
              </h3>
              <p className="text-slate-600">
                "Kan jeg nu også fakturere det her?" Med dokumentation pr.
                opgave er svaret ja, og kunden kan se hvorfor.
              </p>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
