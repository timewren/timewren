import { Check, FileText, Shield, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Billy timeregistrering (TimeTrack + Billy)",
  description:
    "Timeregistrering til Billy: track tid pr. kunde/projekt og brug rapport/eksport eller integration til Billy. Start gratis med TimeTrack.",
  openGraph: {
    title: "Billy timeregistrering (TimeTrack + Billy)",
    description:
      "Timeregistrering til Billy: track tid pr. kunde/projekt og brug rapport/eksport eller integration til Billy. Start gratis med TimeTrack.",
  },
  alternates: { canonical: "/billy" },
};

export default function BillyPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Skal jeg bruge integrationen for at komme i gang?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nej. Start med rapport/CSV og brug integration når du er klar.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad er det typiske flow?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Track tid pr. kunde/projekt, lav rapport pr. periode og fakturér.",
        },
      },
      {
        "@type": "Question",
        name: "Hvor starter jeg hvis jeg er ny?",
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
        <p>Nej. Start med rapport/CSV og brug integration når du er klar.</p>
      ),
    },
    {
      question: "Hvad er det typiske flow?",
      answer: (
        <p>
          Track tid pr. kunde/projekt &rarr; lav rapport pr. periode &rarr;
          fakturér.
        </p>
      ),
    },
    {
      question: "Hvor starter jeg hvis jeg er ny?",
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
      description: "Track timer pr. kunde/projekt.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Gør timer til fakturagrundlag.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Dokumentation pr. periode.",
    },
    {
      href: "/dinero",
      title: "Dinero",
      description: "Alternativt regnskabs-flow.",
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
      title="TimeTrack + Billy"
      subtitle="Registrér tid på dine kunder, og gør faktureringen lettere med eksport og integration til Billy."
      badge={
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-brand-100 px-4 py-2 text-sm font-medium text-brand-800">
          <Zap className="h-4 w-4" />
          Integration
        </div>
      }
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Billy hænger typisk sammen med timeregistrering og fakturagrundlag:"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Fakturagrundlag uden bøvl
              </h2>
              <p className="text-slate-600">
                Saml timer pr. kunde og få et overblik der er nemt at fakturere
                ud fra.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Check className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Eksport & integration
              </h2>
              <p className="text-slate-600">
                Eksportér data og brug Billy-integration når du vil gøre det
                endnu mere gnidningsfrit.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Shield className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Kontrol over dine data
              </h2>
              <p className="text-slate-600">
                Du bestemmer hvad der trackes og hvordan det bruges.
              </p>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Klar til at prøve?
            </h3>
            <p className="mt-2 text-slate-600">
              TimeTrack er bygget til solo-freelancere. Start småt: track tid i
              en uge og brug rapporten til at gøre din fakturering mere præcis.
            </p>
            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Har du spørgsmål? Se{" "}
              <Link className="underline" href="/contact">
                kontakt
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
