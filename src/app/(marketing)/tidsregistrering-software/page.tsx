import { Check, Clock, CreditCard, FileText, Puzzle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-gate";
import {
  FREE_TRIAL_DAYS,
  SUBSCRIPTION_PRICE_MONTHLY,
  TEAM_INCLUDED_SEATS,
  TEAM_SEAT_PRICE_MONTHLY,
} from "@/lib/config";

// Samme tekst i FAQ-schemaet og den synlige FAQ, bygget af de gældende
// konstanter, så den ikke kan løbe fra /pricing igen.
const PRICE_ANSWER = `Du kan bruge TimeTrack gratis med op til ${FREE_MAX_SEATS} brugere og ${FREE_MAX_ACTIVE_CLIENTS} aktive kunder. Selvstændig koster ${SUBSCRIPTION_PRICE_MONTHLY} kr./md., og Team koster ${TEAM_SEAT_PRICE_MONTHLY} kr. pr. bruger/md. (min. ${TEAM_INCLUDED_SEATS} brugere). Alle priser er ekskl. moms. Nye konti får ${FREE_TRIAL_DAYS} dage med alle funktioner uden betalingskort.`;

export const metadata: Metadata = {
  title: "Tidsregistrering-software til freelancere og konsulenter",
  description: `Dansk tidsregistrering-software: registrér tid pr. kunde og projekt, få rapporter og fakturér direkte. Gratis at starte, ${SUBSCRIPTION_PRICE_MONTHLY} kr./md. ekskl. moms for selvstændige. Integration med Billy, Dinero og e-conomic.`,
  alternates: { canonical: "/tidsregistrering-software" },
  openGraph: {
    title: "Tidsregistrering-software til freelancere og konsulenter",
    description: `Dansk tidsregistrering-software: registrér tid pr. kunde og projekt, få rapporter og fakturér direkte. Gratis at starte, ${SUBSCRIPTION_PRICE_MONTHLY} kr./md. ekskl. moms for selvstændige.`,
    url: "/tidsregistrering-software",
    type: "website",
  },
};

export default function TidsregistreringSoftwarePage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad koster tidsregistrering-software?",
        acceptedAnswer: {
          "@type": "Answer",
          text: PRICE_ANSWER,
        },
      },
      {
        "@type": "Question",
        name: "Er TimeTrack et dansk tidsregistreringssystem?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. TimeTrack er bygget i Danmark, database og backup ligger i EU, supporten er på dansk, og fakturagrundlaget kan sendes til Billy og Dinero.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg fakturere direkte fra min tidsregistrering?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Dine registrerede timer bliver til fakturaudkast med specifikation pr. kunde og periode, eller synkroniseres til Billy eller Dinero.",
        },
      },
      {
        "@type": "Question",
        name: "Hvor hurtigt kan jeg komme i gang?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Opret en konto på under 2 minutter, opret din første kunde og start timeren. Du kan importere data fra TimeOps, Effihub, Toggl, Harvest og Clockify.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad koster tidsregistrering-software?",
      answer: (
        <p>
          {PRICE_ANSWER} Se{" "}
          <Link className="underline" href="/pricing">
            priser
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Er TimeTrack et dansk tidsregistreringssystem?",
      answer: (
        <p>
          Ja. Bygget i Danmark, database og backup i EU, dansk support og
          fakturagrundlag til Billy og Dinero.
        </p>
      ),
    },
    {
      question: "Kan jeg fakturere direkte fra min tidsregistrering?",
      answer: (
        <p>
          Ja. Timer bliver til fakturaudkast med specifikation pr. kunde og
          periode. Se{" "}
          <Link className="underline" href="/timeregistrering-til-faktura">
            timeregistrering til faktura
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Hvor hurtigt kan jeg komme i gang?",
      answer: (
        <p>
          Under 2 minutter. Vi importerer fra TimeOps, Effihub, Toggl, Harvest
          og Clockify.
        </p>
      ),
    },
  ];

  return (
    <SEOPageLayout
      badge="Dansk tidsregistrering-software"
      title="Tidsregistrering-software der ender i en faktura"
      subtitle="Registrér tid pr. kunde og projekt, få rapporter der dur som dokumentation, og send fakturaen uden at gætte. Bygget i Danmark til freelancere og konsulenter."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={[
        {
          href: "/timeregistrering-til-faktura",
          title: "Fra timer til faktura",
          description: "Sådan bliver registreret tid til fakturagrundlag.",
        },
        {
          href: "/klippekort",
          title: "Klippekort",
          description:
            "Sælg forudbetalte timer og træk automatisk fra saldoen.",
        },
        {
          href: "/timepris-beregner",
          title: "Timepris-beregner",
          description: "Gratis værktøj: find din rigtige timepris.",
        },
      ]}
      ctaTitle="Start gratis med TimeTrack"
      ctaSubtitle="Intet betalingskort. Gratis at starte, og du opgraderer kun, hvis du får brug for mere."
    >
      {/* Signup højt på siden — betalt trafik skal ikke lede efter CTA'en */}
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-bold text-slate-900">
                Alt du skal bruge, uden enterprise-bøvl
              </h2>
              <ul className="mt-6 space-y-3 text-slate-700">
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    Et-klik timer i browseren, som app og i browser-extension
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Tid pr. kunde og projekt med egne timepriser</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Rapporter og eksport der dur som fakturagrundlag</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    Klippekort: sælg forudbetalte timer og træk automatisk
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Billy-, Dinero- og e-conomic-integration</span>
                </li>
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
              <h3 className="text-xl font-semibold text-slate-900">
                Start gratis på 2 minutter
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                Gratis at starte. Intet betalingskort.
              </p>
              <div className="mt-6">
                <QuickSignupForm variant="hero" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Hvad softwaren dækker */}
      <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Fire ting et tidsregistreringssystem skal kunne
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Registrere uden friktion
              </h3>
              <p className="text-sm text-slate-600">
                Timer eller manuel indtastning. Hvis det er besværligt, gør du
                det ikke.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-2 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Dokumentere
              </h3>
              <p className="text-sm text-slate-600">
                Rapport pr. kunde/projekt/periode, klar til at vedhæfte
                fakturaen.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <CreditCard className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Fakturere
              </h3>
              <p className="text-sm text-slate-600">
                Timer → fakturaudkast eller direkte til dit regnskabsprogram.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Puzzle className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Passe ind
              </h3>
              <p className="text-sm text-slate-600">
                Billy, Dinero, e-conomic, API, Zapier/Make: dine data er ikke
                fanget.
              </p>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
