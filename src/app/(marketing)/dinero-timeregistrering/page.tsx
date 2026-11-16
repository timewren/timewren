import { Check, FileText, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Timeregistrering til Dinero",
  description:
    "Timeregistrering til Dinero: track tid pr. kunde/projekt og få et fakturagrundlag du kan eksportere eller koble til Dinero. Start gratis med TimeTrack.",
  alternates: { canonical: "/dinero-timeregistrering" },
};

export default function DineroTimeregistreringPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Skal jeg bruge integrationen for at komme i gang?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nej. Start med rapport/CSV og koble Dinero på senere hvis du vil.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan får jeg et fakturagrundlag?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Track tid pr. kunde/projekt og lav rapport pr. periode. Eksportér og brug som specifikation.",
        },
      },
      {
        "@type": "Question",
        name: "Hvilken side skal jeg starte på?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Start på siden Timeregistrering.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Skal jeg bruge integrationen for at komme i gang?",
      answer: (
        <p>Nej. Start med rapport/CSV og koble Dinero på senere hvis du vil.</p>
      ),
    },
    {
      question: "Hvordan får jeg et fakturagrundlag?",
      answer: (
        <p>
          Track tid pr. kunde/projekt og lav rapport pr. periode. Eksportér og
          brug som specifikation.
        </p>
      ),
    },
    {
      question: "Hvilken side skal jeg starte på?",
      answer: (
        <p>
          Start på{" "}
          <Link className="underline" href="/timeregistrering">
            timeregistrering
          </Link>
          .
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/dinero",
      title: "TimeTrack + Dinero",
      description: "Integration og eksport til Dinero.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Gør timer til fakturagrundlag.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Track timer pr. kunde/projekt.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
    {
      href: "/features",
      title: "Features",
      description: "Overblik over systemet.",
    },
  ];

  return (
    <SEOPageLayout
      title="Timeregistrering til Dinero"
      subtitle="Track tid pr. kunde/projekt og få et fakturagrundlag der er nemt at eksportere eller koble til Dinero."
      badge={
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-brand-100 px-4 py-2 text-sm font-medium text-brand-800">
          <Zap className="h-4 w-4" />
          Dinero
        </div>
      }
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Dinero hænger typisk sammen med timeregistrering og fakturagrundlag:"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Fakturagrundlag
              </h2>
              <p className="text-slate-600">
                Få en klar specifikation pr. kunde og periode.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Check className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Eksport
              </h2>
              <p className="text-slate-600">
                CSV, PDF-rapport eller direkte eksport til Dinero.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Check className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Mindre friktion
              </h2>
              <p className="text-slate-600">
                Registrering, der faktisk sker, og ikke &quot;til sidst&quot;.
              </p>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Relaterede sider
            </h3>
            <ul className="mt-4 space-y-2 text-slate-700">
              <li>
                <Link className="underline" href="/dinero">
                  TimeTrack + Dinero
                </Link>
              </li>
              <li>
                <Link
                  className="underline"
                  href="/timeregistrering-til-faktura"
                >
                  Timeregistrering til faktura
                </Link>
              </li>
              <li>
                <Link className="underline" href="/timeregistrering">
                  Timeregistrering
                </Link>
              </li>
            </ul>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Opret en konto og test i en uge.
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
