import { Clock, FileText, Shield } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { SUBSCRIPTION_PRICE_MONTHLY } from "@/lib/config";

export const metadata: Metadata = {
  title: "Time tracking app (DK)",
  description:
    "Time tracking app (DK): dansk workflow med kunder/projekter, rapporter og eksport til fakturering. Start gratis med TimeTrack.",
  alternates: { canonical: "/time-tracking-app" },
};

export default function TimeTrackingAppPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Is this a mobile app?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "TimeTrack is web-based and works on mobile. The goal is low-friction time tracking with reports and exports.",
        },
      },
      {
        "@type": "Question",
        name: "What's the best Danish page to start with?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Start with the Timeregistrering page.",
        },
      },
      {
        "@type": "Question",
        name: "How do I turn tracked time into invoices?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "See Timeregistrering til faktura for the workflow.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Is this a mobile app?",
      answer: (
        <p>
          TimeTrack is web-based and works on mobile. The goal is low-friction
          time tracking with reports and exports.
        </p>
      ),
    },
    {
      question: "What's the best Danish page to start with?",
      answer: (
        <p>
          Start with{" "}
          <Link className="underline" href="/timeregistrering">
            timeregistrering
          </Link>
          .
        </p>
      ),
    },
    {
      question: "How do I turn tracked time into invoices?",
      answer: (
        <p>
          See{" "}
          <Link className="underline" href="/timeregistrering-til-faktura">
            timeregistrering til faktura
          </Link>{" "}
          for the workflow.
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Time tracking in Danish terms.",
    },
    {
      href: "/timetracking",
      title: "Timetracking",
      description: "Timetracking for freelancere.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "From time entries to invoices.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Invoice based on tracked hours.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: `Selvstændig: ${SUBSCRIPTION_PRICE_MONTHLY} DKK/month excl. VAT.`,
    },
    {
      href: "/features",
      title: "Features",
      description: "Overview of the product.",
    },
  ];

  return (
    <SEOPageLayout
      title="Time tracking app (DK)"
      subtitle="Mange søger på engelsk. TimeTrack er stadig lavet til Danmark: kunder, projekter, rapporter og eksport til fakturering."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedSubtitle="Danske sider der passer til din søgning:"
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
                Tracking der bliver brugt, også på travle dage.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Rapporter
              </h2>
              <p className="text-slate-600">
                Overblik pr. kunde/projekt/periode + eksport.
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
            <h3 className="text-2xl font-bold text-slate-900">Danske sider</h3>
            <ul className="mt-4 space-y-2 text-slate-700">
              <li>
                <Link className="underline" href="/timeregistrering">
                  Timeregistrering
                </Link>
              </li>
              <li>
                <Link className="underline" href="/timetracking">
                  Timetracking
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
            </ul>
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
