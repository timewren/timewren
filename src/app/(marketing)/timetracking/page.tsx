import { Check, Clock, FileText, Shield } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";

export const metadata: Metadata = {
  title: "Timetracking for freelancere",
  description:
    "Timetracking til freelancere: fang timerne, lav rapport pr. kunde/periode og eksportér til faktura. Start gratis med TimeTrack.",
  alternates: { canonical: "/timetracking" },
};

export default function TimetrackingPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad er forskellen på timetracking og timeregistrering?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Det er i praksis samme disciplin. Timetracking bruges ofte om værktøjet, mens timeregistrering er den danske betegnelse.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad er den hurtigste måde at komme i gang?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Opret 1 kunde, track en uge, og brug rapporten som fakturagrundlag.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan laver jeg en faktura ud fra timer?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Se siden Faktura ud fra timer.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad er forskellen på timetracking og timeregistrering?",
      answer: (
        <p>
          Det er i praksis samme disciplin. &quot;Timetracking&quot; bruges ofte
          om værktøjet, mens &quot;timeregistrering&quot; er den danske
          betegnelse.
        </p>
      ),
    },
    {
      question: "Hvad er den hurtigste måde at komme i gang?",
      answer: (
        <p>
          Opret 1 kunde, track en uge, og brug rapporten som fakturagrundlag.
        </p>
      ),
    },
    {
      question: "Hvordan laver jeg en faktura ud fra timer?",
      answer: (
        <p>
          Se:{" "}
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
      href: "/time-tracking",
      title: "Time tracking",
      description: "Engelsk søgning, dansk løsning.",
    },
    {
      href: "/features",
      title: "Features",
      description: "Overblik over systemet.",
    },
  ];

  return (
    <SEOPageLayout
      title="Timetracking for freelancere"
      subtitle="Timetracking der hjælper dig med at fange timerne, dokumentere arbejdet og fakturere mere præcist."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedSubtitle="Flere indgange til samme tema (timetracking \u2192 fakturagrundlag):"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Fang timerne
              </h2>
              <p className="text-slate-600">
                Timer og manuelle registreringer, så du ikke taber tid.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Rapport
              </h2>
              <p className="text-slate-600">
                Overblik pr. kunde/projekt/periode og eksport.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Shield className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Kontrol
              </h2>
              <p className="text-slate-600">
                Privatliv som standard. Du bestemmer niveauet.
              </p>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">Relateret</h3>
            <ul className="mt-4 space-y-3 text-slate-700">
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>
                  <Link className="underline" href="/timeregistrering">
                    Timeregistrering
                  </Link>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>
                  <Link
                    className="underline"
                    href="/timeregistrering-til-faktura"
                  >
                    Timeregistrering til faktura
                  </Link>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>
                  <Link className="underline" href="/tidsregistrering">
                    Tidsregistrering
                  </Link>{" "}
                  (synonym-angle)
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Track en uge og brug rapporten til faktura.
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
