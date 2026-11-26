import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { CTASection } from "@/components/marketing/CTASection";
import { FAQAccordion } from "@/components/marketing/FAQAccordion";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-gate";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "FAQ om TimeTrack: timeregistrering, tidsregistrering, fakturagrundlag, klippekort/prepaid og Billy/Dinero. Gratis at starte.",
  openGraph: {
    title: "FAQ",
    description:
      "FAQ om TimeTrack: timeregistrering, tidsregistrering, fakturagrundlag, klippekort/prepaid og Billy/Dinero. Gratis at starte.",
  },
  alternates: { canonical: "/faq" },
};

export default function FAQPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvem er TimeTrack til?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Primært solo-freelancere og selvstændige der fakturerer tid og vil have bedre dokumentation pr. kunde.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad er forskellen på timeregistrering og tidsregistrering?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "I praksis bruger mange ordene om det samme. Timeregistrering bruges ofte når fokus er fakturagrundlag, og tidsregistrering når fokus er dokumentation/overblik.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg lave en faktura ud fra mine timer?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Du kan lave rapport/eksport pr. periode og bruge det som fakturagrundlag.",
        },
      },
      {
        "@type": "Question",
        name: "Understøtter TimeTrack klippekort?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Klippekort er en kernefunktion. Du kan registrere forbrug og få saldo og historik.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg eksportere til Billy, Dinero eller e-conomic?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Billy, Dinero og e-conomic er live som integrationer. Du forbinder dem under Indstillinger → Integrationer. Du kan altid eksportere via CSV/rapport, hvis du foretrækker det.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad sker der med min data? (GDPR)",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Database, filer og backup ligger hos Hetzner i Tyskland og Finland (EU) og behandles efter GDPR. Enkelte underleverandører, fx til mail og fejlrapporter, er amerikanske; den fulde liste står på timetrack.dk/tillid. Du ejer altid dine data og kan eksportere eller slette dem, når du vil.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad sker der med mine data, hvis TimeTrack lukker?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Du får besked på mail mindst 6 måneder før, kan selv eksportere dine data i hele perioden og får forudbetalt, ubrugt abonnement tilbage. Bagefter slettes dine data efter databehandleraftalen. Læs mere på timetrack.dk/tillid.",
        },
      },
      {
        "@type": "Question",
        name: "Kan mine kunder se timerne?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja, med kundeportalen. Du kan give kunder adgang til en portal, hvor de ser timer, rapporter og klippekort-saldo.",
        },
      },
      {
        "@type": "Question",
        name: "Hvor lang er den gratis prøveperiode?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `30 dage med adgang til alle funktioner og intet betalingskort. Vælger du ikke en betalt plan bagefter, fortsætter du gratis med op til ${FREE_MAX_SEATS} brugere og ${FREE_MAX_ACTIVE_CLIENTS} kunder.`,
        },
      },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Navigation />

      <MarketingHero
        title="FAQ"
        subtitle="Hurtige svar på de mest almindelige spørgsmål om TimeTrack."
      >
        <div className="mx-auto mt-10 flex max-w-md flex-col gap-3">
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white transition-all hover:bg-brand-700 hover:shadow-lg"
          >
            Se priser
          </Link>
          <Link
            href="/#get-started"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-8 py-4 font-semibold text-slate-900 transition-colors hover:bg-slate-50"
          >
            Start gratis
          </Link>
        </div>
      </MarketingHero>

      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <FAQAccordion
            items={[
              {
                question: "Hvem er TimeTrack til?",
                answer:
                  "Primært solo-freelancere og selvstændige der fakturerer tid og vil have bedre dokumentation pr. kunde.",
              },
              {
                question:
                  "Hvad er forskellen på timeregistrering og tidsregistrering?",
                answer: (
                  <>
                    I praksis bruger mange ordene om det samme. Vi bruger typisk{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/timeregistrering"
                    >
                      timeregistrering
                    </Link>{" "}
                    når fokus er at få timerne korrekt (til faktura), og{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/tidsregistrering"
                    >
                      tidsregistrering
                    </Link>{" "}
                    når fokus er dokumentation/overblik.
                  </>
                ),
              },
              {
                question: "Kan jeg lave en faktura ud fra mine timer?",
                answer: (
                  <>
                    Ja. Du kan lave rapport/eksport pr. periode og bruge det som
                    fakturagrundlag. Se også{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/faktura-ud-fra-timer"
                    >
                      faktura ud fra timer
                    </Link>{" "}
                    og{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/timeregistrering-til-faktura"
                    >
                      timeregistrering til faktura
                    </Link>
                    .
                  </>
                ),
              },
              {
                question:
                  "Kan jeg eksportere til Billy, Dinero eller e-conomic?",
                answer: (
                  <>
                    Ja. Billy, Dinero og e-conomic er live som integrationer. Du
                    kan altid eksportere via CSV/rapport. Se også{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/billy"
                    >
                      Billy
                    </Link>{" "}
                    /{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/dinero"
                    >
                      Dinero
                    </Link>
                    .
                  </>
                ),
              },
              {
                question: "Understøtter TimeTrack klippekort?",
                answer: (
                  <>
                    Ja. Klippekort er en kernefunktion. Se{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/klippekort"
                    >
                      klippekort
                    </Link>{" "}
                    eller{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/prepaid-timer"
                    >
                      prepaid timer
                    </Link>
                    .
                  </>
                ),
              },
              {
                question: "Findes der en timeregistrering app?",
                answer: (
                  <>
                    Ja. Appen til iPhone og iPad ligger i App Store, og
                    desktop-appen findes til Mac og Windows. Android-appen
                    kommer snart i Google Play, og indtil da virker webappen på
                    telefonen. Du finder dem alle på{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/download"
                    >
                      download-siden
                    </Link>
                    , og mere om{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/timeregistrering-app"
                    >
                      appen til tidsregistrering
                    </Link>
                    .
                  </>
                ),
              },
              {
                question: "Har I en browser extension?",
                answer: (
                  <>
                    Ja. Den er lavet til at tracke tid der hvor arbejdet sker.
                    Læs mere på{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/browser-extension"
                    >
                      browser extension
                    </Link>
                    .
                  </>
                ),
              },
              {
                question: "Hvad koster TimeTrack?",
                answer: (
                  <>
                    Se altid den aktuelle pris på{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/pricing"
                    >
                      prissiden
                    </Link>
                    .
                  </>
                ),
              },
              {
                question: "Er der binding?",
                answer: "Nej. Du kan opsige når som helst.",
              },
              {
                question: "Skal jeg bruge betalingskort for at prøve?",
                answer: "Nej. Du kan starte prøveperioden uden betalingskort.",
              },
              {
                question: "Kan jeg tracke både med timer og manuelt?",
                answer:
                  "Ja. Brug timer når du kan, og manuel registrering når du skal. Målet er at du får timerne registreret rigtigt.",
              },
              {
                question: "Kan jeg lave rapporter pr. kunde og pr. periode?",
                answer:
                  "Ja. Det er en af grundene til, at TimeTrack starter med kunder og projekter, så rapporter og eksport giver mening.",
              },
              {
                question: "Tracker TimeTrack alt hvad jeg laver?",
                answer:
                  "Nej. Fokus er timeregistrering pr. kunde/projekt og ikke overvågning. Du har kontrol over tracking-niveauet.",
              },
              {
                question: "Hvad sker der med min data? (GDPR)",
                answer:
                  "Database, filer og backup ligger hos Hetzner i Tyskland og Finland (EU) og behandles efter GDPR. Enkelte underleverandører, fx til mail og fejlrapporter, er amerikanske; den fulde liste står på timetrack.dk/tillid. Du ejer altid dine data og kan eksportere eller slette dem, når du vil.",
              },
              {
                question: "Hvad sker der med mine data, hvis TimeTrack lukker?",
                answer:
                  "Du får besked på mail mindst 6 måneder før, kan selv eksportere dine data i hele perioden og får forudbetalt, ubrugt abonnement tilbage. Bagefter slettes dine data efter databehandleraftalen. Læs mere på timetrack.dk/tillid.",
              },
              {
                question: "Kan mine kunder se timerne?",
                answer: (
                  <>
                    Ja, med kundeportalen. Du kan give kunder adgang til en
                    portal, hvor de ser timer, rapporter og klippekort-saldo med
                    dit eget logo og farver.
                  </>
                ),
              },
              {
                question: "Hvor lang er den gratis prøveperiode?",
                answer: `30 dage med adgang til alle funktioner og intet betalingskort. Vælger du ikke en betalt plan bagefter, fortsætter du gratis med op til ${FREE_MAX_SEATS} brugere og ${FREE_MAX_ACTIVE_CLIENTS} kunder.`,
              },
              {
                question: "Hvordan kommer jeg hurtigst i gang?",
                answer:
                  "Start med 1–2 kunder, registrér en uge, og brug rapporten som fakturagrundlag. Det er nok til at mærke effekten.",
              },
              {
                question: "Hvor kan jeg læse mere om features?",
                answer: (
                  <>
                    Start på{" "}
                    <Link
                      className="underline hover:text-brand-600"
                      href="/features"
                    >
                      features
                    </Link>{" "}
                    &ndash; og hop videre til de use-case sider der matcher din
                    situation.
                  </>
                ),
              },
            ]}
          />

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h2 className="text-2xl font-bold text-slate-900">
              Klar til at teste?
            </h2>
            <p className="mt-2 text-slate-600">
              Gratis at starte. Intet betalingskort. Start småt og se, om det
              giver ro i faktureringen.
            </p>

            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-xl border border-slate-200/60 bg-white p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
                <div>
                  <div className="font-medium text-slate-900">
                    Start på 60 sek
                  </div>
                  <div className="text-sm text-slate-600">
                    Opret konto og track tid.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-slate-200/60 bg-white p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
                <div>
                  <div className="font-medium text-slate-900">
                    Fakturagrundlag
                  </div>
                  <div className="text-sm text-slate-600">
                    Rapport + eksport pr. kunde.
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-6 text-sm text-slate-500">
              Vil du se hvad der er med? Se{" "}
              <Link className="underline hover:text-brand-600" href="/features">
                features
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <CTASection
        checkmarks={[
          "Gratis at starte",
          "Intet betalingskort",
          "Alle apps inkluderet",
        ]}
      />

      <Footer />
    </div>
  );
}
