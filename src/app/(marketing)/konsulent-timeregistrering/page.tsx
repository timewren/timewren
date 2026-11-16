import { Check, Clock, FileText, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";

export const metadata: Metadata = {
  title: "Timeregistrering for konsulenter",
  description:
    "Timeregistrering for konsulenter: track tid pr. kunde/projekt, lav rapport pr. periode og få tydelig specifikation til faktura. Gratis at starte.",
  alternates: { canonical: "/konsulent-timeregistrering" },
};

export default function KonsulentTimeregistreringPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Skal jeg tracke pr. kunde eller pr. projekt?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Begge dele hvis muligt: kunde \u2192 projekt \u2192 opgaver. Det giver den bedste rapport/specifikation.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan undgår jeg at glemme timer?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brug timeren, når du kan, og skriv manuelt ind, når du skal. Lav desuden en fast ugentlig gennemgang.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad hvis kunden vil have faste pakker?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brug klippekort/prepaid timer med saldo og historik.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Skal jeg tracke pr. kunde eller pr. projekt?",
      answer: (
        <p>
          Begge dele hvis muligt: kunde &rarr; projekt &rarr; opgaver. Det giver
          den bedste rapport/specifikation.
        </p>
      ),
    },
    {
      question: "Hvordan undgår jeg at glemme timer?",
      answer: (
        <p>
          Brug timeren, når du kan, og skriv manuelt ind, når du skal. Lav
          desuden en fast ugentlig gennemgang.
        </p>
      ),
    },
    {
      question: "Hvad hvis kunden vil have faste pakker?",
      answer: (
        <p>
          Brug klippekort/prepaid. Se:{" "}
          <Link className="underline" href="/klippekort">
            klippekort
          </Link>
          .
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Timer pr. kunde og projekt.",
    },
    {
      href: "/tidsregistrering",
      title: "Tidsregistrering",
      description: "Arbejdstid og lovkravet om registrering.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Fra timer til faktura.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Specifikation pr. periode.",
    },
    {
      href: "/klippekort",
      title: "Klippekort",
      description: "Prepaid timer uden regneark.",
    },
    {
      href: "/timeseddel",
      title: "Timeseddel",
      description: "Overblik pr. periode.",
    },
  ];

  return (
    <SEOPageLayout
      title="Timeregistrering for konsulenter"
      subtitle="Som konsulent er timeregistrering ikke bare administration. Det er grundlaget for en fair faktura og færre spørgsmål fra kunden."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedSubtitle="Mere om timeregistrering og fakturering:"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Users className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Kunde-fokus
              </h2>
              <p className="text-slate-600">
                Track tid pr. kunde/projekt og undgå blanding.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Konsistens
              </h2>
              <p className="text-slate-600">
                Timer og manuel registrering, så det bliver gjort.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Specifikation
              </h2>
              <p className="text-slate-600">
                Rapport pr. periode og eksport til faktura.
              </p>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h2 className="text-2xl font-bold text-slate-900">
              Typiske konsulent-scenarier
            </h2>
            <ul className="mt-4 space-y-3 text-slate-700">
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Del-leverancer på samme projekt (mange små opgaver)</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>
                  Flere kunder på samme uge &rarr; behov for klar rapportering
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Prepaid/klippekort for løbende rådgivning</span>
              </li>
            </ul>

            <p className="mt-6 text-sm text-slate-600">
              Se også:{" "}
              <Link className="underline" href="/klippekort">
                klippekort
              </Link>{" "}
              /{" "}
              <Link className="underline" href="/prepaid-timer">
                prepaid timer
              </Link>
              .
            </p>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Opret dine 1-2 vigtigste kunder, track en uge, og brug rapporten
              som fakturagrundlag.
            </p>
            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
