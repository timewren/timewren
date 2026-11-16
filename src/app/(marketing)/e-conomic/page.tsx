import { Check, FileText, Shield, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE, PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "TimeTrack + e-conomic integration",
  description:
    "e-conomic-integration: forbind TimeTrack med din e-conomic-aftale og hent dine kunder. Registrér tid, og brug rapport eller CSV som fakturagrundlag. Prøv gratis.",
  alternates: { canonical: "/e-conomic" },
};

export default function EconomicPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvordan virker e-conomic-integrationen?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Du forbinder TimeTrack med din e-conomic-aftale og vælger, hvilke kunder du vil hente ind. Kunderne genkendes på CVR-nummer og kundenummer, så de ikke oprettes to gange. Timer og fakturagrundlag får du som rapport eller CSV.",
        },
      },
      {
        "@type": "Question",
        name: "Skal jeg bruge integrationen med det samme?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nej. Start med rapport og CSV-eksport, og forbind e-conomic, når du er klar.",
        },
      },
      {
        "@type": "Question",
        name: "Koster e-conomic-integrationen ekstra?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `Der er ikke et ekstra gebyr for integrationen. Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms. Du skal have et aktivt e-conomic-abonnement.`,
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg bruge TimeTrack med Billy eller Dinero i stedet?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. TimeTrack har integration med Billy, Dinero og e-conomic. Du vælger selv, hvilket regnskabssystem du bruger.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvordan virker e-conomic-integrationen?",
      answer: (
        <p>
          Du forbinder TimeTrack med din e-conomic-aftale og vælger, hvilke
          kunder du vil hente ind. Kunderne genkendes på CVR-nummer og
          kundenummer, så de ikke oprettes to gange. Timer og fakturagrundlag
          får du som rapport eller CSV.
        </p>
      ),
    },
    {
      question: "Skal jeg bruge integrationen med det samme?",
      answer: (
        <p>
          Nej. Start med rapport og CSV-eksport, og forbind e-conomic, når du er
          klar.
        </p>
      ),
    },
    {
      question: "Koster e-conomic-integrationen ekstra?",
      answer: (
        <p>
          Der er ikke et ekstra gebyr for integrationen. Selvstændig koster{" "}
          <Link className="underline" href="/pricing">
            {PLAN_PRICES.selvstaendig.price} ekskl. moms
          </Link>
          . Du skal have et aktivt e-conomic-abonnement.
        </p>
      ),
    },
    {
      question: "Kan jeg bruge TimeTrack med Billy eller Dinero i stedet?",
      answer: (
        <p>
          Ja. TimeTrack har integration med{" "}
          <Link className="underline" href="/billy">
            Billy
          </Link>
          ,{" "}
          <Link className="underline" href="/dinero">
            Dinero
          </Link>{" "}
          og e-conomic. Du vælger selv.
        </p>
      ),
    },
  ];

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
      href: "/billy",
      title: "Billy",
      description: "Integration med Billy regnskab.",
    },
    {
      href: "/dinero",
      title: "Dinero",
      description: "Integration med Dinero regnskab.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="TimeTrack + e-conomic"
      subtitle="Forbind TimeTrack med din e-conomic-aftale og hent dine kunder. Registrér tid pr. kunde og projekt, og brug rapport eller CSV som fakturagrundlag."
      badge={
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-brand-100 px-4 py-2 text-sm font-medium text-brand-800">
          <Zap className="h-4 w-4" />
          Integration
        </div>
      }
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="e-conomic hænger sammen med timeregistrering og fakturagrundlag:"
      ctaTitle="Forbind TimeTrack og e-conomic"
      ctaSubtitle="Registrér tid, lav rapport og forbind e-conomic. Gratis at starte."
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Fakturagrundlag klar
              </h2>
              <p className="text-slate-600">
                Timer pr. kunde og projekt giver dig et dokumenteret
                fakturagrundlag, du kan bruge i e-conomic.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Check className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Eksport og integration
              </h2>
              <p className="text-slate-600">
                Start med CSV-eksport, og forbind e-conomic, når du vil. Du
                bestemmer tempoet.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Shield className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Kontrol og sikkerhed
              </h2>
              <p className="text-slate-600">
                Du bestemmer, hvilke kunder der hentes fra e-conomic. Du kan
                afbryde forbindelsen igen under indstillinger.
              </p>
            </div>
          </div>

          {/* Setup steps */}
          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Sådan bruger du e-conomic med TimeTrack
            </h3>
            <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
              <li>Opret en TimeTrack-konto og forbind din e-conomic-aftale</li>
              <li>Hent de kunder, du vil bruge, fra e-conomic</li>
              <li>Registrér tid på opgaver og projekter</li>
              <li>Eksportér timer som CSV eller rapport til fakturagrundlag</li>
            </ol>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Klar til at forbinde?
            </h3>
            <p className="mt-2 text-slate-600">
              Start med at registrere tid i TimeTrack, og forbind e-conomic, når
              du er klar.
            </p>
            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Bruger du et andet regnskabssystem? Se{" "}
              <Link className="underline" href="/billy">
                Billy
              </Link>{" "}
              eller{" "}
              <Link className="underline" href="/dinero">
                Dinero
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
