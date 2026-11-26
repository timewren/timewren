import {
  ArrowRight,
  Brain,
  CalendarDays,
  Check,
  Cloud,
  CreditCard,
  Download,
  HardDrive,
  Monitor,
  Shield,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DesktopBuyButton } from "@/components/desktop/DesktopBuyButton";
import { Footer } from "@/components/Footer";
import { CTASection } from "@/components/marketing/CTASection";
import { FAQAccordion } from "@/components/marketing/FAQAccordion";
import { FeatureCard } from "@/components/marketing/FeatureCard";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { PillBadge } from "@/components/marketing/PillBadge";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { Navigation } from "@/components/Navigation";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-limits";
import {
  BUSINESS_BASE_PRICE_MONTHLY,
  BUSINESS_INCLUDED_SEATS,
  DESKTOP_LIFETIME_MAX_DEVICES,
  DESKTOP_LIFETIME_PRICE,
  DESKTOP_REFUND_WINDOW_DAYS,
  planNameForTier,
  SUBSCRIPTION_PRICE_MONTHLY,
  TEAM_BASE_PRICE_MONTHLY,
  TEAM_INCLUDED_SEATS,
} from "@/lib/config";
import { TRPCProvider } from "@/providers/trpc-provider";

const FREE = planNameForTier("free");
const SOLO = planNameForTier("solo");
const TEAM = planNameForTier("team");
const BUSINESS = planNameForTier("business");

export const metadata: Metadata = {
  title: "Desktop App: tidsregistrering der kører lokalt",
  description:
    "TimeTrack Desktop: auto-tracking med AI, kalender, klippekort og fakturering. Dine data forbliver på din computer. Download til Windows og macOS.",
  openGraph: {
    title: "TimeTrack Desktop: tidsregistrering der kører på din computer",
    description:
      "Auto-tracking med AI, kalender, klippekort og fakturering. Dine data forbliver på din computer.",
    type: "website",
  },
  alternates: { canonical: "/desktop" },
};

const features = [
  {
    icon: <Monitor size={24} />,
    title: "Auto-tracking",
    description:
      "Din tid spores automatisk i baggrunden. TimeTrack registrerer hvilke apps og projekter du arbejder i, så du aldrig glemmer at tracke.",
  },
  {
    icon: <Brain size={24} />,
    title: "AI-klassificering",
    description:
      "AI sorterer din tid i projekter og kategorier. Alt sker lokalt på din computer. Understøtter Ollama, OpenAI, Anthropic og flere.",
  },
  {
    icon: <CalendarDays size={24} />,
    title: "Kalender",
    description:
      "Se din dag, uge eller måned med ét blik. Træk-og-slip tidsblokke, og få overblik over din arbejdsuge visuelt.",
  },
  {
    icon: <CreditCard size={24} />,
    title: "Klippekort",
    description:
      "Hold styr på forudbetalte timer. Automatisk træk fra klippekort når du registrerer tid, med status-eksport til PDF.",
  },
  {
    icon: <Shield size={24} />,
    title: "Privacy-first",
    description:
      "Aktivitetsdata forlader aldrig din maskine. Alt auto-tracking sker lokalt, uden cloud-upload af skærmbilleder eller appdata.",
  },
  {
    icon: <Cloud size={24} />,
    title: "Cloud sync",
    description:
      "Synkronisér valgfrit med TimeTrack Cloud. Få adgang til dine data på tværs af enheder, webapp og mobil.",
  },
];

const faqItems = [
  {
    question: "Hvad er klippekort?",
    answer:
      "Klippekort er forudbetalte timepakker. Din kunde køber fx 20 timer, og TimeTrack trækker automatisk fra saldoen når du registrerer tid. Du kan eksportere en status-rapport som PDF til kunden.",
  },
  {
    question: "Virker det offline?",
    answer:
      "Ja. Desktop-appen gemmer alt lokalt i en SQLite-database. Du behøver ingen internetforbindelse for at tracke tid, se rapporter eller håndtere klippekort. Sync til cloud er valgfrit.",
  },
  {
    question: "Er det GDPR-kompatibelt?",
    answer:
      "Ja. Aktivitetsdata (hvilke apps du bruger) forlader aldrig din computer. Kun tidsregistreringer og projektdata synkroniseres til cloud, og kun hvis du vælger det.",
  },
  {
    question: "Hvilke AI-providers understøttes?",
    answer:
      "TimeTrack Desktop understøtter Ollama (lokalt), OpenAI, Anthropic Claude, Google Gemini og OpenRouter. Med Ollama kører AI-klassificering 100% lokalt uden internetforbindelse.",
  },
  {
    question: "Kan jeg bruge det uden cloud?",
    answer: `Ja. Til personlig brug er desktop-appen gratis, også uden konto. Har du en TimeTrack-konto (også Gratis), er appen inkluderet uden ekstra betaling. Bruger du appen i din virksomhed uden konto, køber du en livstidslicens til ${DESKTOP_LIFETIME_PRICE} kr. én gang, se "Kun på denne computer" ovenfor. Aktivitetsdata bliver altid lokalt på din computer, uanset hvad du vælger.`,
  },
  {
    question: "Virker det på Mac?",
    answer:
      "Ja. Desktop-appen findes til macOS 11 eller nyere og Windows 10 eller nyere. Hent den fra download-siden. Linux er planlagt.",
  },
  {
    question: "Kan jeg importere fra Toggl/Harvest?",
    answer:
      "Ja. TimeTrack Cloud har færdige importere til Toggl, Harvest, Clockify og flere. Importér dine data og synkronisér dem ned til desktop-appen via cloud sync.",
  },
  {
    question: "Hvor gemmes mine data?",
    answer:
      "Alle data gemmes lokalt i en SQLite-database i din brugermappe (AppData på Windows). Du kan tage backup manuelt, og databasen er en enkelt fil du nemt kan flytte.",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
};

export default function DesktopPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SEO structured data
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <Navigation />

      {/* Hero */}
      <MarketingHero
        badge={
          <PillBadge icon={<HardDrive size={16} />} variant="purple">
            Desktop App
          </PillBadge>
        }
        title={
          <>
            Tidsregistrering der kører
            <br />
            <span className="text-brand-600">på din computer</span>
            {", ikke i skyen"}
          </>
        }
        subtitle="Auto-tracking med AI, kalender, klippekort og fakturering. Dine aktivitetsdata forbliver på din maskine."
      >
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/download"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white transition-all hover:bg-brand-700 hover:shadow-lg"
          >
            <Download className="h-5 w-5" />
            Hent desktop-appen
          </Link>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-slate-500">
          <span className="flex items-center gap-1.5">
            <Check className="h-4 w-4 text-emerald-500" />
            Intet betalingskort
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="h-4 w-4 text-emerald-500" />
            Virker offline
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="h-4 w-4 text-emerald-500" />
            Lokal AI-klassificering
          </span>
        </div>
      </MarketingHero>

      {/* Features */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Alt hvad du behøver for tidsregistrering"
            subtitle="Seks features der gør TimeTrack Desktop til det smarteste valg for freelancere og konsulenter."
          />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <FeatureCard
                key={feature.title}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Download */}
      <section
        id="download"
        className="bg-brand-600 px-4 py-20 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Hent TimeTrack Desktop
          </h2>
          <p className="mt-4 text-lg text-brand-100">
            Download appen til Windows eller macOS og kom i gang med det samme.
          </p>
          <div className="mt-8">
            <Link
              href="/download"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 font-semibold text-brand-700 transition-all hover:bg-brand-50 hover:shadow-lg"
            >
              <Download className="h-5 w-5" />
              Gå til download
            </Link>
          </div>
          <p className="mt-4 text-sm text-brand-200">
            Til Windows 10 eller nyere og macOS 11 eller nyere.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Simpel prissætning"
            subtitle="Desktop-appen er inkluderet i alle planer, også Gratis. Ingen binding."
          />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Gratis — desktop er inkluderet i alle planer, også den gratis */}
            <div className="relative rounded-2xl border border-slate-200/60 bg-white p-8 shadow-sm transition hover:shadow-md">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-slate-900">{FREE}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Desktop inkluderet, også gratis
                </p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-slate-900">0 kr.</span>
                <span className="text-sm text-slate-500"> for altid</span>
              </div>
              <ul className="mb-8 space-y-3 text-sm text-slate-600">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Desktop-app inkluderet
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Auto-tracking med AI
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Op til {FREE_MAX_SEATS} brugere · {FREE_MAX_ACTIVE_CLIENTS}{" "}
                  kunder
                </li>
              </ul>
              <Link
                href="/register?ref=desktop-pricing"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white transition-all hover:bg-slate-800"
              >
                Kom i gang gratis
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Solo Cloud */}
            <div className="relative rounded-2xl border-2 border-brand-500 bg-white p-8 shadow-md">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full bg-brand-600 px-4 py-1 text-xs font-semibold text-white">
                  Mest populær
                </span>
              </div>
              <div className="mb-4">
                <h3 className="text-lg font-bold text-slate-900">{SOLO}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Desktop og webapp i samme plan
                </p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-slate-900">
                  {SUBSCRIPTION_PRICE_MONTHLY} kr.
                </span>
                <span className="text-sm text-slate-500">/md. ekskl. moms</span>
              </div>
              <ul className="mb-8 space-y-3 text-sm text-slate-600">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  Desktop-app inkluderet
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  Cloud sync på tværs af enheder
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  Webapp-adgang
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  Mobil-app til iPhone og iPad
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  Billy/Dinero-integration
                </li>
              </ul>
              <Link
                href="/register?ref=desktop-pricing"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white transition-all hover:bg-brand-700"
              >
                Start gratis
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Team Cloud */}
            <div className="relative rounded-2xl border border-slate-200/60 bg-white p-8 shadow-sm transition hover:shadow-md">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-slate-900">{TEAM}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  For teams med delte projekter
                </p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-slate-900">
                  {TEAM_BASE_PRICE_MONTHLY} kr.
                </span>
                <span className="text-sm text-slate-500">/md. ekskl. moms</span>
              </div>
              <p className="-mt-4 mb-6 text-xs text-slate-500">
                {TEAM_INCLUDED_SEATS} brugere inkl.
              </p>
              <ul className="mb-8 space-y-3 text-sm text-slate-600">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Alt i {SOLO} + desktop-app
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Delte projekter og kunder
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Team-rapporter
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Rolle- og rettighedsstyring
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Kundeportal
                </li>
              </ul>
              <Link
                href="/register?plan=team&ref=desktop-pricing"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white transition-all hover:bg-slate-800"
              >
                Start gratis
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Business Cloud */}
            <div className="relative rounded-2xl border border-slate-200/60 bg-white p-8 shadow-sm transition hover:shadow-md">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-slate-900">{BUSINESS}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  For virksomheder med flere brugere
                </p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-slate-900">
                  {BUSINESS_BASE_PRICE_MONTHLY} kr.
                </span>
                <span className="text-sm text-slate-500">/md. ekskl. moms</span>
              </div>
              <p className="-mt-4 mb-6 text-xs text-slate-500">
                {BUSINESS_INCLUDED_SEATS} brugere inkl.
              </p>
              <ul className="mb-8 space-y-3 text-sm text-slate-600">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Alt i {TEAM}
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Ferie, fravær og flex-tid
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Check-in og godkendelser
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  SSO
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Prioriteret support
                </li>
              </ul>
              <Link
                href="/register?plan=business&ref=desktop-pricing"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white transition-all hover:bg-slate-800"
              >
                Start gratis
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Livstidslicens uden konto */}
      <section id="licens" className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8 shadow-sm sm:p-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  Kun på denne computer
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Til erhvervsbrug uden TimeTrack-konto. Køb licensen én gang.
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-3xl font-bold text-slate-900">
                  {DESKTOP_LIFETIME_PRICE} kr.
                </span>
                <p className="text-sm text-slate-500">én gang inkl. moms</p>
              </div>
            </div>
            <ul className="mt-6 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                Ingen konto påkrævet
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                Kunder, tid og aktivitet bliver på computeren
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                Op til {DESKTOP_LIFETIME_MAX_DEVICES} computere pr. licens
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                14 dages gratis prøve i appen
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                {DESKTOP_REFUND_WINDOW_DAYS} dages pengene-tilbage-garanti
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                Faktura med CVR
              </li>
            </ul>
            <div className="mt-8 max-w-sm">
              <TRPCProvider>
                <DesktopBuyButton className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white transition-all hover:bg-slate-800" />
              </TRPCProvider>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Til personlig brug er desktop-appen gratis, også uden konto. Har
              du en TimeTrack-konto, er appen allerede inkluderet i din plan,
              også Gratis. Licensen skal du kun købe, hvis du bruger appen i din
              virksomhed uden konto.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <FAQAccordion
            title="Ofte stillede spørgsmål"
            subtitle="Alt du bør vide om TimeTrack Desktop"
            items={faqItems}
          />
        </div>
      </section>

      {/* CTA */}
      <CTASection
        title="Klar til TimeTrack Desktop?"
        subtitle="Hent desktop-appen til Windows eller macOS og kom i gang i dag."
        primaryHref="/download"
        primaryLabel="Hent desktop-appen"
        secondaryHref="/features"
        secondaryLabel="Se alle funktioner"
        checkmarks={[
          "Ingen binding",
          "Virker offline",
          "Inkluderet i alle planer",
        ]}
      />

      <Footer />
    </>
  );
}
