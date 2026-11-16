import { Check, Clock, FileText, Shield } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Timeforbrug pr. kunde (overblik)",
  description:
    "Få overblik over timeforbrug pr. kunde/projekt og periode. Brug tracking og rapporter til bedre priser, prioritering og fakturagrundlag. Gratis at starte.",
  alternates: { canonical: "/timeforbrug" },
};

export default function TimeforbrugPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Skal jeg tracke alt for at få et retvisende timeforbrug?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Start med at tracke det du fakturerer (billable) konsekvent. Du kan udvide med admin senere.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad er den bedste periode at kigge på?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Uge eller måned. Det vigtigste er at du gør det fast.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan bruger jeg det til fakturering?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Lav rapport pr. periode og brug eksporten som fakturagrundlag.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Skal jeg tracke alt for at få et retvisende timeforbrug?",
      answer: (
        <p>
          Du får mest værdi ved at registrere fakturerbart arbejde konsekvent,
          og gerne noget af admin. Start med det du fakturerer.
        </p>
      ),
    },
    {
      question: "Hvad er den bedste periode at kigge på?",
      answer: <p>Uge eller måned. Det vigtige er at du gør det fast.</p>,
    },
    {
      question: "Hvordan bruger jeg det til fakturering?",
      answer: (
        <p>
          Lav rapport pr. periode og brug eksporten. Se:{" "}
          <Link className="underline" href="/timeregistrering-til-faktura">
            timeregistrering til faktura
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
      description: "Få timerne ind.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Fra tid til faktura.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Dokumentation pr. periode.",
    },
    {
      href: "/timeseddel",
      title: "Timeseddel",
      description: "Rapport pr. periode.",
    },
    {
      href: "/timepris",
      title: "Timepris",
      description: "Når priser og tracking mødes.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Timeforbrug pr. kunde (overblik)"
      subtitle="Vil du vide hvor tiden faktisk går? Registrér tid pr. kunde/projekt og få et klart overblik over timeforbrug pr. periode, så du kan fakturere, prioritere og justere."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Se mønstre
              </h2>
              <p className="text-slate-600">
                Hvilke kunder sluger mest tid, og hvorfor?
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Rapport pr. periode
              </h2>
              <p className="text-slate-600">
                Uge/måned pr. kunde/projekt + eksport.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Shield className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Kontrol
              </h2>
              <p className="text-slate-600">Du bestemmer tracking-niveauet.</p>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h2 className="text-2xl font-bold text-slate-900">
              3 ting du kan bruge timeforbrug til
            </h2>
            <ul className="mt-4 space-y-3 text-slate-700">
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Justere priser (hvis du konsekvent undervurderer)</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>
                  Se hvor du taber tid (møder, småtasks, kontekstskift)
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Lave et tydeligt fakturagrundlag pr. periode</span>
              </li>
            </ul>

            <p className="mt-6 text-sm text-slate-600">
              Se også:{" "}
              <Link className="underline" href="/timepris">
                timepris
              </Link>
              .
            </p>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Start med 1 kunde og track en uge.
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
