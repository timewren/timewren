import { Check, FileText, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Timer til faktura (workflow)",
  description:
    "Workflow fra timer til faktura: track tid pr. kunde/projekt, lav rapport pr. periode og send faktura med tydelig specifikation. Gratis at starte.",
  alternates: { canonical: "/timer-til-faktura" },
};

export default function TimerTilFakturaPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Skal jeg skrive beskrivelser på alle timer?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Helst ja, men start simpelt. Det vigtigste er at kunden kan forstå hvad der er leveret.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad hvis kunden har prepaid/klippekort?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Du bruger samme tracking, men beløbet kommer fra saldo. Du bruger stadig rapport til overblik.",
        },
      },
      {
        "@type": "Question",
        name: "Hvor starter jeg?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Start på siden Timeregistrering.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Skal jeg skrive beskrivelser på alle timer?",
      answer: (
        <p>
          Helst ja, men start simpelt. Det vigtigste er at kunden kan forstå
          hvad der er leveret.
        </p>
      ),
    },
    {
      question: "Hvad hvis kunden har prepaid/klippekort?",
      answer: (
        <p>
          Så bruger du samme tracking, men beløbet kommer fra saldo. Se:{" "}
          <Link className="underline" href="/klippekort">
            klippekort
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Hvor starter jeg?",
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
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Timer pr. kunde og projekt.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Den direkte vej til faktura.",
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
      title="Timer til faktura (workflow)"
      subtitle="Hvis du fakturerer pr. time, er udfordringen sjældent din timepris. Det er at få timerne ind, samle dem pr. periode og sende en faktura med tydelig specifikation."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">
                Fra timer &rarr; rapport &rarr; faktura
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Når du gør det samme hver uge/måned, forsvinder den mentale
                modstand.
              </p>

              <ul className="mt-6 space-y-4 text-slate-700">
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Track tid pr. kunde og projekt</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Lav rapport pr. periode</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Eksportér og send faktura med specifikation</span>
                </li>
              </ul>

              <p className="mt-6 text-sm text-slate-600">
                Hvis du vil have den mest direkte side til det her, så se:
                <Link
                  className="underline"
                  href="/timeregistrering-til-faktura"
                >
                  {" "}
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
                    Mini-checkliste
                  </h3>
                  <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
                    <li>Vælg periode (uge/måned)</li>
                    <li>Kontrollér at timer er registreret</li>
                    <li>Generér rapport pr. kunde</li>
                    <li>Eksportér (CSV/rapport)</li>
                    <li>Send faktura</li>
                  </ol>
                </div>
              </div>

              <div className="mt-8 rounded-2xl bg-white p-6">
                <div className="flex items-start gap-3">
                  <Target className="mt-1 h-6 w-6 text-brand-600" />
                  <div>
                    <div className="font-semibold text-slate-900">Tip</div>
                    <p className="mt-1 text-slate-600">
                      Start småt: 1 kunde, 1 uge. Når rutinen sidder, skalerer
                      du.
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
      </section>
    </SEOPageLayout>
  );
}
