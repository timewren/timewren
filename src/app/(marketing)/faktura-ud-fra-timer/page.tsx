import { Check, FileText, Shield } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Faktura ud fra timer",
  description:
    "Lav faktura ud fra timer med tydelig specifikation: saml timer pr. kunde og periode, lav rapport og eksportér. Start gratis med TimeTrack.",
  alternates: { canonical: "/faktura-ud-fra-timer" },
};

export default function FakturaUdFraTimerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvordan får jeg en specifikation kunden forstår?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Hold timer pr. kunde/projekt og brug rapport pr. periode, så kunden kan se hvad der er leveret.",
        },
      },
      {
        "@type": "Question",
        name: "Skal jeg tracke ned på opgaveniveau?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Det hjælper, men du kan starte simpelt. Det vigtige er at du kan forklare timerne uden at bruge meget tid.",
        },
      },
      {
        "@type": "Question",
        name: "Hvilken side skal jeg læse først?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Start med timeregistrering og gå derefter til timeregistrering til faktura for workflow.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvordan får jeg en specifikation kunden forstår?",
      answer: <p>Hold timer pr. kunde/projekt og brug rapport pr. periode.</p>,
    },
    {
      question: "Skal jeg tracke ned på opgaveniveau?",
      answer: (
        <p>
          Helst ja, men du kan starte simpelt. Det vigtige er at du kan forklare
          timerne uden at bruge en time på det.
        </p>
      ),
    },
    {
      question: "Hvilken side skal jeg læse først?",
      answer: (
        <p>
          Start med{" "}
          <Link className="underline" href="/timeregistrering">
            timeregistrering
          </Link>{" "}
          og gå derefter til{" "}
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
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Workflow: tid \u2192 specifikation \u2192 faktura.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Hold styr på timer pr. kunde/projekt.",
    },
    {
      href: "/tidsregistrering",
      title: "Tidsregistrering",
      description: "Dokumentation som vane.",
    },
    {
      href: "/billy",
      title: "Billy",
      description: "Eksport/flow til Billy.",
    },
    {
      href: "/dinero",
      title: "Dinero",
      description: "Eksport/flow til Dinero.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Faktura ud fra timer"
      subtitle="Saml timer pr. kunde og periode, få en klar specifikation og send en faktura med ro i maven."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedSubtitle="Relateret til fakturering og timeregistrering:"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">
                Det handler om dokumentation
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Når du fakturerer timer, er det vigtigste at du kan vise hvad
                der er lavet, uden at det tager en time at samle.
              </p>

              <ul className="mt-6 space-y-4 text-slate-700">
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Specifikation pr. kunde/projekt</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Beløb ud fra dine timepriser</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Eksport til regnskab (Billy) eller CSV</span>
                </li>
              </ul>

              <p className="mt-6 text-sm text-slate-600">
                Se også:{" "}
                <Link className="underline" href="/timeregistrering">
                  timeregistrering
                </Link>{" "}
                og{" "}
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
                    Hvad du får
                  </h3>
                  <p className="mt-2 text-slate-600">
                    Et konkret overblik du kan bruge direkte når du skal sende
                    en faktura.
                  </p>
                  <div className="mt-6 space-y-3 text-slate-700">
                    <div className="rounded-2xl bg-white p-4">
                      <div className="text-sm font-semibold text-slate-900">
                        Uge/måneds-rapport
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        Timer + beløb pr. kunde
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <div className="text-sm font-semibold text-slate-900">
                        Eksport
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        CSV/rapport eller integration
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <div className="text-sm font-semibold text-slate-900">
                        Mindre friktion
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        Tracking der rent faktisk sker
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 rounded-2xl bg-white p-6">
                    <div className="flex items-start gap-3">
                      <Shield className="mt-1 h-6 w-6 text-brand-600" />
                      <div>
                        <div className="font-semibold text-slate-900">
                          Privatliv &amp; kontrol
                        </div>
                        <p className="mt-1 text-slate-600">
                          Du bestemmer hvad der trackes.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8">
                    <QuickSignupForm variant="hero" />
                    <p className="mt-4 text-sm text-slate-500">
                      Eller{" "}
                      <Link className="underline" href="/login">
                        log ind
                      </Link>{" "}
                      hvis du allerede har en konto.
                    </p>
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
