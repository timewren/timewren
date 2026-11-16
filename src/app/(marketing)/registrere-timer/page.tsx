import { Clock, FileText, Shield } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Registrere timer (så du ikke taber dem)",
  description:
    "Sådan registrerer du timer som freelancer: track tid pr. kunde/projekt, lav rapport pr. periode og brug det som fakturagrundlag. Start gratis med TimeTrack.",
  alternates: { canonical: "/registrere-timer" },
};

export default function RegistrereTimerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Skal jeg registrere timer hver dag?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Helst ja, men start med en ugentlig rutine hvis det er det du kan holde.",
        },
      },
      {
        "@type": "Question",
        name: "Timer vs manuel registrering?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brug timer når du kan, og manuel registrering når du skal.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad er næste step efter jeg har registreret timerne?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Lav rapport pr. periode og brug den som fakturagrundlag.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Skal jeg registrere timer hver dag?",
      answer: (
        <p>
          Helst ja, det er der konsistensen kommer fra. Men start med en
          ugentlig rutine hvis det er det du kan holde.
        </p>
      ),
    },
    {
      question: "Timer vs manuel registrering?",
      answer: <p>Brug timer når du kan, og manuel registrering når du skal.</p>,
    },
    {
      question: "Hvad er næste step efter jeg har registreret timerne?",
      answer: (
        <p>
          Lav rapport pr. periode og brug den som fakturagrundlag. Se:{" "}
          <Link className="underline" href="/faktura-ud-fra-timer">
            faktura ud fra timer
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
      href: "/timeseddel",
      title: "Timeseddel",
      description: "Overblik over timer pr. periode.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Registrere timer (så du ikke taber dem)"
      subtitle="Den bedste timeregistrering er den, du rent faktisk får gjort. TimeTrack hjælper dig med at registrere timer pr. kunde/projekt og lave et fakturagrundlag der er tydeligt."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedSubtitle="Hvis du vil dykke mere ned i emnet:"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Lav friktion
              </h2>
              <p className="text-slate-600">
                Timer og manuel registrering, så du altid kan få det gjort.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Rapport
              </h2>
              <p className="text-slate-600">
                Overblik pr. kunde/projekt/periode og eksport til faktura.
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
              En simpel vane der virker
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
              <li>Vælg kunde/projekt før du starter</li>
              <li>Start en timer (eller noter manuelt)</li>
              <li>Stop timeren når du skifter kontekst</li>
              <li>Lav rapport ugentligt og brug den til faktura</li>
            </ol>

            <p className="mt-6 text-sm text-slate-600">
              Næste step:{" "}
              <Link className="underline" href="/timeregistrering-til-faktura">
                timeregistrering til faktura
              </Link>
              .
            </p>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">Opret konto og test i en uge.</p>
            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
