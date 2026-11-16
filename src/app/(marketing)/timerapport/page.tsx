import { FileText, Shield, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Timerapport (rapport over timer)",
  description:
    "Timerapport til freelancere: lav rapport over timer pr. kunde/projekt og periode og brug den som specifikation til faktura. Start gratis med TimeTrack.",
  alternates: { canonical: "/timerapport" },
};

export default function TimerapportPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Skal rapporten være på opgaveniveau?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Det hjælper, men start simpelt. Du kan altid gøre rapporten mere detaljeret senere.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad hvis kunden har klippekort?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Du bruger stadig rapporten til overblik og dokumentation, men beløbet kommer fra saldo.",
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
      question: "Skal rapporten være på opgaveniveau?",
      answer: <p>Det hjælper, men start simpelt.</p>,
    },
    {
      question: "Hvad hvis kunden har klippekort?",
      answer: (
        <p>
          Så bruger du rapporten til overblik, men beløbet kommer fra saldo. Se:{" "}
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
      description: "Få timerne ind.",
    },
    {
      href: "/timeforbrug",
      title: "Timeforbrug",
      description: "Overblik pr. kunde.",
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
      title="Timerapport (rapport over timer)"
      subtitle="En timerapport gør fakturering lettere: den viser timer pr. kunde/projekt og periode, så specifikationen er klar."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Specifikation
              </h2>
              <p className="text-slate-600">
                Kunden kan se hvad der er leveret.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <TrendingUp className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Overblik
              </h2>
              <p className="text-slate-600">
                Se timeforbrug pr. kunde/projekt/periode.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Shield className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Kontrol
              </h2>
              <p className="text-slate-600">Du bestemmer detaljegraden.</p>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h2 className="text-2xl font-bold text-slate-900">
              Sådan bruger du en timerapport
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
              <li>Vælg periode (uge/måned)</li>
              <li>Filtrér på kunde/projekt</li>
              <li>Eksportér rapport/CSV</li>
              <li>Send faktura med rapport som bilag/specifikation</li>
            </ol>

            <p className="mt-6 text-sm text-slate-600">
              Se også:{" "}
              <Link className="underline" href="/timer-til-faktura">
                timer til faktura
              </Link>
              .
            </p>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Track en uge og lav din første rapport.
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
