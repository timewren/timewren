import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Dinero + TimeTrack: Automatisk fakturering for freelancere",
  description:
    "Lær hvordan du forbinder Dinero med TimeTrack og automatiserer fakturering baseret på dine timer. Trin-for-trin guide til opsætning og daglig brug.",
  openGraph: {
    title: "Dinero + TimeTrack: Automatisk fakturering for freelancere",
    description:
      "Forbind Dinero med TimeTrack og automatiser fakturering baseret på dine registrerede timer.",
  },
  alternates: { canonical: "/blog/dinero-timeregistrering-guide" },
};

export default function DineroTimeregistreringGuidePage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Dinero + TimeTrack: Automatisk fakturering for freelancere",
    description:
      "Lær hvordan du forbinder Dinero med TimeTrack og automatiserer fakturering baseret på dine timer.",
    author: {
      "@type": "Person",
      name: "Mads Holst Jensen",
    },
    publisher: {
      "@type": "Organization",
      name: "TimeTrack",
      url: "https://timetrack.dk",
    },
    datePublished: "2026-04-05",
    dateModified: "2026-04-05",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": "https://timetrack.dk/blog/dinero-timeregistrering-guide",
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
            Dinero + TimeTrack: Automatisk fakturering for freelancere
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Stop med at taste timer manuelt ind i Dinero. Her er hvordan du
            forbinder de to systemer og sparer tid p&aring; fakturering.
          </p>
          <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
            <span>Af Mads Holst Jensen</span>
            <span>5. april 2026</span>
            <span>6 min l&aelig;setid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-slate-700 leading-relaxed">
          <h2 className="text-2xl font-bold text-slate-900">
            Problemet: Dobbeltarbejde med timer og fakturaer
          </h2>
          <p>
            De fleste freelancere kender det: Du registrerer flittigt dine timer
            i et tidsregistreringssystem. N&aring;r m&aring;neden er omme,
            &aring;bner du Dinero, opretter en faktura og taster de samme timer
            ind igen. Manuelt. Linje for linje.
          </p>
          <p>
            Det er spild af tid, og det giver risiko for fejl. Glemte du den
            ekstra time torsdag? Var det 800 eller 850 kr/t for den kunde? Med
            en integration mellem dit tidsregistreringssystem og Dinero
            forsvinder de sp&oslash;rgsm&aring;l.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">Hvad er Dinero?</h2>
          <p>
            Dinero er et af Danmarks mest popul&aelig;re regnskabsprogrammer for
            sm&aring; virksomheder og freelancere. Det h&aring;ndterer
            fakturering, bogf&oslash;ring, moms og &aring;rsregnskab. Mange
            danske freelancere bruger allerede Dinero som deres
            &oslash;konomisystem.
          </p>
          <p>
            TimeTrack integrerer direkte med Dinero via OAuth, s&aring; du kan
            sende fakturaer baseret p&aring; dine registrerede timer uden at
            forlade TimeTrack.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            S&aring;dan forbinder du Dinero med TimeTrack
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">
            1. G&aring; til Integrationer
          </h3>
          <p>
            I TimeTrack finder du integrationsmenuen under Indstillinger →
            Integrationer. Her kan du se alle tilg&aelig;ngelige
            bogf&oslash;ringssystemer.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            2. V&aelig;lg Dinero og godkend adgang
          </h3>
          <p>
            Klik p&aring; &quot;Forbind med Dinero&quot;. Du bliver sendt til
            Dineros login-side, hvor du logger ind og godkender at TimeTrack
            m&aring; oprette fakturaer p&aring; dine vegne. Dette bruger OAuth.
            TimeTrack f&aring;r aldrig dit Dinero-password.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            3. V&aelig;lg standardindstillinger
          </h3>
          <p>
            N&aring;r forbindelsen er oprettet, kan du v&aelig;lge
            standardindstillinger: hvilken produktlinje i Dinero dine timer skal
            knyttes til, om du vil sende fakturaer som kladde eller direkte, og
            om betalingsbetingelser skal styres fra TimeTrack eller Dinero.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Fra tidsregistrering til faktura: Daglig arbejdsgang
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">
            Trin 1: Registr&eacute;r tid som normalt
          </h3>
          <p>
            Du arbejder og registrerer dine timer i TimeTrack, enten med
            timeren, manuelt eller via kalenderen. Hver tidsregistrering knyttes
            til en kunde og et projekt.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            Trin 2: Opret faktura fra timer
          </h3>
          <p>
            N&aring;r du er klar til at fakturere, g&aring;r du til
            fakturamodulet. Her kan du v&aelig;lge en kunde og en periode.
            TimeTrack samler automatisk alle ufakturerede timer og viser dem som
            fakturalinjer.
          </p>
          <p>
            Du kan redigere linjerne, sl&aring; timer sammen eller
            tilf&oslash;je ekstra poster f&oslash;r du sender. N&aring;r
            fakturaen ser rigtig ud, klikker du &quot;Send til Dinero&quot;.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            Trin 3: Fakturaen oprettes i Dinero
          </h3>
          <p>
            TimeTrack opretter fakturaen i Dinero med alle linjer, bel&oslash;b
            og kundeoplysninger. Afh&aelig;ngigt af dine indstillinger oprettes
            den som kladde (s&aring; du kan gennemse den i Dinero f&oslash;rst)
            eller sendes direkte til kunden.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Afstemning og overblik
          </h2>
          <p>
            N&aring;r en faktura er sendt til Dinero, markeres de
            tilh&oslash;rende timer automatisk som fakturerede i TimeTrack. Det
            giver dig fuldt overblik over:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Ufakturerede timer:</strong> timer du har registreret men
              endnu ikke faktureret
            </li>
            <li>
              <strong>Fakturerede timer:</strong> timer der allerede er sendt
              til Dinero
            </li>
            <li>
              <strong>Fakturastatus:</strong> om fakturaen er betalt, afventer
              eller forfaldent
            </li>
          </ul>
          <p>
            Det betyder at du aldrig glemmer at fakturere timer, og aldrig
            fakturerer de samme timer to gange.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Klippekort og Dinero
          </h2>
          <p>
            Bruger du klippekort (forudbetalte timer), er flowet lidt
            anderledes. Klippekortet faktureres n&aring;r kunden k&oslash;ber
            det, og timerne tr&aelig;kkes l&oslash;bende fra saldoen. Her
            beh&oslash;ver du ikke oprette l&oslash;bende fakturaer for
            individuelle timer, men kun n&aring;r klippekortet er brugt op og
            kunden skal k&oslash;be et nyt.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Ofte stillede sp&oslash;rgsm&aring;l
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">
            Virker det med andre regnskabssystemer?
          </h3>
          <p>
            Ja. Billy virker p&aring; samme m&aring;de som Dinero. TimeTrack har
            ogs&aring; en integration med e-conomic, hvor du kan hente dine
            kunder ind og eksportere fakturagrundlaget.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            Hvad hvis jeg har flere organisationer i Dinero?
          </h3>
          <p>
            Under OAuth-forbindelsen v&aelig;lger du hvilken organisation i
            Dinero du vil forbinde. Du kan kun forbinde &eacute;n ad gangen pr.
            TimeTrack-konto.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            Kan jeg redigere fakturaen i Dinero bagefter?
          </h3>
          <p>
            Ja. Hvis du opretter fakturaen som kladde, kan du redigere den frit
            i Dinero f&oslash;r du sender den. &AElig;ndringer i Dinero
            synkroniseres dog ikke tilbage til TimeTrack.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-slate-50 p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            Automatiser din fakturering
          </h2>
          <p className="mt-2 text-slate-600">
            Forbind TimeTrack med Dinero og g&aring; fra tidsregistrering til
            faktura p&aring; f&aring; klik.
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
                href="/blog/klippekort-freelancer"
                className="text-brand-600 hover:text-brand-700"
              >
                Klippekort til kunder: S&aring;dan s&aelig;lger du forudbetalte
                timer →
              </Link>
            </li>
          </ul>
        </div>
      </article>

      <Footer />
    </div>
  );
}
