import { ArrowRight, Check, CreditCard, Download, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PLAN_PRICES, TRIAL_DAYS } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Skift fra Toggl til TimeTrack: import på 10 minutter",
  description: `Flyt kunder, projekter og tidsregistreringer fra Toggl Track til TimeTrack med den indbyggede Toggl-import. Dansk system med klippekort, fakturagrundlag og Billy/Dinero. Prøv gratis i ${TRIAL_DAYS} dage.`,
  alternates: { canonical: "/skift-fra-toggl" },
  openGraph: {
    title: "Skift fra Toggl til TimeTrack: import på 10 minutter",
    description:
      "Flyt kunder, projekter og tidsregistreringer fra Toggl med indbygget import. Dansk system med klippekort og fakturagrundlag.",
    url: "/skift-fra-toggl",
    type: "website",
  },
};

export default function SkiftFraTogglPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad kan jeg flytte med fra Toggl?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "TimeTracks indbyggede Toggl-import flytter dine kunder, projekter og tidsregistreringer. Du eksporterer fra Toggl og importerer med mapping-preview, så du ser præcis hvad der oprettes før du bekræfter.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad får jeg i TimeTrack som Toggl ikke har?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Klippekort (forudbetalte timer med automatisk saldo), fakturagrundlag til Billy, Dinero og e-conomic, kundeportal og dansk support. Toggl registrerer tid. TimeTrack tager dig videre fra timer til fakturagrundlag.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad koster TimeTrack i forhold til Toggl?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms for én bruger, med klippekort, fakturagrundlag og Billy eller Dinero. Toggls betalte planer starter ved ca. 10 USD pr. bruger/md., og fakturering og klippekort kræver stadig andre værktøjer ved siden af.`,
        },
      },
      {
        "@type": "Question",
        name: "Mister jeg min historik?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nej. Importen tager din Toggl-eksport med historiske tidsregistreringer, så rapporter og statistik fortsætter hvor du slap.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad kan jeg flytte med fra Toggl?",
      answer: (
        <p>
          Kunder, projekter og tidsregistreringer, med mapping-preview så du ser
          hvad der oprettes, før du bekræfter.
        </p>
      ),
    },
    {
      question: "Hvad får jeg som Toggl ikke har?",
      answer: (
        <p>
          <Link className="underline" href="/klippekort">
            Klippekort
          </Link>
          , dansk fakturering med{" "}
          <Link className="underline" href="/billy">
            Billy
          </Link>
          /
          <Link className="underline" href="/dinero">
            Dinero
          </Link>
          -integration, kundeportal og dansk support.
        </p>
      ),
    },
    {
      question: "Mister jeg min historik?",
      answer: <p>Nej. Importen tager historiske tidsregistreringer med.</p>,
    },
  ];

  return (
    <SEOPageLayout
      badge="Indbygget Toggl-import"
      title="Skift fra Toggl på 10 minutter"
      subtitle="Eksportér fra Toggl Track, importér i TimeTrack, og få klippekort, dansk fakturering og Billy/Dinero oveni. Historikken kommer med."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={[
        {
          href: "/toggl-alternativ",
          title: "TimeTrack vs. Toggl",
          description: "Fuld sammenligning af de to systemer.",
        },
        {
          href: "/klippekort",
          title: "Klippekort",
          description: "Differentiatoren Toggl ikke har.",
        },
        {
          href: "/skift-fra-timeops",
          title: "Skifter du fra TimeOps?",
          description: "TimeTrack har også en TimeOps-import.",
        },
      ]}
      ctaTitle="Klar til at skifte?"
      ctaSubtitle="Gratis at starte: importér dine Toggl-data og se, om det passer dig."
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Sådan skifter du: tre trin
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Download className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                1. Eksportér fra Toggl
              </h3>
              <p className="text-slate-600">
                I Toggl: Reports → Detailed → Export. Du får en CSV med alle
                dine registreringer, kunder og projekter.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Upload className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                2. Importér i TimeTrack
              </h3>
              <p className="text-slate-600">
                Integrationer → Importér fra Toggl. Mapping-preview viser præcis
                hvad der oprettes, før du bekræfter.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Check className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                3. Fortsæt hvor du slap
              </h3>
              <p className="text-slate-600">
                Historik, kunder og projekter er på plads. Start timeren, og
                send din første faktura direkte fra timerne.
              </p>
            </div>
          </div>

          <div className="mt-16 grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-bold text-slate-900">
                Derfor skifter freelancere fra Toggl
              </h2>
              <ul className="mt-6 space-y-3 text-slate-700">
                <li className="flex items-start gap-3">
                  <CreditCard className="mt-1 h-5 w-5 shrink-0 text-brand-600" />
                  <span>
                    <strong>Klippekort:</strong> sælg forudbetalte timer med
                    automatisk saldo. Det findes ikke i Toggl.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    <strong>Timer bliver til fakturaer:</strong> dansk
                    fakturering med Billy og Dinero, og fakturagrundlag til
                    e-conomic.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    <strong>Fast pris:</strong> Selvstændig koster{" "}
                    {PLAN_PRICES.selvstaendig.price} ekskl. moms for én bruger,
                    uden tilkøbsmoduler.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    <strong>Dansk:</strong> support på dansk, database og backup
                    i EU, bygget til danske freelanceres hverdag.
                  </span>
                </li>
              </ul>
              <Link
                href="/toggl-alternativ"
                className="mt-6 inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700"
              >
                Se den fulde sammenligning
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
              <h3 className="text-xl font-semibold text-slate-900">
                Start din import nu
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                Opret en gratis konto. Toggl-importen ligger klar under
                Integrationer.
              </p>
              <div className="mt-6">
                <QuickSignupForm variant="hero" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
