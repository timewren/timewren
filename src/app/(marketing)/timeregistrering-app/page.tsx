import type { Metadata } from "next";
import Link from "next/link";
import { BetaTesterSignup } from "@/components/marketing/BetaTesterSignup";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
  PRIVAT_MAX_ACTIVE_CLIENTS,
} from "@/lib/billing/plan-limits";
import { PRIVAT_PRICE_MONTHLY, SUBSCRIPTION_PRICE_MONTHLY } from "@/lib/config";

const TITLE = "Tidsregistrering-app til iPhone, Android og browser";
const DESCRIPTION = `Tidsregistrering-app, der er gratis at starte: start timeren på telefonen, i browseren eller på computeren, og se timerne samme sted. Betalte planer fra ${PRIVAT_PRICE_MONTHLY} kr./md. ekskl. moms.`;

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | TimeTrack` },
  description: DESCRIPTION,
  alternates: { canonical: "/timeregistrering-app" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/timeregistrering-app",
    type: "website",
  },
};

const PLATFORMS = [
  {
    name: "iPhone og Android",
    status: "I test nu, kommer snart i App Store og Google Play",
    text: "Start og stop timeren fra telefonen, skriv tid ind for tidligere dage, og se ugens og månedens timer. Appen kan bruges uden konto, og timerne synkroniseres, når du logger ind. Du kan prøve den allerede nu som betatester.",
    href: "#betatester",
  },
  {
    name: "Telefonens browser",
    status: "Virker i dag",
    text: "Åbn app.timetrack.dk på telefonen, og læg siden på hjemmeskærmen. Så åbner den som en app, også uden netforbindelse.",
    href: "/features",
  },
  {
    name: "Chrome og Edge",
    status: "Virker i dag",
    text: "Browserudvidelsen starter og stopper timeren med ét klik, uden at du forlader den side, du arbejder på.",
    href: "/browser-extension",
  },
  {
    name: "Mac og Windows",
    status: "Virker i dag",
    text: "Desktop-appen holder timeren tæt på, også når browseren er lukket.",
    href: "/desktop",
  },
];

const FAQ = [
  {
    question: "Findes der en gratis app til tidsregistrering?",
    answer: `Ja. TimeTrack er gratis for op til ${FREE_MAX_SEATS} brugere med ${FREE_MAX_ACTIVE_CLIENTS} kunder, og alle apps er med, også på Gratis. Har du brug for flere kunder, har Privat plads til ${PRIVAT_MAX_ACTIVE_CLIENTS} aktive kunder og koster ${PRIVAT_PRICE_MONTHLY} kr./md., og Selvstændig har ubegrænset antal kunder for ${SUBSCRIPTION_PRICE_MONTHLY} kr./md. Priserne er ekskl. moms.`,
  },
  {
    question: "Hvornår kommer appen i App Store og Google Play?",
    answer:
      "Appen er i test lige nu og kommer i App Store og Google Play snart. Vil du prøve den før alle andre, kan du melde dig som betatester på denne side. Indtil da kan du bruge TimeTrack i telefonens browser og lægge den på hjemmeskærmen. Dine timer følger med over i appen.",
  },
  {
    question: "Kan jeg registrere tid uden internet?",
    answer:
      "Ja. Webappen kan åbnes uden netforbindelse, og appen gemmer timerne på telefonen, indtil der er forbindelse igen.",
  },
  {
    question: "Synkroniserer appen med computeren?",
    answer:
      "Ja. Web, telefon, browserudvidelse og desktop bruger den samme konto, så en timer startet på telefonen kan stoppes på computeren.",
  },
  {
    question:
      "Kan appen bruges til den lovpligtige registrering af arbejdstid?",
    answer:
      "Ja, med Virksomhed-planen. Medarbejderne kan checke ind og ud, og registreringerne gemmes med historik, som loven kræver.",
  },
];

export default function TimeregistreringAppPage() {
  const schema = [
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "TimeTrack",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Windows, macOS",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "DKK",
      },
    },
  ];

  return (
    <SEOPageLayout
      title="Tidsregistrering-app, der er med overalt"
      subtitle="Start timeren på telefonen, i browseren eller på computeren. Timerne samles ét sted, og appen er gratis at starte."
      jsonLd={schema}
      faqItems={FAQ}
      relatedLinks={[
        {
          href: "/tidsregistrering",
          title: "Tidsregistrering",
          description: "Regler, krav og hvordan I kommer i gang.",
        },
        {
          href: "/online-stopur",
          title: "Online stopur",
          description: "Tag tid direkte i browseren.",
        },
        {
          href: "/privat",
          title: "Til privatpersoner",
          description: "Se hvor din tid faktisk går hen.",
        },
        {
          href: "/selvstaendig",
          title: "Til selvstændige",
          description: "Klippekort og faktura ud fra timerne.",
        },
      ]}
      ctaTitle="Start timeren i dag"
      ctaSubtitle="Opret en gratis konto på under et minut. Du behøver ikke et betalingskort."
    >
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-balance text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Én konto, fire måder at registrere på
          </h2>
          <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 sm:grid-cols-2">
            {PLATFORMS.map((p) => (
              <div key={p.name} className="bg-white p-6">
                <p className="font-semibold text-gray-900">{p.name}</p>
                <p
                  className={`mt-1 text-sm font-medium ${p.status === "Virker i dag" ? "text-green-700" : "text-amber-700"}`}
                >
                  {p.status}
                </p>
                <p className="mt-3 leading-relaxed text-gray-600">{p.text}</p>
                {p.href ? (
                  <Link
                    href={p.href}
                    className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:text-brand-800"
                  >
                    {p.href.startsWith("#") ? "Bliv betatester" : "Læs mere"}
                  </Link>
                ) : null}
              </div>
            ))}
          </div>

          <div
            id="betatester"
            className="mt-16 scroll-mt-24 rounded-2xl border border-gray-200 bg-gray-50 p-6 sm:p-8"
          >
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
              Bliv betatester af mobilappen
            </h2>
            <p className="mt-3 text-lg leading-relaxed text-gray-700">
              Appen til iPhone og Android er næsten klar. Meld dig, så sender vi
              dig en invitation via TestFlight eller Google Play, og du kan
              bruge den, før den kommer i butikkerne.
            </p>
            <div className="mt-6 max-w-xl">
              <BetaTesterSignup />
            </div>
          </div>

          <h2 className="mt-16 text-balance text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Hvad skal en god app til tidsregistrering kunne?
          </h2>
          <ul className="mt-6 list-disc space-y-2 pl-6 text-lg leading-relaxed text-gray-700">
            <li>Starte timeren med ét tryk</li>
            <li>Lade dig skrive tid ind bagefter, når du har glemt timeren</li>
            <li>
              Vise ugens og månedens timer uden at du skal lave en rapport
            </li>
            <li>Synkronisere med computeren, så du ikke registrerer dobbelt</li>
            <li>Virke uden netforbindelse</li>
          </ul>
          <p className="mt-6 text-lg leading-relaxed text-gray-700">
            TimeTrack er bygget til præcis det, og er du selvstændig, bliver
            timerne også til{" "}
            <Link
              href="/timeregistrering-til-faktura"
              className="font-medium text-brand-700 underline underline-offset-2"
            >
              fakturagrundlag
            </Link>
            .
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
