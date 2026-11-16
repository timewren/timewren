import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  FileText,
  Shield,
  Users,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { CTASection } from "@/components/marketing/CTASection";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { PillBadge } from "@/components/marketing/PillBadge";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { Navigation } from "@/components/Navigation";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "e-conomic-integration: TimeTrack",
  description:
    "Forbind TimeTrack med din e-conomic-aftale og hent dine kunder. Brug rapport eller CSV fra TimeTrack som fakturagrundlag i e-conomic.",
  alternates: { canonical: "/integrations/economic" },
};

const INSTALL_URL = "/api/integrations/economic/start";

const syncedItems = [
  {
    icon: Users,
    title: "Kunder",
    description:
      "Hent dine e-conomic-kunder ind i TimeTrack. Kunder, du allerede har, genkendes på CVR-nummer og kundenummer, så de ikke oprettes to gange.",
  },
  {
    icon: FileText,
    title: "Fakturagrundlag",
    description:
      "Lav en rapport eller CSV ud fra dine tidsregistreringer og dit klippekort-forbrug, og brug den som fakturagrundlag i e-conomic.",
  },
  {
    icon: Building2,
    title: "Organisationer",
    description:
      "Har du flere e-conomic-aftaler? Vælg den rigtige ved installation og skift senere i indstillinger.",
  },
];

const steps = [
  {
    number: "1",
    title: "Klik installér",
    description:
      "Klik på knappen øverst. Du bliver sendt videre til e-conomic.",
  },
  {
    number: "2",
    title: "Godkend adgang",
    description:
      "Log ind på din e-conomic-konto (hvis du ikke allerede er logget ind) og klik 'Tillad adgang'.",
  },
  {
    number: "3",
    title: "Du er klar",
    description:
      "Du sendes tilbage til TimeTrack med forbindelsen aktiv. Under Integrationer i dashboardet kan du hente dine e-conomic-kunder ind.",
  },
];

const faq = [
  {
    q: "Hvad koster det?",
    a: `Der er ikke et ekstra gebyr for e-conomic-integrationen. Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms. Du skal have et aktivt e-conomic-abonnement.`,
  },
  {
    q: "Hvilken e-conomic-pakke skal jeg have?",
    a: "Alle e-conomic-pakker med API-adgang fungerer (fra Standard og op). Kontakt e-conomic hvis du er i tvivl om din aftale.",
  },
  {
    q: "Kan jeg afbryde forbindelsen igen?",
    a: "Ja. Under Indstillinger → Integrationer kan du afbryde forbindelsen når som helst. Dine data i TimeTrack påvirkes ikke.",
  },
  {
    q: "Hvilke data bruger TimeTrack fra e-conomic?",
    a: "Kundelisten fra e-conomic, men kun for de kunder, du vælger at hente. Dine tidsregistreringer, rapporter og klippekort-saldoer bliver i TimeTrack.",
  },
  {
    q: "Hvad hvis jeg både har e-conomic og Dinero?",
    a: "Du kan forbinde begge under Indstillinger → Integrationer og vælge, hvilket du bruger.",
  },
  {
    q: "Kan jeg installere uden at have en TimeTrack-konto?",
    a: "Du skal først oprette en konto på TimeTrack (gratis at starte, intet betalingskort). Derefter kan du installere e-conomic-integrationen.",
  },
];

export default function EconomicIntegrationPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD structured data
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Navigation />

      <MarketingHero
        badge={<PillBadge>e-conomic integration</PillBadge>}
        title={
          <>
            TimeTrack <span className="text-teal-600">+</span> e-conomic
          </>
        }
        subtitle={
          <>
            Forbind din TimeTrack-konto med e-conomic, og hent dine kunder ind.
            Registrér tid pr. kunde og projekt, og brug rapport eller CSV som
            fakturagrundlag i e-conomic.
          </>
        }
      >
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <a
            href={INSTALL_URL}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-lg transition hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            <Zap className="h-5 w-5" />
            Installér e-conomic-integration
            <ArrowRight className="h-5 w-5" />
          </a>
          <Link
            href="/e-conomic"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <BookOpen className="h-4 w-4" />
            Læs om e-conomic-flow i TimeTrack
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          Kræver en aktiv TimeTrack-konto og et e-conomic-abonnement med
          API-adgang.
        </p>
      </MarketingHero>

      {/* Step-by-step */}
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <SectionHeader
            title="Sådan installerer du"
            subtitle="3 trin. Tager under ét minut."
          />
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.number}
                className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-lg font-bold text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                  {step.number}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <a
              href={INSTALL_URL}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-lg transition hover:bg-teal-700"
            >
              <Zap className="h-5 w-5" />
              Start installation
              <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        </div>
      </section>

      {/* What gets synced */}
      <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8 dark:bg-slate-900/50">
        <div className="mx-auto max-w-5xl">
          <SectionHeader
            title="Hvad hentes fra e-conomic"
            subtitle="TimeTrack henter kun de kunder, du vælger. Dine tidsregistreringer og kundenotater bliver i TimeTrack."
          />
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {syncedItems.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl bg-white p-6 shadow-sm dark:bg-slate-950"
              >
                <item.icon className="h-8 w-8 text-teal-600 dark:text-teal-400" />
                <h3 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy / security */}
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 dark:border-slate-800 dark:bg-slate-900">
            <Shield className="h-10 w-10 text-teal-600 dark:text-teal-400" />
            <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">
              Sikker forbindelse
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-300">
              <li className="flex gap-2">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
                <span>
                  Kommunikationen går via e-conomics officielle grant-flow, så
                  dine adgangskoder aldrig deles med TimeTrack.
                </span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
                <span>
                  Adgangstokenet opbevares krypteret i TimeTracks database og
                  bruges kun til forbindelsen til dit eget e-conomic-regnskab.
                </span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
                <span>
                  Du kan afbryde forbindelsen når som helst. Dine data i
                  TimeTrack påvirkes ikke.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8 dark:bg-slate-900/50">
        <div className="mx-auto max-w-3xl">
          <SectionHeader
            title="Ofte stillede spørgsmål"
            subtitle="Mangler du noget? Skriv til os på kontakt@timetrack.dk."
          />
          <dl className="mt-10 space-y-4">
            {faq.map((item) => (
              <details
                key={item.q}
                className="group rounded-xl border border-slate-200 bg-white p-5 open:shadow-sm dark:border-slate-800 dark:bg-slate-950"
              >
                <summary className="cursor-pointer list-none">
                  <dt className="flex items-center justify-between gap-4 text-base font-semibold text-slate-900 dark:text-white">
                    {item.q}
                    <ArrowRight className="h-5 w-5 shrink-0 text-slate-400 transition group-open:rotate-90" />
                  </dt>
                </summary>
                <dd className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                  {item.a}
                </dd>
              </details>
            ))}
          </dl>
        </div>
      </section>

      <CTASection
        title="Klar til at forbinde e-conomic?"
        subtitle="Installation tager under ét minut. Du kan afbryde forbindelsen når som helst."
        primaryLabel="Installér e-conomic"
        primaryHref={INSTALL_URL}
        secondaryLabel="Tilbage til integrationer"
        secondaryHref="/integrations"
      />

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <Link
            href="/integrations"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Alle integrationer
          </Link>
        </div>
      </div>

      <Footer />
    </div>
  );
}
