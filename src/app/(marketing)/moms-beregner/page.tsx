import { BadgePercent, BookOpen, Receipt } from "lucide-react";
import type { Metadata } from "next";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { MomsBeregner } from "@/components/marketing/MomsBeregner";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Momsberegner: træk moms fra eller læg moms til et beløb",
  description:
    "Træk moms fra et beløb, eller læg 25 % moms til. Beløb inkl. moms delt med 1,25 giver beløbet uden moms. Gratis momsberegner med forklaring og eksempler.",
  alternates: { canonical: "/moms-beregner" },
  openGraph: {
    title: "Momsberegner: træk moms fra eller læg moms til et beløb",
    description:
      "Gratis moms-beregner. Beregn dansk moms (25%) hurtigt fra beløb ekskl. eller inkl. moms.",
    url: "/moms-beregner",
    type: "website",
  },
};

export default function MomsBeregnerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvordan trækker man moms fra et beløb?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Del beløbet inkl. moms med 1,25. Så får du beløbet uden moms. Eksempel: 1.250 kr inkl. moms / 1,25 = 1.000 kr, og momsen er 250 kr. Momsen udgør altså 20 % af et beløb inkl. moms, ikke 25 %.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan beregner jeg moms?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "For at beregne moms fra et beløb ekskl. moms: gang med 0,25 (25%). For at finde moms i et beløb inkl. moms: divider med 1,25 og træk fra totalen. Denne beregner gør det automatisk.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad er momssatsen i Danmark?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Den danske momssats er 25%. Det gælder for de fleste varer og tjenesteydelser. Enkelte undtagelser findes, f.eks. aviser og personbefordring.",
        },
      },
      {
        "@type": "Question",
        name: "Hvornår skal man momsregistreres?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Du skal momsregistreres når din årlige omsætning overstiger 50.000 kr. Momsregistreringen sker hos Erhvervsstyrelsen via Virk.dk.",
        },
      },
      {
        "@type": "Question",
        name: "Hvor tit skal moms afregnes?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "De fleste virksomheder afregner moms kvartalsvis. Store virksomheder (omsætning over 50 mio. kr.) afregner månedligt, og små virksomheder (under 5 mio. kr.) kan vælge halvårligt.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvordan trækker man moms fra et beløb?",
      answer: (
        <p>
          Del beløbet inkl. moms med 1,25. Så får du beløbet uden moms.
          Eksempel: 1.250 kr inkl. moms / 1,25 = 1.000 kr, og momsen er 250 kr.
          Momsen udgør altså 20 % af et beløb inkl. moms, ikke 25 %.
        </p>
      ),
    },
    {
      question: "Hvordan beregner jeg moms?",
      answer: (
        <p>
          For at beregne moms fra et beløb ekskl. moms: gang med 0,25 (25%). For
          at finde moms i et beløb inkl. moms: divider med 1,25 og træk fra
          totalen. Denne beregner gør det automatisk.
        </p>
      ),
    },
    {
      question: "Hvad er momssatsen i Danmark?",
      answer: (
        <p>
          Den danske momssats er 25%. Det gælder for de fleste varer og
          tjenesteydelser. Enkelte undtagelser findes, f.eks. aviser og
          personbefordring.
        </p>
      ),
    },
    {
      question: "Hvornår skal man momsregistreres?",
      answer: (
        <p>
          Du skal momsregistreres når din årlige omsætning overstiger 50.000 kr.
          Momsregistreringen sker hos Erhvervsstyrelsen via Virk.dk.
        </p>
      ),
    },
    {
      question: "Hvor tit skal moms afregnes?",
      answer: (
        <p>
          De fleste virksomheder afregner moms kvartalsvis. Store virksomheder
          (omsætning over 50 mio. kr.) afregner månedligt, og små virksomheder
          (under 5 mio. kr.) kan vælge halvårligt.
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/timepris-beregner",
      title: "Timepris-beregner",
      description: "Beregn din freelance timepris.",
    },
    {
      href: "/faktura-skabelon",
      title: "Faktura-skabelon",
      description: "Gratis faktura-skabelon med moms.",
    },
    {
      href: "/arbejdstimer-beregner",
      title: "Arbejdstimer-beregner",
      description: "Beregn timer mellem to tidspunkter.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Moms-beregner"
      subtitle="Beregn dansk moms (25%) hurtigt. Indtast beløb ekskl. eller inkl. moms. Gratis og uden login."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Andre gratis værktøjer til freelancere:"
      ctaTitle="Automatisk momsberegning på dine fakturaer"
      ctaSubtitle="Med TimeTrack beregnes moms automatisk på alle dine fakturaer og klippekort. Gratis at starte."
    >
      {/* Interactive calculator */}
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="moms-beregner">
            <MomsBeregner />
          </ToolUsageTracker>
          <ToolLeadCapture tool="moms-beregner" />
        </div>
      </section>

      {/* USP cards */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">
              Moms der passer sig selv
            </h2>
            <p className="text-lg text-slate-600">
              I TimeTrack beregnes moms automatisk på alle fakturaer og
              klippekort.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <BadgePercent className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Automatisk 25% moms
              </h3>
              <p className="text-slate-600">
                Timepriser og klippekort kan sættes ekskl. moms. TimeTrack
                beregner automatisk moms på alle fakturaer.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Receipt className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Bogføringsintegration
              </h3>
              <p className="text-slate-600">
                Send fakturaer med korrekt moms direkte til Billy eller Dinero,
                og få fakturagrundlaget til e-conomic. Alt matcher automatisk.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <BookOpen className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Momsrapporter
              </h3>
              <p className="text-slate-600">
                Se omsætning ekskl. og inkl. moms i rapporterne. Gør det nemt at
                forberede momsafregning til Skattestyrelsen.
              </p>
            </div>
          </div>

          {/* Upsell */}
          <div className="mt-14 rounded-2xl border border-brand-200/60 bg-brand-50/50 p-8 text-center">
            <h3 className="text-2xl font-bold text-slate-900">
              Moms der beregnes automatisk
            </h3>
            <p className="mt-2 text-slate-600">
              TimeTrack håndterer moms på alle dine fakturaer og klippekort.
              Ingen hovedregning.
            </p>
            <div className="mx-auto mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
