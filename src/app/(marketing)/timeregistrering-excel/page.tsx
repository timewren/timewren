import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileSpreadsheet,
  X,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE, PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Fra Excel til TimeTrack: timeregistrering",
  description:
    "Timeregistrering i Excel? Se hvorfor freelancere skifter til TimeTrack: automatisk beregning, rapporter og fakturering. Importér din Excel-fil gratis.",
  alternates: { canonical: "/timeregistrering-excel" },
};

export default function TimeregistreringExcelPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Kan jeg importere mine timer fra Excel?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. TimeTrack understøtter CSV-import, så du kan tage dine eksisterende timer med fra Excel.",
        },
      },
      {
        "@type": "Question",
        name: "Er timeregistrering i Excel gratis?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `Excel kræver en Microsoft-licens. TimeTrack Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms og har timer, rapporter, klippekort og fakturagrundlag.`,
        },
      },
      {
        "@type": "Question",
        name: "Hvad er problemet med Excel til timeregistrering?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Excel mangler automatisk beregning pr. kunde, rapporter pr. periode, advarsler ved lav klippekort-saldo og direkte fakturering. Det kræver meget manuelt arbejde.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg eksportere fra TimeTrack til Excel?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. TimeTrack kan eksportere alle timer som CSV, som du kan åbne direkte i Excel.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Kan jeg importere mine timer fra Excel?",
      answer: (
        <p>
          Ja. TimeTrack understøtter CSV-import, så du kan tage dine
          eksisterende timer med. Se{" "}
          <Link className="underline" href="/timeregistrering">
            timeregistrering
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Er timeregistrering i Excel gratis?",
      answer: (
        <p>
          Excel kræver en Microsoft-licens. TimeTrack Selvstændig koster{" "}
          {PLAN_PRICES.selvstaendig.price} ekskl. moms og har timer, rapporter,
          klippekort og fakturagrundlag.
        </p>
      ),
    },
    {
      question: "Hvad er problemet med Excel til timeregistrering?",
      answer: (
        <p>
          Excel mangler automatisk beregning pr. kunde, rapporter pr. periode,
          advarsler ved lav klippekort-saldo og direkte fakturering. Det kræver
          meget manuelt arbejde.
        </p>
      ),
    },
    {
      question: "Kan jeg eksportere fra TimeTrack til Excel?",
      answer: (
        <p>
          Ja. TimeTrack kan eksportere alle timer som CSV, som du kan åbne
          direkte i Excel.
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Professionel timeregistrering for freelancere.",
    },
    {
      href: "/klippekort",
      title: "Klippekort",
      description: "Sælg prepaid timer til dine kunder.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Fra timer til faktura på ingen tid.",
    },
    {
      href: "/online-stopur",
      title: "Online stopur",
      description: "Start en timer med et klik.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title={
        <>
          Fra Excel til <span className="text-brand-600">TimeTrack</span>
        </>
      }
      subtitle="Excel er fint til at starte med. Men når du vil have automatisk beregning, rapporter og fakturering, er det tid til næste skridt."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Fra Excel-ark til professionel timeregistrering:"
      ctaTitle="Klar til at droppe Excel?"
      ctaSubtitle="Importér dine timer fra Excel og kom gratis i gang med TimeTrack."
    >
      {/* Comparison table */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">
              Excel vs TimeTrack
            </h2>
            <p className="text-lg text-slate-600">
              Se hvordan timeregistrering i Excel sammenligner med TimeTrack
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200/60 shadow-sm">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                    Feature
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold text-slate-600">
                    <div className="flex items-center justify-center gap-2">
                      <FileSpreadsheet className="h-4 w-4" />
                      Excel
                    </div>
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold text-brand-600">
                    TimeTrack
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 bg-white">
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-900">
                    Registrér timer
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-sm text-slate-500">Manuelt</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Check className="mx-auto h-5 w-5 text-green-600" />
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-900">
                    Automatisk beregning pr. kunde
                  </td>
                  <td className="px-6 py-4 text-center">
                    <X className="mx-auto h-5 w-5 text-red-500" />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Check className="mx-auto h-5 w-5 text-green-600" />
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-900">
                    Rapporter pr. periode
                  </td>
                  <td className="px-6 py-4 text-center">
                    <X className="mx-auto h-5 w-5 text-red-500" />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Check className="mx-auto h-5 w-5 text-green-600" />
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-900">
                    Klippekort / prepaid timer
                  </td>
                  <td className="px-6 py-4 text-center">
                    <X className="mx-auto h-5 w-5 text-red-500" />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Check className="mx-auto h-5 w-5 text-green-600" />
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-900">
                    Fakturering
                  </td>
                  <td className="px-6 py-4 text-center">
                    <X className="mx-auto h-5 w-5 text-red-500" />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Check className="mx-auto h-5 w-5 text-green-600" />
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-900">
                    Live timer/stopur
                  </td>
                  <td className="px-6 py-4 text-center">
                    <X className="mx-auto h-5 w-5 text-red-500" />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Check className="mx-auto h-5 w-5 text-green-600" />
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-900">
                    CSV import/eksport
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Check className="mx-auto h-5 w-5 text-green-600" />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Check className="mx-auto h-5 w-5 text-green-600" />
                  </td>
                </tr>
                <tr className="bg-brand-50/50">
                  <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                    Pris
                  </td>
                  <td className="px-6 py-4 text-center text-sm text-slate-600">
                    Microsoft 365-licens
                  </td>
                  <td className="px-6 py-4 text-center font-semibold text-brand-600">
                    {PLAN_PRICES.selvstaendig.price} ekskl. moms
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Common Excel problems */}
      <section className="border-t bg-slate-50/50 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">
              Typiske Excel-problemer
            </h2>
            <p className="text-lg text-slate-600">
              Kender du disse udfordringer med timeregistrering i Excel?
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex items-start gap-4 rounded-2xl border border-amber-200/60 bg-amber-50 p-5">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
              <div>
                <h3 className="font-semibold text-slate-900">
                  Formler der går i stykker
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Én slettet celle kan ødelægge beregninger for hele måneden.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 rounded-2xl border border-amber-200/60 bg-amber-50 p-5">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
              <div>
                <h3 className="font-semibold text-slate-900">
                  Ingen overblik pr. kunde
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Du skal manuelt filtrere og summere for at se timer pr. kunde.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 rounded-2xl border border-amber-200/60 bg-amber-50 p-5">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
              <div>
                <h3 className="font-semibold text-slate-900">
                  Manuelt faktura-grundlag
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Du skal selv overføre timer fra regnearket til din faktura.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 rounded-2xl border border-amber-200/60 bg-amber-50 p-5">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
              <div>
                <h3 className="font-semibold text-slate-900">
                  Ingen advarsler
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Excel fortæller dig ikke når klippekortet er ved at løbe ud.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-12 flex items-center justify-center gap-4">
            <span className="text-slate-600">Excel-ark</span>
            <ArrowRight className="h-5 w-5 text-brand-600" />
            <span className="font-semibold text-brand-600">
              CSV-import til TimeTrack
            </span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Importér dine timer fra Excel
            </h3>
            <p className="mt-2 text-slate-600">
              Eksportér dit Excel-ark som CSV og importér det direkte i
              TimeTrack. Dine timer er med fra dag ét.
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
