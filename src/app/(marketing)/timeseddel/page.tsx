import { ArrowRight, Check, FileText, Shield, Timer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";

export const metadata: Metadata = {
  title: "Timeseddel til freelancere (uden regneark)",
  description:
    "Timeseddel til freelancere: få overblik over timer pr. kunde/projekt og periode og brug rapporten som fakturagrundlag. Start gratis med TimeTrack.",
  alternates: { canonical: "/timeseddel" },
};

export default function TimeseddelPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Er en timeseddel det samme som timeregistrering?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Timeregistrering er processen (at få timerne ind). Timesedlen er outputtet (overblik/rapport pr. periode).",
        },
      },
      {
        "@type": "Question",
        name: "Skal jeg bruge et regneark?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ikke nødvendigvis. Hvis du kan lave rapport pr. kunde/periode og eksportere til faktura, er du dækket.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad er den bedste næste side?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Se siden Timeregistrering til faktura for workflow fra timer til faktura.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Er en timeseddel det samme som timeregistrering?",
      answer: (
        <p>
          Timeregistrering er processen (at få timerne ind). Timesedlen er
          outputtet (overblik/rapport pr. periode).
        </p>
      ),
    },
    {
      question: "Skal jeg bruge et regneark?",
      answer: (
        <p>
          Ikke nødvendigvis. Hvis du kan lave rapport pr. kunde/periode og
          eksportere til faktura, er du dækket.
        </p>
      ),
    },
    {
      question: "Hvad er den bedste næste side?",
      answer: (
        <p>
          Se:{" "}
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
      description: "Prepaid timer med saldo.",
    },
    {
      href: "/features",
      title: "Features",
      description: "Overblik over systemet.",
    },
  ];

  return (
    <SEOPageLayout
      title="Timeseddel til freelancere (uden regneark)"
      subtitle="En timeseddel er i praksis bare et overblik over dine timer pr. kunde/projekt og periode. TimeTrack gør det nemt at registrere timerne løbende og bruge rapporten som fakturagrundlag."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Mere om timeregistrering og fakturagrundlag:"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Timer className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Timer løbende
              </h2>
              <p className="text-slate-600">
                Registrér tid mens du arbejder, ikke fredag kl. 16.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Rapport pr. periode
              </h2>
              <p className="text-slate-600">
                Uge/måned pr. kunde/projekt + eksport til faktura.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Shield className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Kontrol
              </h2>
              <p className="text-slate-600">
                Privatliv som standard: du bestemmer niveauet.
              </p>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Hvad skal en timeseddel indeholde?
            </h3>
            <ul className="mt-4 space-y-3 text-slate-700">
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Kunde og projekt</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Dato/periode</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Timer (evt. beskrivelse)</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Beløb (hvis du fakturerer pr. time)</span>
              </li>
            </ul>

            <p className="mt-6 text-sm text-slate-600">
              Hvis du vil gå direkte mod fakturering-intent, så se også{" "}
              <Link className="underline" href="/timeregistrering-til-faktura">
                timeregistrering til faktura
              </Link>
              .
            </p>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Opret 1 kunde og registrér tid en uge. Brug rapporten som din
              timeseddel og som fakturagrundlag.
            </p>
            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-8 py-4 font-semibold text-white hover:bg-brand-700"
            >
              Se priser
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
