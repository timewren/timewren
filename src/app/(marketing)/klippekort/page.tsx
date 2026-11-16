import { Bell, Clock, FileText, Shield, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { TestimonialQuote } from "@/components/marketing/TestimonialQuote";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Klippekort-system til freelancere",
  description:
    "Online klippekort til freelancere: sælg timer på forhånd, track forbrug og saldo automatisk. Digitalt klippekort med udløb, advarsler og historik. Prøv gratis.",
  openGraph: {
    title: "Klippekort-system til freelancere",
    description:
      "Online klippekort til freelancere: sælg timer på forhånd, track forbrug og saldo automatisk. Digitalt klippekort med udløb, advarsler og historik. Prøv gratis.",
  },
  alternates: { canonical: "/klippekort" },
};

export default function KlippekortPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Er klippekort det samme som prepaid timer?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ofte ja. Prepaid timer er typisk bare en anden betegnelse for et online klippekort med saldo.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad er det vigtigste for at undgå konflikter?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Tydelig historik: hvad er brugt, hvornår og på hvilken opgave/projekt.",
        },
      },
      {
        "@type": "Question",
        name: "Skal jeg stadig lave rapporter?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Rapport pr. periode er stadig dit fakturagrundlag, også med klippekort.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad sker der når et klippekort udløber?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "TimeTrack sender advarsler før klippekort udløb, så du og kunden kan nå at forny. Du sætter selv hvor lang tid før udløb advarslen sendes.",
        },
      },
      {
        "@type": "Question",
        name: "Kan kunden se sin klippekort-saldo?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Med TimeTrack's kundeportal kan kunden logge ind og se klippekort-saldo, forbrug og historik i realtid.",
        },
      },
      {
        "@type": "Question",
        name: "Findes der en klippekort-app?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "TimeTrack fungerer som en klippekort-app i browseren og som PWA på mobil. Du kan oprette, administrere og tracke klippekort fra telefonen.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Er klippekort det samme som prepaid timer?",
      answer: (
        <p>
          Ofte ja. Prepaid timer er bare en anden betegnelse for et online
          klippekort. Se også{" "}
          <Link className="underline" href="/prepaid-timer">
            prepaid timer
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Hvad er det vigtigste for at undgå konflikter?",
      answer: (
        <p>Tydelig historik: hvad er brugt, hvornår og på hvilken opgave.</p>
      ),
    },
    {
      question: "Skal jeg stadig lave rapporter?",
      answer: (
        <p>
          Ja. Rapport pr. periode er stadig dit fakturagrundlag. Se{" "}
          <Link className="underline" href="/timeregistrering-til-faktura">
            timeregistrering til faktura
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Hvad sker der når et klippekort udløber?",
      answer: (
        <p>
          TimeTrack sender advarsler før klippekort udløb, så du og kunden kan
          nå at forny. Du sætter selv hvor lang tid før udløb advarslen sendes.
        </p>
      ),
    },
    {
      question: "Kan kunden se sin klippekort-saldo?",
      answer: (
        <p>
          Ja. Med TimeTrack&apos;s{" "}
          <Link className="underline" href="/kundeportal">
            kundeportal
          </Link>{" "}
          kan kunden logge ind og se klippekort-saldo, forbrug og historik i
          realtid.
        </p>
      ),
    },
    {
      question: "Findes der en klippekort-app?",
      answer: (
        <p>
          TimeTrack fungerer som en klippekort-app i browseren og som PWA på
          mobil. Du kan oprette, administrere og tracke klippekort fra
          telefonen.
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/prepaid-timer",
      title: "Prepaid timer",
      description: "Sælg timer på forhånd med ro.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Timer pr. kunde og projekt.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Gør arbejdet nemt at fakturere.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Rapport og specifikation pr. periode.",
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
      title="Klippekort-system til freelancere"
      subtitle="Digitalt klippekort: sælg timer på forhånd, registrér forbrug automatisk og giv kunden overblik over saldo og historik, online og uden regneark."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Mere om prepaid timer, timeregistrering og fakturagrundlag:"
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
                Timer trækker fra klippekortet når du registrerer tid.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Klar historik
              </h2>
              <p className="text-slate-600">
                Se hvad der er brugt, hvornår og på hvilken opgave/projekt.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Shield className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Mindre friktion med kunder
              </h2>
              <p className="text-slate-600">
                Klare forventninger og færre &quot;hvorfor den
                faktura?&quot;-tråde.
              </p>
            </div>
          </div>

          {/* Klippekort udløb og saldo */}
          <div className="mt-14">
            <h2 className="mb-8 text-center text-2xl font-bold text-slate-900 sm:text-3xl">
              Klippekort udløb og saldo
            </h2>
            <div className="grid gap-8 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
                <Bell className="mb-4 h-8 w-8 text-amber-500" />
                <h3 className="mb-2 text-xl font-semibold text-slate-900">
                  Advarsler ved lav saldo
                </h3>
                <p className="text-slate-600">
                  Sæt en grænse (f.eks. 5 timer) og få automatisk besked når
                  klippekortet er ved at løbe ud. Du og kunden undgår
                  overraskelser.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
                <Clock className="mb-4 h-8 w-8 text-amber-500" />
                <h3 className="mb-2 text-xl font-semibold text-slate-900">
                  Udløbspåmindelser
                </h3>
                <p className="text-slate-600">
                  Klippekort kan have en udløbsdato. TimeTrack sender en
                  påmindelse før udløb, så I kan nå at forny eller bruge
                  resterende timer.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
                <Smartphone className="mb-4 h-8 w-8 text-brand-600" />
                <h3 className="mb-2 text-xl font-semibold text-slate-900">
                  Klippekort-app
                </h3>
                <p className="text-slate-600">
                  TimeTrack fungerer som en online klippekort-app: opret, track
                  og administrér fra browser eller mobil. Ingen separat app
                  nødvendig.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
                <FileText className="mb-4 h-8 w-8 text-brand-600" />
                <h3 className="mb-2 text-xl font-semibold text-slate-900">
                  Kundeportal med saldo
                </h3>
                <p className="text-slate-600">
                  Giv kunden adgang til en{" "}
                  <Link className="underline" href="/kundeportal">
                    kundeportal
                  </Link>{" "}
                  hvor de selv kan se klippekort-saldo, forbrug og historik.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Hvordan det typisk bruges
            </h3>
            <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
              <li>Opret klippekort (timer + pris)</li>
              <li>Link det til en kunde/projekt</li>
              <li>Track tid på opgaver</li>
              <li>Få advarsel når saldo er lav</li>
            </ol>
            <p className="mt-6 text-sm text-slate-600">
              Se også:{" "}
              <Link className="underline" href="/timeregistrering">
                timeregistrering
              </Link>{" "}
              og{" "}
              <Link className="underline" href="/timeregistrering-til-faktura">
                timeregistrering til faktura
              </Link>
              .
            </p>
          </div>

          <div className="mt-14">
            <TestimonialQuote excerpt="Timetrack.dk gør en ellers kedelig administrativ opgave både enkel og overskuelig." />
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Start med ét klippekort til din mest stabile kunde.
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
