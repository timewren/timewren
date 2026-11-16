import {
  AppWindow,
  Command,
  Download,
  ExternalLink,
  Globe,
  Keyboard,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { AppScreenshot } from "@/components/marketing/AppScreenshot";
import { PillBadge } from "@/components/marketing/PillBadge";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

const CWS_URL =
  "https://chromewebstore.google.com/detail/omfnfamlmdfaobhcphdfhcnihcllekof";

export const metadata: Metadata = {
  title: "Browser Extension til timetracking",
  description:
    "TimeTrack browser extension: start/stop timer direkte i browseren, smart projektforslag baseret på websites, keyboard shortcuts og offline support. Gratis til Chrome.",
  openGraph: {
    title: "Browser Extension til timetracking | TimeTrack",
    description:
      "TimeTrack browser extension: start/stop timer direkte i browseren, smart projektforslag baseret på websites, keyboard shortcuts og offline support. Gratis til Chrome.",
  },
  alternates: { canonical: "/browser-extension" },
};

export default function BrowserExtensionPage() {
  const softwareSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "TimeTrack Browser Extension",
    applicationCategory: "BrowserApplication",
    operatingSystem: "Chrome",
    browserRequirements: "Requires Chrome or Chromium-based browser",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "DKK",
    },
    description:
      "Browser extension til timetracking: start/stop timer, smart projektforslag og keyboard shortcuts. Gratis til Chrome.",
    url: CWS_URL,
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Er browser extensionen gratis?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Extensionen er gratis at installere og bruge. Du skal have en TimeTrack-konto for at synkronisere data.",
        },
      },
      {
        "@type": "Question",
        name: "Skal jeg have en TimeTrack-konto?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Extensionen forbinder til din TimeTrack-konto, så dine timer synkroniseres automatisk.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad sker der med min data?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Data synkroniseres til din TimeTrack-konto. Extensionen gemmer kun lokalt cache og indstillinger. Ingen tracking af browsing-historik.",
        },
      },
      {
        "@type": "Question",
        name: "Virker det i andre browsere end Chrome?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Extensionen virker i alle Chromium-baserede browsere: Chrome, Edge, Brave, Arc og Vivaldi.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Er browser extensionen gratis?",
      answer: (
        <p>
          Ja. Extensionen er gratis at installere og bruge. Du skal have en{" "}
          <Link className="underline" href="/#get-started">
            TimeTrack-konto
          </Link>{" "}
          for at synkronisere data.
        </p>
      ),
    },
    {
      question: "Skal jeg have en TimeTrack-konto?",
      answer: (
        <p>
          Ja. Extensionen forbinder til din TimeTrack-konto, så dine timer
          synkroniseres automatisk med dashboard, rapporter og klippekort.
        </p>
      ),
    },
    {
      question: "Hvad sker der med min data?",
      answer: (
        <p>
          Data synkroniseres til din TimeTrack-konto. Extensionen gemmer kun
          lokalt cache og indstillinger. Ingen tracking af browsing-historik.
        </p>
      ),
    },
    {
      question: "Virker det i andre browsere end Chrome?",
      answer: (
        <p>
          Ja. Extensionen virker i alle Chromium-baserede browsere: Chrome,
          Edge, Brave, Arc og Vivaldi.
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/features",
      title: "Features",
      description: "Overblik over hele TimeTrack-platformen.",
    },
    {
      href: "/klippekort",
      title: "Klippekort",
      description: "Prepaid timer med saldo og overblik.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Timer pr. kunde og projekt.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="TimeTrack Browser Extension"
      subtitle="Start og stop timer direkte i browseren. Smart projektforslag, keyboard shortcuts og offline support, så timetracking bliver en del af din arbejdsgang."
      badge={
        <PillBadge icon={<AppWindow className="h-4 w-4" />} variant="blue">
          Gratis til Chrome
        </PillBadge>
      }
      jsonLd={[softwareSchema, faqSchema]}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Extensionen giver mest værdi sammen med resten af TimeTrack:"
    >
      {/* Feature grid */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Globe className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Timer i browseren
              </h2>
              <p className="text-slate-600">
                Start/stop timer med et klik uden at skifte tab. Alt
                synkroniseres til din TimeTrack-konto.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Lightbulb className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Smart projektforslag
              </h2>
              <p className="text-slate-600">
                Extensionen husker hvilke projekter du arbejder på for
                forskellige websites og foreslår dem automatisk.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Keyboard className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Keyboard shortcuts
              </h2>
              <p className="text-slate-600">
                Start/stop timer og navigér med tastaturet. Perfekt til
                power-users der vil spare tid.
              </p>
            </div>
          </div>

          {/* Extension popup screenshot */}
          <div className="mt-14 flex justify-center">
            <div className="w-full max-w-sm">
              <Image
                src="/screenshots/extension/popup-dashboard.png"
                alt="TimeTrack browser extension popup: start/stop timer direkte i browseren"
                width={400}
                height={600}
                className="w-full rounded-2xl border border-slate-200/60 shadow-2xl"
              />
            </div>
          </div>

          {/* Sådan virker det */}
          <div className="mt-14">
            <h2 className="mb-8 text-center text-2xl font-bold text-slate-900 sm:text-3xl">
              Sådan kommer du i gang
            </h2>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                  1
                </div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Installér extensionen
                </h3>
                <p className="mt-2 text-slate-600">
                  Tilføj TimeTrack fra Chrome Web Store. Det tager 10 sekunder.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                  2
                </div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Forbind din konto
                </h3>
                <p className="mt-2 text-slate-600">
                  Log ind med din TimeTrack-konto, og extensionen henter dine
                  kunder og projekter.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                  3
                </div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Track tid
                </h3>
                <p className="mt-2 text-slate-600">
                  Klik på extensionen, vælg projekt og start timer. Alt
                  synkroniseres automatisk.
                </p>
              </div>
            </div>
          </div>

          {/* Chrome Web Store CTA */}
          <div className="mt-14 rounded-2xl border border-brand-200/60 bg-brand-50 p-8 text-center">
            <AppWindow className="mx-auto mb-4 h-12 w-12 text-brand-600" />
            <h3 className="text-2xl font-bold text-slate-900">
              Tilgængelig i Chrome Web Store
            </h3>
            <p className="mx-auto mt-2 max-w-lg text-slate-600">
              Gratis at installere. Virker i Chrome, Edge, Brave, Arc og andre
              Chromium-baserede browsere.
            </p>
            <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <a
                href={CWS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white transition-all hover:bg-brand-700 hover:shadow-lg"
              >
                <Download className="h-5 w-5" />
                Tilføj til Chrome
                <ExternalLink className="h-4 w-4" />
              </a>
              <span className="text-sm text-slate-500">
                Gratis, kræver TimeTrack-konto
              </span>
            </div>
          </div>

          {/* Flere features */}
          <div className="mt-14 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Command className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="text-xl font-semibold text-slate-900">
                New Tab dashboard
              </h3>
              <p className="mt-2 text-slate-600">
                Brug TimeTrack som ny fane-side med widgets for dagens timer,
                aktive klippekort og seneste registreringer.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Sparkles className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="text-xl font-semibold text-slate-900">
                Offline support
              </h3>
              <p className="mt-2 text-slate-600">
                Mist aldrig data: timer gemmes lokalt og synkroniseres når du er
                online igen.
              </p>
            </div>
          </div>

          {/* New Tab screenshot */}
          <div className="mt-14">
            <h3 className="mb-6 text-center text-2xl font-bold text-slate-900">
              New Tab: dit daglige overblik
            </h3>
            <div className="mx-auto max-w-4xl">
              <AppScreenshot
                src="/screenshots/extension/newtab.png"
                alt="TimeTrack New Tab dashboard: dagens timer, klippekort og seneste registreringer"
              />
            </div>
          </div>

          {/* Kom i gang */}
          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Har du ikke en konto endnu?
            </h3>
            <p className="mt-2 text-slate-600">
              Start gratis, og brug extensionen til at gøre tracking til en
              vane.
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
