import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { DESKTOP_LIFETIME_PRICE } from "@/lib/config";

const TITLE = "TimeTrack Desktop til Mac og Windows, nu med i alle planer";
const DESCRIPTION =
  "Desktop-appen til Mac og Windows kan hentes nu i beta. Den registrerer aktivitet lokalt, foreslår projekter og er med i alle planer, også Gratis.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://timetrack.dk/blog/desktop-app-coming-soon",
    type: "article",
  },
  alternates: { canonical: "/blog/desktop-app-coming-soon" },
};

export default function DesktopAppComingSoonPost() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: TITLE,
    description: DESCRIPTION,
    author: {
      "@type": "Person",
      name: "Mads Holst Jensen",
      url: "https://www.linkedin.com/in/madsholstjensen/",
    },
    publisher: {
      "@type": "Organization",
      name: "TimeTrack",
      url: "https://timetrack.dk",
    },
    datePublished: "2026-05-24",
    dateModified: "2026-10-27",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": "https://timetrack.dk/blog/desktop-app-coming-soon",
    },
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <Navigation />

      <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
        <header>
          <Link
            href="/blog"
            className="text-sm text-brand-600 hover:text-brand-700"
          >
            &larr; Tilbage til blog
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {TITLE}
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Da jeg skrev det første indlæg om desktop-appen i maj, var den på
            vej. Nu kan den hentes i beta til Mac og Windows, og den er med i
            alle planer.
          </p>
          <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
            <span>Af Mads Holst Jensen</span>
            <span>Opdateret 27. oktober 2026</span>
            <span>3 min læsetid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-slate-700 leading-relaxed">
          <h2 className="text-2xl font-bold text-slate-900">
            Hvorfor en desktop-app
          </h2>
          <p>
            TimeTrack startede som en webapp, og den klarer kunder, fakturering
            og klippekort fint. Men selve registreringen skal helst ske, uden at
            man husker at trykke start og stop. En desktop-app kan se, hvilke
            programmer og vinduer der er aktive, og samle det til et overblik
            over dagen.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Aktivitet registreres lokalt
          </h2>
          <p>
            Appen noterer lokalt, hvilket program og vindue der er aktivt. Ved
            dagens slutning ser du et overblik, som du kan fordele på dine
            projekter og sende til TimeTrack. Den klassiske start/stop-timer
            findes stadig, hvis du foretrækker den.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Forslag til projekter
          </h2>
          <p>
            Når dagen er fordelt på mange programmer, kan appen foreslå, hvilket
            projekt aktiviteten hører til. Du kan bruge din egen API-nøgle til
            en udbyder som OpenAI eller Anthropic, eller køre en lokal model via
            Ollama, så intet forlader din computer.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Dine aktivitetsdata bliver på din computer
          </h2>
          <p>
            Aktivitetsloggen over programmer og vinduer gemmes lokalt. Den
            sendes ikke til TimeTracks servere, appen tager ingen skærmbilleder
            og registrerer ikke tastetryk. Det eneste, der synkroniseres, er de
            tidsregistreringer, du selv vælger at sende, præcis som hvis du
            havde skrevet dem i webappen.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Kunder og klippekort i samme app
          </h2>
          <p>
            Desktop-appen bruger samme konto som webappen. Dine kunder,
            projekter og klippekort er med, så du kan starte en timer, se hvor
            mange timer der er tilbage på et klippekort og gennemgå ugen uden at
            åbne en browser.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">Pris</h2>
          <p>
            Siden 26. september 2026 er desktop-appen med i alle planer, også
            Gratis, når du har en TimeTrack-konto. Vil du bruge appen helt uden
            konto, kan du i stedet købe en livstidslicens til{" "}
            {DESKTOP_LIFETIME_PRICE} kr. én gang, se{" "}
            <Link
              href="/desktop#licens"
              className="text-brand-600 hover:text-brand-700 font-medium"
            >
              prisen på /desktop
            </Link>
            . Købte du licensen til den gamle pris på 999 kr., gælder den
            fortsat.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">Hent appen</h2>
          <p>
            Appen findes i beta til Windows og macOS.{" "}
            <Link
              href="/download"
              className="text-brand-600 hover:text-brand-700 font-medium"
            >
              Hent den på download-siden
            </Link>
            , eller læs mere om{" "}
            <Link
              href="/desktop"
              className="text-brand-600 hover:text-brand-700 font-medium"
            >
              TimeTrack Desktop
            </Link>
            .
          </p>

          <div className="mt-8 rounded-xl bg-brand-50 p-6 text-center">
            <p className="mb-4 font-semibold text-slate-900">
              Vil du prøve TimeTrack i browseren først?
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-3 font-medium text-white transition-colors hover:bg-brand-700"
            >
              Se priser
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </article>

      <Footer />
    </div>
  );
}
