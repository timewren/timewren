import { ArrowRight, Check, CreditCard, Download, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PLAN_PRICES, TRIAL_DAYS } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Skift fra TimeOps til TimeTrack: import på 10 minutter",
  description: `Flyt kunder, projekter og tidsregistreringer fra TimeOps til TimeTrack med den indbyggede TimeOps-import. Klippekort, fakturagrundlag og Billy/Dinero i Selvstændig. Prøv gratis i ${TRIAL_DAYS} dage.`,
  alternates: { canonical: "/skift-fra-timeops" },
  openGraph: {
    title: "Skift fra TimeOps til TimeTrack: import på 10 minutter",
    description:
      "Flyt kunder, projekter og tidsregistreringer fra TimeOps med indbygget import. Klippekort og fakturagrundlag i Selvstændig.",
    url: "/skift-fra-timeops",
    type: "website",
  },
};

export default function SkiftFraTimeopsPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad kan jeg flytte med fra TimeOps?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "TimeTracks indbyggede TimeOps-import flytter dine kunder, projekter og tidsregistreringer via TimeOps' CSV-eksport, med mapping-preview, så du ser, hvad der oprettes, før du bekræfter.",
        },
      },
      {
        "@type": "Question",
        name: "Hvorfor skifte fra TimeOps til TimeTrack?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `TimeTrack har klippekort med automatisk saldo, fakturagrundlag til Billy, Dinero og e-conomic og kundeportal. Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms for én bruger, uden binding på månedsabonnementet.`,
        },
      },
      {
        "@type": "Question",
        name: "Mister jeg min historik?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nej. Importen tager dine historiske tidsregistreringer med, så rapporter og kundeoverblik fortsætter hvor du slap.",
        },
      },
      {
        "@type": "Question",
        name: "Er der binding eller opsigelsesvarsel?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nej. TimeTrack er måned-til-måned uden binding, og du kan starte gratis uden betalingskort.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad kan jeg flytte med fra TimeOps?",
      answer: (
        <p>
          Kunder, projekter og tidsregistreringer via TimeOps' CSV-eksport, med
          mapping-preview før du bekræfter.
        </p>
      ),
    },
    {
      question: "Hvorfor skifte?",
      answer: (
        <p>
          <Link className="underline" href="/klippekort">
            Klippekort
          </Link>{" "}
          med automatisk saldo, fakturagrundlag til{" "}
          <Link className="underline" href="/billy">
            Billy
          </Link>
          /
          <Link className="underline" href="/dinero">
            Dinero
          </Link>{" "}
          og kundeportal. Selvstændig koster {PLAN_PRICES.selvstaendig.price}{" "}
          ekskl. moms.
        </p>
      ),
    },
    {
      question: "Er der binding?",
      answer: (
        <p>
          Nej. Det er måned til måned, og du kan starte gratis uden
          betalingskort.
        </p>
      ),
    },
  ];

  return (
    <SEOPageLayout
      badge="Indbygget TimeOps-import"
      title="Skift fra TimeOps på 10 minutter"
      subtitle="Eksportér fra TimeOps, importér i TimeTrack: historik, kunder og projekter kommer med. Klippekort, fakturagrundlag og Billy/Dinero får du i Selvstændig."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={[
        {
          href: "/timeops-alternativ",
          title: "TimeTrack vs. TimeOps",
          description: "Fuld sammenligning af de to systemer.",
        },
        {
          href: "/klippekort",
          title: "Klippekort",
          description: "Sælg forudbetalte timer med automatisk saldo.",
        },
        {
          href: "/skift-fra-toggl",
          title: "Skifter du fra Toggl?",
          description: "TimeTrack har også en Toggl-import.",
        },
      ]}
      ctaTitle="Klar til at skifte?"
      ctaSubtitle="Gratis at starte: importér dine TimeOps-data og se, om det passer dig."
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
                1. Eksportér fra TimeOps
              </h3>
              <p className="text-slate-600">
                Brug TimeOps' CSV-eksport til at hente dine registreringer,
                kunder og projekter ud.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Upload className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                2. Importér i TimeTrack
              </h3>
              <p className="text-slate-600">
                Integrationer → Importér fra TimeOps. Mapping-preview viser hvad
                der oprettes, før du bekræfter.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Check className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                3. Fortsæt hvor du slap
              </h3>
              <p className="text-slate-600">
                Historikken er på plads. Start timeren, sælg dit første
                klippekort og fakturér direkte fra timerne.
              </p>
            </div>
          </div>

          <div className="mt-16 grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-bold text-slate-900">
                Derfor skifter freelancere fra TimeOps
              </h2>
              <ul className="mt-6 space-y-3 text-slate-700">
                <li className="flex items-start gap-3">
                  <CreditCard className="mt-1 h-5 w-5 shrink-0 text-brand-600" />
                  <span>
                    <strong>Klippekort:</strong> forudbetalte timer med
                    automatisk saldo og lav-saldo-advarsler.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    <strong>Fast pris:</strong> Selvstændig koster{" "}
                    {PLAN_PRICES.selvstaendig.price} ekskl. moms, uden moduler
                    eller tilkøb.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    <strong>Fleksibilitet:</strong> måned til måned uden
                    binding. API, Zapier og Make, hvis du vil bygge videre.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    <strong>Kundeportal:</strong> kunden kan selv se timer,
                    rapporter og klippekort-saldo.
                  </span>
                </li>
              </ul>
              <Link
                href="/timeops-alternativ"
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
                Opret en gratis konto. TimeOps-importen ligger klar under
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
