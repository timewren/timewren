import { ArrowRight, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { appLinkHref } from "@/lib/config";

const TITLE = "Klippekort-skabelon til kunder: gratis aftale i Word";
const DESCRIPTION =
  "Gratis klippekort-skabelon til virksomheder og freelancere, der sælger forudbetalte timer. Download aftalen i Word, se hvad den skal indeholde, og hvordan du holder styr på saldoen.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  alternates: { canonical: "/blog/klippekort-skabelon" },
};

export default function KlippekortSkabelonPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: TITLE,
    description: DESCRIPTION,
    author: { "@type": "Person", name: "Mads Holst Jensen" },
    publisher: {
      "@type": "Organization",
      name: "TimeTrack",
      url: "https://timetrack.dk",
    },
    datePublished: "2026-10-11",
    dateModified: "2026-10-11",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": "https://timetrack.dk/blog/klippekort-skabelon",
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
            Klippekort-skabelon til kunder: gratis aftale i Word
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Sælger du timer på forhånd, skal både du og kunden vide, hvad
            klippekortet dækker, hvornår det udløber, og hvordan timerne
            trækkes. Her er en skabelon, du kan bruge med det samme.
          </p>
          <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
            <span>Af Mads Holst Jensen</span>
            <span>11. oktober 2026</span>
            <span>5 min læsetid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-slate-700 leading-relaxed">
          <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-6">
            <h2 className="text-xl font-semibold text-slate-900">
              Download klippekort-aftalen
            </h2>
            <p className="mt-2">
              Word-fil med felter til parter, antal timer, timepris, gyldighed,
              trækning, betaling og udløb. Ret den til, så den passer til dine
              ydelser.
            </p>
            <a
              href="/skabeloner/klippekort-aftale.docx"
              download
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700"
            >
              <Download className="h-4 w-4" />
              Hent skabelonen (.docx)
            </a>
          </div>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvad er et klippekort i en virksomhed?
          </h2>
          <p>
            Et klippekort er en pakke timer, som kunden betaler for på forhånd,
            fx 10 eller 20 timer. Hver gang du arbejder for kunden, trækkes
            tiden fra pakken. Når saldoen er ved at være brugt, køber kunden en
            ny pakke.
          </p>
          <p>
            Modellen er udbredt hos webbureauer, IT-konsulenter, designere,
            bogholdere og rådgivere, altså alle, der løser mange små opgaver for
            de samme kunder. Du får pengene før arbejdet, og kunden slipper for
            et nyt tilbud hver gang, der skal rettes noget.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Det skal stå i aftalen
          </h2>
          <p>
            Skabelonen har syv afsnit. De fleste uenigheder om klippekort
            opstår, fordi et af dem mangler:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Parter:</strong> navn og CVR på begge.
            </li>
            <li>
              <strong>Klippekortet:</strong> antal timer, timepris, samlet pris
              ekskl. moms og gyldighed. 12 måneder er normalt.
            </li>
            <li>
              <strong>Anvendelse og trækning:</strong> hvilke ydelser timerne
              dækker, mindste trækningsenhed (fx 15 minutter), og om transport
              tæller med.
            </li>
            <li>
              <strong>Betaling:</strong> klippekortet faktureres ved indgåelse,
              og timerne kan først bruges, når der er betalt.
            </li>
            <li>
              <strong>Udløb og refusion:</strong> hvad der sker med ubrugte
              timer, og hvor tidligt du varsler kunden.
            </li>
            <li>
              <strong>Øvrige vilkår:</strong> opgaver uden for klippekortet
              kræver en særskilt aftale.
            </li>
            <li>
              <strong>Underskrifter</strong> fra begge parter.
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Tre ting, der ofte bliver glemt
          </h2>
          <h3 className="text-xl font-semibold text-slate-900">
            1. Mindste trækningsenhed
          </h3>
          <p>
            Trækker du 5 minutter for en hurtig mail eller et kvarter? Skriv det
            ned. Ellers bliver det kunden, der undrer sig over, hvorfor et
            telefonopkald kostede en halv time.
          </p>
          <h3 className="text-xl font-semibold text-slate-900">
            2. Varsling før udløb
          </h3>
          <p>
            Ubrugte timer, der udløber uden varsel, giver dårlig stemning. Skriv
            i aftalen, at du giver besked, når saldoen er lav, og senest 30 dage
            før udløb. Det er også det bedste tidspunkt at sælge den næste
            pakke.
          </p>
          <h3 className="text-xl font-semibold text-slate-900">
            3. Hvordan kunden ser forbruget
          </h3>
          <p>
            Kunden har betalt på forhånd og vil gerne kunne se, hvad timerne er
            gået til. Aftal, om de får en opgørelse hver måned, når de beder om
            det, eller om de selv kan se saldoen i en kundeportal.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvad skal klippekortet koste?
          </h2>
          <p>
            De fleste giver 5 til 15 procent rabat, fordi kunden betaler på
            forhånd. Jo større pakken er, jo større rabat. Brug{" "}
            <Link
              href="/klippekort-prisberegner"
              className="text-brand-600 underline hover:text-brand-700"
            >
              klippekort-prisberegneren
            </Link>{" "}
            til at finde pakkeprisen og den effektive timepris, før du skriver
            tallet ind i aftalen. Er du i tvivl om selve timeprisen, så start
            med{" "}
            <Link
              href="/timepris-beregner"
              className="text-brand-600 underline hover:text-brand-700"
            >
              timepris-beregneren
            </Link>
            .
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Aftalen er det nemme. Saldoen er det svære
          </h2>
          <p>
            Et regneark med timer og restsaldo fungerer for én kunde. Med fem
            kunder og to medarbejdere går det galt: timer bliver ikke trukket,
            saldoen passer ikke, og kunden opdager det før dig.
          </p>
          <p>
            I{" "}
            <Link
              href="/klippekort"
              className="text-brand-600 underline hover:text-brand-700"
            >
              TimeTrack
            </Link>{" "}
            trækkes registreret tid automatisk fra kundens klippekort. Du får
            besked, når saldoen er lav, og kunden kan selv se forbrug og
            restsaldo i kundeportalen. Skabelonen dækker aftalen, og systemet
            holder styr på timerne bagefter.
          </p>
          <p>
            Vil du læse mere om modellen, så se{" "}
            <Link
              href="/blog/klippekort-freelancer"
              className="text-brand-600 underline hover:text-brand-700"
            >
              sådan sælger du klippekort
            </Link>{" "}
            og{" "}
            <Link
              href="/blog/klippekort-vs-fastpris"
              className="text-brand-600 underline hover:text-brand-700"
            >
              klippekort eller fastpris
            </Link>
            .
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-slate-50 p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            Hold styr på klippekortene automatisk
          </h2>
          <p className="mt-2 text-slate-600">
            Tiden trækkes fra saldoen, kunden ser forbruget selv, og du får
            besked før pakken er brugt.
          </p>
          <Link
            href={appLinkHref("/register")}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white hover:bg-brand-700"
          >
            Start gratis
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </article>

      <Footer />
    </div>
  );
}
