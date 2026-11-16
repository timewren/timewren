import { Eye, HeadphonesIcon, Palette } from "lucide-react";
import type { Metadata } from "next";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE, PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Kundeportal til freelancere",
  description:
    "White-label kundeportal: lad kunder se timer, fakturaer og klippekort-saldo med dit logo og dine farver. Start gratis med TimeTrack.",
  alternates: { canonical: "/kundeportal" },
};

export default function KundeportalPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad er en kundeportal?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "En kundeportal er en side hvor dine kunder kan logge ind og se timer, fakturaer og klippekort-saldo. Det skaber gennemsigtighed og sparer dig for support.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg bruge mit eget logo og mine farver?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. TimeTracks kundeportal er white-label: du sætter dit eget logo, farver og domæne, så kunden oplever det som din platform.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad kan kunden se i portalen?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Kunden kan se timeregistreringer, fakturaer, klippekort-saldo og projektstatus. Du bestemmer præcis hvad der er synligt.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad er en kundeportal?",
      answer: (
        <p>
          En kundeportal er en side hvor dine kunder kan logge ind og se timer,
          fakturaer og klippekort-saldo. Det skaber gennemsigtighed og sparer
          dig for support.
        </p>
      ),
    },
    {
      question: "Kan jeg bruge mit eget logo og mine farver?",
      answer: (
        <p>
          Ja. TimeTracks kundeportal er white-label: du sætter dit eget logo,
          farver og domæne, så kunden oplever det som din platform.
        </p>
      ),
    },
    {
      question: "Hvad kan kunden se i portalen?",
      answer: (
        <p>
          Kunden kan se timeregistreringer, fakturaer, klippekort-saldo og
          projektstatus. Du bestemmer præcis hvad der er synligt.
        </p>
      ),
    },
    {
      question: "Koster det ekstra?",
      answer: (
        <p>
          Der er ikke et ekstra gebyr for kundeportalen, og den koster ikke
          noget pr. kunde. Selvstændig koster {PLAN_PRICES.selvstaendig.price}{" "}
          ekskl. moms.
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/klippekort",
      title: "Klippekort",
      description: "Sælg forudbetalte timer til dine kunder.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Registrér timer pr. kunde og projekt.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Fra timer til faktura på ingen tid.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Kundeportal til freelancere"
      subtitle="Giv dine kunder adgang til timer, fakturaer og klippekort-saldo, med dit eget brand."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Kundeportalen hænger sammen med klippekort og fakturering:"
      ctaTitle="Giv dine kunder overblik"
      ctaSubtitle="Opret en kundeportal med dit brand og lad kunderne selv se timer, fakturaer og saldo. Gratis at starte."
    >
      {/* USP cards */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Eye className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Gennemsigtighed
              </h2>
              <p className="text-slate-600">
                Kunden kan selv se hvor mange timer der er brugt, hvad saldoen
                er, og hvilke fakturaer der er sendt. Færre spørgsmål, mere
                tillid.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Palette className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                White-label
              </h2>
              <p className="text-slate-600">
                Dit logo, dine farver, din branding. Kunden oplever portalen som
                en del af din virksomhed og ikke som et tredjepartsværktøj.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <HeadphonesIcon className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Spar support-tid
              </h2>
              <p className="text-slate-600">
                I stedet for at sende statusopdateringer pr. e-mail kan kunden
                selv slå op.
              </p>
            </div>
          </div>

          {/* Use cases */}
          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Hvem bruger en kundeportal?
            </h3>
            <ul className="mt-4 space-y-3 text-slate-700">
              <li className="flex items-start gap-3">
                <span className="mt-1 block h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                <span>
                  <strong>Konsulenter</strong> der sælger klippekort og vil give
                  kunden overblik over forbruget.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 block h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                <span>
                  <strong>Udviklere</strong> der vil vise kunden hvor mange
                  timer der er brugt pr. projekt.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 block h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                <span>
                  <strong>Bureauer</strong> der vil professionalisere
                  kunderelationen med eget brand.
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Prøv kundeportalen
            </h3>
            <p className="mt-2 text-slate-600">
              Opret en konto, og invitér din første kunde til portalen.
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
