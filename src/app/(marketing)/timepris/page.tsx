import { Check, FileText, Shield, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { HiddenCostCalculator } from "@/components/marketing/HiddenCostCalculator";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

export const metadata: Metadata = {
  title: "Timepris for freelancere",
  description:
    "Timepris for freelancere: sådan hænger timepris, timeregistrering og fakturagrundlag sammen. Track timer konsistent og lav tydelig specifikation. Gratis at starte.",
  alternates: { canonical: "/timepris" },
};

export default function TimeprisPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Skal jeg registrere alt, også småting?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja, hvis det er en del af leverancen. Småting er ofte der man taber timer.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan gør jeg fakturaen lettere at forstå?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brug rapport/specifikation pr. periode. Det gør fakturaen tydelig.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad hvis kunden vil købe timer på forhånd?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brug klippekort/prepaid timer med saldo og historik.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Skal jeg registrere alt, også småting?",
      answer: (
        <p>
          Ja, hvis det er en del af leverancen. Småting er præcis der hvor man
          taber timer.
        </p>
      ),
    },
    {
      question: "Hvordan gør jeg fakturaen lettere at forstå?",
      answer: (
        <p>
          Brug rapport/specifikation pr. periode. Se:{" "}
          <Link className="underline" href="/faktura-ud-fra-timer">
            faktura ud fra timer
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Hvad hvis kunden vil købe timer på forhånd?",
      answer: (
        <p>
          Så er klippekort/prepaid et bedre match. Se:{" "}
          <Link className="underline" href="/klippekort">
            klippekort
          </Link>{" "}
          /{" "}
          <Link className="underline" href="/prepaid-timer">
            prepaid timer
          </Link>
          .
        </p>
      ),
    },
  ];

  return (
    <SEOPageLayout
      title="Timepris for freelancere (og hvad du skal tracke)"
      subtitle="Når du kender din timepris, er næste udfordring at få timerne registreret konsistent, så fakturaen bliver fair og dokumentationen er tydelig."
      jsonLd={faqSchema}
      faqItems={faqItems}
    >
      <ToolUsageTracker tool="hidden-cost-calculator">
        <HiddenCostCalculator ctaHref="/register?ref=hidden-cost-calc-timepris" />
      </ToolUsageTracker>
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <TrendingUp className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Timepris er kun halvdelen
              </h2>
              <p className="text-slate-600">
                Hvis du taber timer undervejs, hjælper en høj timepris ikke.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Dokumentation
              </h2>
              <p className="text-slate-600">
                Kunden betaler lettere, når specifikationen er klar.
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
              3 ting der gør din timepris "rigtig"
            </h2>
            <ul className="mt-4 space-y-3 text-slate-700">
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>
                  Du tracker alle billable timer (og helst også noget af admin)
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Du kan rapportere pr. kunde/projekt/periode</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Du kan eksportere og bruge det som fakturagrundlag</span>
              </li>
            </ul>

            <p className="mt-6 text-sm text-slate-600">
              Start her:{" "}
              <Link className="underline" href="/timeregistrering">
                timeregistrering
              </Link>
              . Når du vil helt i mål:{" "}
              <Link className="underline" href="/timeregistrering-til-faktura">
                timeregistrering til faktura
              </Link>
              .
            </p>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Opret 1 kunde, sæt din timepris, track en uge, og brug rapporten
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
