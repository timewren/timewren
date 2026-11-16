import { Check, FileText, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Fakturagrundlag (tydelig specifikation)",
  description:
    "Få et tydeligt fakturagrundlag: timer pr. kunde/projekt og periode, rapport og eksport til faktura. Start gratis med TimeTrack.",
  alternates: { canonical: "/fakturagrundlag" },
};

export default function FakturagrundlagPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Skal fakturagrundlag være på opgaveniveau?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Det hjælper, men start simpelt: projekt + periode. Du kan gøre det mere detaljeret senere.",
        },
      },
      {
        "@type": "Question",
        name: "Hvilken side er bedst til fakturering?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Se siden Faktura ud fra timer.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg bruge Billy, Dinero eller e-conomic?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Billy, Dinero og e-conomic er live som integrationer. Du kan altid eksportere via CSV/rapport.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Skal fakturagrundlag være på opgaveniveau?",
      answer: (
        <p>
          Det hjælper. Men start simpelt: projekt + periode. Du kan altid gøre
          det mere detaljeret senere.
        </p>
      ),
    },
    {
      question: "Hvilken side er bedst til fakturering?",
      answer: (
        <p>
          Se{" "}
          <Link className="underline" href="/faktura-ud-fra-timer">
            faktura ud fra timer
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Kan jeg bruge Billy, Dinero eller e-conomic?",
      answer: (
        <p>
          Billy, Dinero og e-conomic er live som integrationer. Se{" "}
          <Link className="underline" href="/billy">
            Billy
          </Link>{" "}
          /{" "}
          <Link className="underline" href="/dinero">
            Dinero
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
      description: "Fra timer til faktura.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Dokumentation pr. periode.",
    },
    {
      href: "/timeseddel",
      title: "Timeseddel",
      description: "Overblik pr. periode.",
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
      title="Fakturagrundlag (så du kan fakturere med ro)"
      subtitle='Et godt fakturagrundlag er ikke "pæne ord". Det er et konkret overblik over timer pr. kunde/projekt og periode, som kunden kan forstå.'
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">
                Hvad består et fakturagrundlag af?
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Typisk: periode, kunde/projekt, timer (evt. beskrivelse) og sum.
                Jo lettere det er at forstå, jo færre spørgsmål får du.
              </p>

              <ul className="mt-6 space-y-4 text-slate-700">
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Timer pr. kunde/projekt</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Periode (uge/måned)</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Rapport/eksport til faktura</span>
                </li>
              </ul>

              <p className="mt-6 text-sm text-slate-600">
                Den mest direkte side:{" "}
                <Link
                  className="underline"
                  href="/timeregistrering-til-faktura"
                >
                  timeregistrering til faktura
                </Link>
                .
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
              <div className="flex items-start gap-3">
                <FileText className="mt-1 h-6 w-6 text-brand-600" />
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    Praktisk opskrift
                  </h3>
                  <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
                    <li>Track tid løbende</li>
                    <li>Lav rapport pr. periode</li>
                    <li>Kontrollér at intet mangler</li>
                    <li>Eksportér og send faktura</li>
                  </ol>

                  <div className="mt-8 rounded-2xl bg-white p-6">
                    <div className="flex items-start gap-3">
                      <Target className="mt-1 h-6 w-6 text-brand-600" />
                      <div>
                        <div className="font-semibold text-slate-900">Tip</div>
                        <p className="mt-1 text-slate-600">
                          Hvis du kun vil lave én rutine, så gør det ugentligt.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8">
                    <QuickSignupForm variant="hero" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
