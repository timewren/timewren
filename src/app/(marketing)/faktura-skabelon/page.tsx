import { FileText, Receipt, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { FakturaSkabelon } from "@/components/marketing/FakturaSkabelon";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Lav en faktura gratis: dansk faktura-skabelon som PDF",
  description:
    "Lav en faktura gratis i browseren: udfyld firmaoplysninger og linjer med timer og pris, så regnes momsen ud. Gem som PDF eller print. Uden login.",
  alternates: { canonical: "/faktura-skabelon" },
  openGraph: {
    title: "Lav en faktura gratis: dansk faktura-skabelon som PDF | TimeTrack",
    description:
      "Gratis faktura-skabelon til freelancere. Udfyld, print eller gem som PDF. Dansk layout med automatisk momsberegning.",
    url: "/faktura-skabelon",
    type: "website",
  },
};

export default function FakturaSkabelonPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Er denne faktura-skabelon gratis?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Skabelonen er helt gratis og kræver ingen login. Du kan udfylde og printe/gemme som PDF med det samme.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad skal en dansk faktura indeholde?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "En dansk faktura skal indeholde: fakturanummer, fakturadato, afsenders CVR-nummer, kundens navn og adresse, beskrivelse af ydelsen, beløb ekskl. moms, momsbeløb (25%) og totalbeløb inkl. moms.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan gemmer jeg fakturaen som PDF?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Klik på 'Print / Gem som PDF'. I printdialogen kan du vælge 'Gem som PDF' som printer. Fakturaen formateres automatisk korrekt til print.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg lave fakturaer automatisk fra mine timer?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Med TimeTrack kan du tracke timer pr. kunde og projekt og lave fakturaer direkte fra dine timeregistreringer. Gratis at starte.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Er denne faktura-skabelon gratis?",
      answer: (
        <p>
          Ja. Skabelonen er helt gratis og kræver ingen login. Du kan udfylde og
          printe/gemme som PDF med det samme.
        </p>
      ),
    },
    {
      question: "Hvad skal en dansk faktura indeholde?",
      answer: (
        <p>
          En dansk faktura skal indeholde: fakturanummer, fakturadato, afsenders
          CVR-nummer, kundens navn og adresse, beskrivelse af ydelsen, beløb
          ekskl. moms, momsbeløb (25%) og totalbeløb inkl. moms.
        </p>
      ),
    },
    {
      question: "Hvordan gemmer jeg fakturaen som PDF?",
      answer: (
        <p>
          Klik på &quot;Print / Gem som PDF&quot;. I printdialogen kan du vælge
          &quot;Gem som PDF&quot; som printer. Fakturaen formateres automatisk
          korrekt til print.
        </p>
      ),
    },
    {
      question: "Kan jeg lave fakturaer automatisk fra mine timer?",
      answer: (
        <p>
          Med{" "}
          <Link className="underline" href="/register">
            TimeTrack
          </Link>{" "}
          kan du tracke timer pr. kunde og projekt og lave fakturaer direkte fra
          dine timeregistreringer. Gratis at starte.
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
      href: "/moms-beregner",
      title: "Moms-beregner",
      description: "Beregn moms (25%) hurtigt.",
    },
    {
      href: "/ugentlig-timerapport",
      title: "Ugentlig timerapport",
      description: "Gratis timeseddel-skabelon.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Gratis faktura-skabelon"
      subtitle="Udfyld, print eller gem som PDF. Dansk layout med automatisk momsberegning. Ingen login."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Andre gratis værktøjer til freelancere:"
      ctaTitle="Lav fakturaer direkte fra dine timer"
      ctaSubtitle="Med TimeTrack tracker du timer og laver fakturaer automatisk fra dine registreringer. Gratis at starte."
    >
      {/* Interactive invoice template */}
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="faktura-skabelon">
            <FakturaSkabelon />
          </ToolUsageTracker>
          <ToolLeadCapture tool="faktura-skabelon" />
        </div>
      </section>

      {/* USP cards */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">
              Fra skabelon til automatisk fakturering
            </h2>
            <p className="text-lg text-slate-600">
              Denne skabelon er et godt startpunkt. TimeTrack gør fakturering
              endnu nemmere.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Zap className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Auto-udfyldt fra timer
              </h3>
              <p className="text-slate-600">
                TimeTrack udfylder automatisk fakturalinjerne fra dine
                registrerede timer. Ingen manuelt copy-paste.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Receipt className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Bogføringsklar
              </h3>
              <p className="text-slate-600">
                Send fakturaer direkte til Billy eller Dinero, og få
                fakturagrundlaget til e-conomic. Alt matcher automatisk.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Professionelt design
              </h3>
              <p className="text-slate-600">
                Dine fakturaer får dit logo, farver og betalingsoplysninger. Ser
                professionelt ud overfor kunderne.
              </p>
            </div>
          </div>

          {/* Upsell */}
          <div className="mt-14 rounded-2xl border border-brand-200/60 bg-brand-50/50 p-8 text-center">
            <h3 className="text-2xl font-bold text-slate-900">
              Automatisér dine fakturaer
            </h3>
            <p className="mt-2 text-slate-600">
              Registrér timer, lav fakturaer og send dem til bogføring i ét
              system.
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
