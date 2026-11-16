import { Check, Clock, FileText, Shield } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Prepaid timer (klippekort) til freelancere",
  description:
    "Prepaid timer / klippekort til freelancere: sælg timer på forhånd, track forbrug automatisk og få saldo + historik uden regneark. Gratis at starte.",
  alternates: { canonical: "/prepaid-timer" },
};

export default function PrepaidTimerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad er forskellen på prepaid timer og klippekort?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ofte betyder det det samme: timer købt på forhånd med en saldo.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan undgår jeg diskussioner om forbrug?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Hav en tydelig historik pr. opgave/projekt og kombiner med konsekvent timeregistrering.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg stadig lave rapport/fakturagrundlag?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Brug rapport pr. periode og eksportér til faktura.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad er forskellen på prepaid timer og klippekort?",
      answer: (
        <p>
          Ofte betyder det det samme: timer købt på forhånd med en saldo. Se:{" "}
          <Link className="underline" href="/klippekort">
            klippekort
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Hvordan undgår jeg diskussioner om forbrug?",
      answer: (
        <p>
          Hav altid en tydelig historik pr. opgave/projekt. Kombinér med
          <Link className="underline" href="/timeregistrering">
            {" "}
            timeregistrering
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Kan jeg stadig lave rapport/fakturagrundlag?",
      answer: (
        <p>
          Ja. Brug rapporten pr. periode. Se:{" "}
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
      href: "/klippekort",
      title: "Klippekort",
      description: "Prepaid timer med saldo og historik.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Hold styr på timer pr. kunde/projekt.",
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
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
    {
      href: "/features",
      title: "Features",
      description: "Overblik over hvad TimeTrack kan.",
    },
  ];

  return (
    <SEOPageLayout
      title="Prepaid timer (klippekort) til freelancere"
      subtitle="Sælg timer på forhånd, registrér forbrug automatisk og få overblik over saldo og historik, uden regneark og manuelle opdateringer."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Prepaid timer hænger tæt sammen med klippekort og timeregistrering:"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Automatisk forbrug
              </h2>
              <p className="text-slate-600">
                Timer trækkes fra saldoen når du registrerer tid.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Klar historik
              </h2>
              <p className="text-slate-600">
                Se hvad der er brugt, hvornår og på hvilke opgaver/projekter.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Shield className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Bedre forventningsstyring
              </h2>
              <p className="text-slate-600">
                Klare rammer: hvad er købt, hvad er brugt, og hvad er tilbage.
              </p>
            </div>
          </div>

          <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <h3 className="text-2xl font-bold text-slate-900">
                Hvornår giver prepaid mening?
              </h3>
              <ul className="mt-6 space-y-4 text-slate-700">
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    Når du laver løbende småting (support, ændringer, små
                    forbedringer).
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    Når du vil undgå at fakturere &quot;micro-timer&quot; hver
                    uge.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    Når kunden vil have forudsigelighed, og du vil have
                    kontinuitet.
                  </span>
                </li>
              </ul>

              <p className="mt-6 text-sm text-slate-600">
                Relateret:{" "}
                <Link className="underline" href="/klippekort">
                  klippekort
                </Link>{" "}
                og{" "}
                <Link className="underline" href="/timeregistrering">
                  timeregistrering
                </Link>
                .
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
              <h3 className="text-2xl font-bold text-slate-900">Workflow</h3>
              <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
                <li>Opret prepaid/klippekort (timer + pris)</li>
                <li>Tilføj kunden og projektet</li>
                <li>Track tid som normalt</li>
                <li>Få advarsel når saldoen er lav</li>
              </ol>

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
      </section>
    </SEOPageLayout>
  );
}
