import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { getMarketingUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Sådan vælger du det rigtige tidsregistreringssystem i 2026",
  description:
    "Sammenligning af tidsregistreringssystemer for freelancere: Harvest, Toggl, Clockify og TimeTrack. Kriterier, priser og beslutningsramme.",
  openGraph: {
    title: "Sådan vælger du det rigtige tidsregistreringssystem i 2026",
    description:
      "Sammenligning af tidsregistreringssystemer for freelancere. Kriterier, priser og beslutningsramme.",
  },
  alternates: { canonical: "/blog/vaelg-tidsregistrering" },
};

export default function VaelgTidsregistreringPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Sådan vælger du det rigtige tidsregistreringssystem i 2026",
    description:
      "Sammenligning af tidsregistreringssystemer for freelancere: Harvest, Toggl, Clockify og TimeTrack.",
    author: {
      "@type": "Person",
      name: "Mads Holst Jensen",
    },
    publisher: {
      "@type": "Organization",
      name: "TimeTrack",
      url: "https://timetrack.dk",
    },
    datePublished: "2026-04-18",
    dateModified: "2026-04-18",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": new URL("/blog/vaelg-tidsregistrering", getMarketingUrl()).href,
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
            ← Tilbage til blog
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            S&aring;dan v&aelig;lger du det rigtige tidsregistreringssystem i
            2026
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Der er mange tidsregistreringsv&aelig;rkt&oslash;jer derude. Her er
            hvad du skal kigge efter, og hvad du skal undg&aring;.
          </p>
          <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
            <span>Af Mads Holst Jensen</span>
            <span>18. april 2026</span>
            <span>8 min l&aelig;setid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-slate-700 leading-relaxed">
          <h2 className="text-2xl font-bold text-slate-900">
            Hvorfor valget betyder noget
          </h2>
          <p>
            Dit tidsregistreringssystem er noget du bruger <em>hver dag</em>.
            Hvis det er besv&aelig;rligt, stopper du med at bruge det. Og timer
            du ikke registrerer, er timer du ikke fakturerer. S&aring; det er
            v&aelig;rd at v&aelig;lge rigtigt fra starten.
          </p>
          <p>
            I 2026 er der flere muligheder end nogensinde. Nogle er gratis,
            nogle er dyre. Nogle er bygget til teams p&aring; 100 personer,
            andre til enkeltmandsfirmaer. Her er en ramme til at vurdere dem.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            De vigtigste kriterier
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">
            1. Brugervenlighed
          </h3>
          <p>
            Kan du starte en timer med &eacute;t klik? Kan du rette en
            tidsregistrering uden at navigere gennem tre menuer? Et system der
            f&oslash;les tungt, vil du hurtigt droppe.
          </p>
          <p>
            <strong>Test det:</strong> Pr&oslash;v at registrere en time. Hvis
            det tager mere end 30 sekunder, er det for besv&aelig;rligt.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            2. Dansk underst&oslash;ttelse
          </h3>
          <p>
            Mange internationale v&aelig;rkt&oslash;jer har kun engelsk
            gr&aelig;nseflade. Det er fint for nogle, men hvis dine kunder skal
            have adgang til rapporter eller en kundeportal, er det en fordel at
            systemet taler dansk.
          </p>
          <p>
            Dern&aelig;st: integrationer til danske regnskabssystemer som
            Dinero, e-conomic eller Billy er n&aelig;sten et must for
            freelancere i Danmark.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            3. Fakturering
          </h3>
          <p>
            Kan du g&aring; fra registrerede timer til en faktura uden at
            kopiere data manuelt? Det er her meget tid g&aring;r tabt.
            V&aelig;lg et system der enten har indbygget fakturering eller
            integrerer med dit regnskabsprogram.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            4. Klippekort-underst&oslash;ttelse
          </h3>
          <p>
            Hvis du arbejder med forudbetalte timer (klippekort), har du brug
            for et system der kan h&aring;ndtere saldoer, automatisk
            tr&aelig;kke fra og give kunden overblik. De f&aelig;rreste
            internationale v&aelig;rkt&oslash;jer har denne funktion.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">5. Pris</h3>
          <p>
            Gratis er fristende, men har ofte begr&aelig;nsninger. Betalte
            systemer koster typisk 50–200 kr./md. for en enkelt bruger. Overvej
            hvad en times tabt fakturering koster dig. Det er n&aelig;sten altid
            mere end softwaren.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Sammenligning: Popul&aelig;re muligheder
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">Toggl Track</h3>
          <p>
            Toggl er et af de mest kendte v&aelig;rkt&oslash;jer. Det har en god
            timer, fungerer p&aring; alle platforme og har en gratis plan.
            Ulemperne: ingen dansk gr&aelig;nseflade, ingen klippekort, og
            fakturering kr&aelig;ver den betalte plan. Integrationer til danske
            regnskabssystemer mangler.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">Harvest</h3>
          <p>
            Harvest er popul&aelig;rt blandt byr&aring;er og konsulenter. Det
            har god fakturering og team-funktioner. Men det er p&aring; engelsk,
            mangler klippekort, og er relativt dyrt for enkeltmandsfirmaer.
            Ingen danske integrationer.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">Clockify</h3>
          <p>
            Clockifys store fordel er den generøse gratis plan. Du kan
            registrere ubegr&aelig;nset tid uden at betale. Men
            gr&aelig;nsefladen er rodet, dansk er ikke underst&oslash;ttet, og
            du skal bruge andre v&aelig;rkt&oslash;jer til fakturering og
            klippekort. Rapporter er grundl&aelig;ggende p&aring; gratisplanen.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">TimeTrack</h3>
          <p>
            TimeTrack er bygget specifikt til danske freelancere. Dansk
            gr&aelig;nseflade, klippekort som kernefunktion, integration med
            Dinero/e-conomic/Billy, kundeportal og fakturering. Ulempen: det er
            nyere og har f&aelig;rre team-funktioner end de store internationale
            spillere.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Beslutningsramme
          </h2>
          <p>Stil dig selv disse sp&oslash;rgsm&aring;l:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Bruger jeg klippekort?</strong> Hvis ja, er dine
              muligheder begr&aelig;nsede. De fleste internationale
              v&aelig;rkt&oslash;jer har det ikke.
            </li>
            <li>
              <strong>Bruger jeg dansk regnskabsprogram?</strong> Hvis ja,
              v&aelig;lg et system med direkte integration, ellers ender du med
              dobbeltarbejde.
            </li>
            <li>
              <strong>Er jeg solo eller har jeg et team?</strong>{" "}
              Solo-freelancere har andre behov end teams. Du beh&oslash;ver ikke
              betale for 10 brugeres licens.
            </li>
            <li>
              <strong>Har jeg kunder der skal se rapporter?</strong> Kundeportal
              og kundevenlige rapporter er vigtige for transparens.
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            R&oslash;de flag: Hvad du skal undg&aring;
          </h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Systemer uden eksport:</strong> du skal altid kunne
              f&aring; dine data ud igen
            </li>
            <li>
              <strong>Langtidsbinding:</strong> undg&aring; &aring;rsaftaler
              f&oslash;r du har testet grundigt
            </li>
            <li>
              <strong>For mange funktioner:</strong> et system der ogs&aring; er
              projekt-, HR- og ledelses-system er ofte for komplekst til en
              freelancer
            </li>
            <li>
              <strong>Ingen mobilapp:</strong> du registrerer ofte tid p&aring;
              farten
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">Den bedste test</h2>
          <p>
            V&aelig;lg to systemer og pr&oslash;v dem begge i en uge. Det der
            f&oslash;les mest naturligt efter 7 dage, er nok det rigtige valg.
            Du skal ikke t&aelig;nke over at registrere tid. Det skal bare ske.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-slate-50 p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            Pr&oslash;v TimeTrack gratis
          </h2>
          <p className="mt-2 text-slate-600">
            Dansk tidsregistrering med klippekort, fakturering og
            regnskabsintegration. Se om det passer til dig.
          </p>
          <Link
            href="/register"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white hover:bg-brand-700"
          >
            Start gratis pr&oslash;veperiode
            <ArrowRight className="h-5 w-5" />
          </Link>
          <p className="mt-2 text-sm text-slate-500">
            Prøv gratis i 30 dage. Intet betalingskort.
          </p>
        </div>

        {/* Related */}
        <div className="mt-12 border-t border-slate-200 pt-8">
          <h3 className="font-semibold text-slate-900">Relaterede artikler</h3>
          <ul className="mt-4 space-y-2">
            <li>
              <Link
                href="/blog/timeregistrering-freelancer-guide"
                className="text-brand-600 hover:text-brand-700"
              >
                Timeregistrering som freelancer: Den komplette guide →
              </Link>
            </li>
            <li>
              <Link
                href="/blog/dinero-timeregistrering-guide"
                className="text-brand-600 hover:text-brand-700"
              >
                Dinero + TimeTrack: Automatisk fakturering for freelancere →
              </Link>
            </li>
            <li>
              <Link
                href="/blog/tidsregistrering-lov-danmark"
                className="text-brand-600 hover:text-brand-700"
              >
                Tidsregistreringslov i Danmark: Hvad du skal vide →
              </Link>
            </li>
          </ul>
        </div>
      </article>

      <Footer />
    </div>
  );
}
