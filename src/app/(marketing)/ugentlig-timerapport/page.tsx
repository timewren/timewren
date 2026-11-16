import { CalendarDays, Download, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { UgentligTimerapport } from "@/components/marketing/UgentligTimerapport";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Ugentlig timerapport: gratis timeseddel-skabelon",
  description:
    "Gratis ugentlig timerapport og timeseddel-skabelon. Indtast timer pr. dag og projekt, se totaler og print eller kopiér. Perfekt til freelancere.",
  alternates: { canonical: "/ugentlig-timerapport" },
  openGraph: {
    title: "Ugentlig timerapport: gratis timeseddel-skabelon",
    description:
      "Gratis ugentlig timerapport. Indtast timer pr. dag og projekt, se totaler og print eller kopiér.",
    url: "/ugentlig-timerapport",
    type: "website",
  },
};

export default function UgentligTimerapportPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Er denne timerapport gratis?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Timerapporten er helt gratis og kræver ingen login. Du kan udfylde, printe og kopiere med det samme.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg tilføje flere projekter?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Klik på 'Tilføj projekt' for at tilføje flere rækker. Du kan tilføje så mange projekter, som du har brug for.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan printer jeg timerapporten?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Klik på 'Print' knappen. Redigeringsfelterne skjules automatisk, og kun selve timerapporten printes. Du kan også vælge 'Gem som PDF' i printdialogen.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg gemme mine ugentlige timer automatisk?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Denne skabelon gemmer ikke data. Med TimeTrack registrerer du timer løbende og får automatiske ugerapporter pr. kunde og projekt.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Er denne timerapport gratis?",
      answer: (
        <p>
          Ja. Timerapporten er helt gratis og kræver ingen login. Du kan
          udfylde, printe og kopiere med det samme.
        </p>
      ),
    },
    {
      question: "Kan jeg tilføje flere projekter?",
      answer: (
        <p>
          Ja. Klik på &quot;Tilføj projekt&quot; for at tilføje flere rækker. Du
          kan tilføje så mange projekter, som du har brug for.
        </p>
      ),
    },
    {
      question: "Hvordan printer jeg timerapporten?",
      answer: (
        <p>
          Klik på &quot;Print&quot; knappen. Redigeringsfelterne skjules
          automatisk, og kun selve timerapporten printes. Du kan også vælge
          &quot;Gem som PDF&quot; i printdialogen.
        </p>
      ),
    },
    {
      question: "Kan jeg gemme mine ugentlige timer automatisk?",
      answer: (
        <p>
          Denne skabelon gemmer ikke data. Med{" "}
          <Link className="underline" href="/register">
            TimeTrack
          </Link>{" "}
          registrerer du timer løbende og får automatiske ugerapporter pr. kunde
          og projekt.
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/arbejdstimer-beregner",
      title: "Arbejdstimer-beregner",
      description: "Beregn timer mellem to tidspunkter.",
    },
    {
      href: "/online-stopur",
      title: "Online stopur",
      description: "Start et stopur med et klik.",
    },
    {
      href: "/faktura-skabelon",
      title: "Faktura-skabelon",
      description: "Gratis faktura-skabelon.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Ugentlig timerapport"
      subtitle="Gratis timeseddel-skabelon. Indtast timer pr. dag og projekt, se totaler og print. Ingen login."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Andre gratis værktøjer til timeregistrering:"
      ctaTitle="Automatiske ugerapporter"
      ctaSubtitle="Med TimeTrack genereres ugerapporter automatisk fra dine registrerede timer. Gratis at starte."
    >
      {/* Interactive timesheet */}
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <ToolUsageTracker tool="ugentlig-timerapport">
            <UgentligTimerapport />
          </ToolUsageTracker>
          <ToolLeadCapture tool="ugentlig-timerapport" />
        </div>
      </section>

      {/* USP cards */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">
              Fra manuel timeseddel til automatisk rapport
            </h2>
            <p className="text-lg text-slate-600">
              Spar tid med automatisk timeregistrering og ugerapporter i
              TimeTrack.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <CalendarDays className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Kalendervisning
              </h3>
              <p className="text-slate-600">
                Se dine timer i en kalender. Træk og slip tidsblokke, og få
                overblik over hele ugen med det samme.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Users className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Pr. kunde og projekt
              </h3>
              <p className="text-slate-600">
                Timeregistreringer kobles automatisk til kunder og projekter.
                Rapporter genereres pr. kunde med et klik.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Download className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Eksport til CSV/PDF
              </h3>
              <p className="text-slate-600">
                Eksportér ugerapporter til CSV eller PDF. Perfekt til kunder der
                vil se dokumentation for de timer, de betaler for.
              </p>
            </div>
          </div>

          {/* Upsell */}
          <div className="mt-14 rounded-2xl border border-brand-200/60 bg-brand-50/50 p-8 text-center">
            <h3 className="text-2xl font-bold text-slate-900">
              Automatiske timerapporter
            </h3>
            <p className="mt-2 text-slate-600">
              TimeTrack genererer ugentlige og månedlige rapporter automatisk
              fra dine timer.
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
