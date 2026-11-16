import { Check, Clock, FileText, Shield } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { SUBSCRIPTION_PRICE_MONTHLY } from "@/lib/config";

export const metadata: Metadata = {
  title: "Time tracking i Danmark",
  description:
    "Time tracking i Danmark: track tid pr. kunde/projekt, lav rapport pr. periode og gør fakturering lettere. Dansk workflow til freelancere. Gratis at starte.",
  alternates: { canonical: "/time-tracking" },
};

export default function TimeTrackingPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Is this only for Denmark?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The product is Danish-first, but the workflow is universal: track time, create a clear report, invoice.",
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
        name: "How do I get from time entries to invoices?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "See Timeregistrering til faktura.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Is this only for Denmark?",
      answer: (
        <p>
          The product is Danish-first, but the workflow is universal: track time
          &rarr; create a clear report &rarr; invoice.
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
      question: "How do I get from time entries to invoices?",
      answer: (
        <p>
          See{" "}
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
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Time tracking in Danish terms.",
    },
    {
      href: "/tidsregistrering",
      title: "Tidsregistrering",
      description: "Documentation and overview.",
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
      title="Time tracking (timetracking) i Danmark"
      subtitle="Mange søger på engelsk, men behovet er det samme: registrér tid, dokumentér arbejdet, og gør fakturering lettere."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedSubtitle="If you searched in English, these Danish pages are the closest match:"
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
                Privatliv som standard: du bestemmer niveauet.
              </p>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">Danske sider</h3>
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
                  <Link className="underline" href="/tidsregistrering">
                    Tidsregistrering
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
            </ul>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">Opret konto og test en uge.</p>
            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
