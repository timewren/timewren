import type { Metadata } from "next";

import Link from "next/link";
import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "GDPR Compliance",
  description:
    "GDPR compliance hos TimeTrack: dine data tilhører dig. Læs om rettigheder, databehandlere, cookies og sikkerhedsforanstaltninger.",
  alternates: { canonical: "/gdpr" },
};

export default function GDPRPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <MarketingHero
        title="GDPR Compliance"
        subtitle="Sidst opdateret: 1. marts 2026. TimeTrack overholder den europæiske databeskyttelsesforordning (GDPR)"
      />

      {/* Content Section */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="typeset typeset-doc mx-auto max-w-4xl">
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-6">
            <p className="text-sm text-slate-700">
              <strong>TL;DR:</strong> Dine data tilhører dig. Vi beskytter dem,
              sælger dem aldrig, og du kan slette dem når som helst.
            </p>
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Dataansvarlig
          </h2>
          <div className="rounded-2xl bg-slate-50 p-6">
            <p className="text-slate-700">
              <strong>Firma:</strong> Mahope (Mahoje) v/ Mads Holst Jensen
              <br />
              <strong>CVR:</strong> 39413892
              <br />
              <strong>Email:</strong>{" "}
              <a
                href="mailto:timetrack@timetrack.dk"
                className="text-brand-600 hover:text-brand-700"
              >
                timetrack@timetrack.dk
              </a>
            </p>
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Dine GDPR-Rettigheder
          </h2>
          <p className="text-slate-600">
            I henhold til GDPR har du følgende rettigheder:
          </p>

          <div className="mt-8 grid gap-6">
            <div className="rounded-2xl border border-slate-200/60 p-6">
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                1. Ret Til Indsigt
              </h3>
              <p className="text-slate-600">
                Du kan anmode om en kopi af alle de personoplysninger, vi har om
                dig. Vi leverer dette i et struktureret, almindeligt anvendt og
                maskinlæsbart format.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                <strong>Hvordan:</strong>{" "}
                <Link
                  href="/dashboard/settings/gdpr"
                  className="text-brand-600 hover:text-brand-700"
                >
                  Log ind → Indstillinger → GDPR → Download data
                </Link>
              </p>
              <p className="mt-1 text-sm text-slate-500">
                <strong>Responstid:</strong> Maksimalt 30 dage
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 p-6">
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                2. Ret Til Rettelse
              </h3>
              <p className="text-slate-600">
                Du kan opdatere eller rette unøjagtige personoplysninger direkte
                i din konto under Indstillinger.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                <strong>Hvordan:</strong> Log ind → Indstillinger → Profil
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 p-6">
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                3. Ret Til Sletning ("Retten Til At Blive Glemt")
              </h3>
              <p className="text-slate-600">
                Du kan slette din konto og alle tilhørende data. Vi anonymiserer
                eller sletter dine oplysninger inden for 30 dage.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                <strong>Hvordan:</strong> Log ind → Indstillinger → Konto → Slet
                konto
              </p>
              <p className="mt-1 text-sm text-slate-500">
                <strong>Bemærk:</strong> Visse data kan opbevares i 7 år i
                henhold til bogføringsloven
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 p-6">
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                4. Ret Til Dataportabilitet
              </h3>
              <p className="text-slate-600">
                Du kan eksportere alle dine data i JSON eller CSV format og
                flytte dem til en anden platform.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                <strong>Hvordan:</strong>{" "}
                <Link
                  href="/dashboard/settings/data"
                  className="text-brand-600 hover:text-brand-700"
                >
                  Log ind → Indstillinger → Import og eksport
                </Link>
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 p-6">
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                5. Ret Til Begrænsning Af Behandling
              </h3>
              <p className="text-slate-600">
                Du kan anmode om at begrænse behandlingen af dine data i visse
                situationer.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                <strong>Hvordan:</strong> Kontakt os på timetrack@timetrack.dk
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 p-6">
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                6. Ret Til Indsigelse
              </h3>
              <p className="text-slate-600">
                Du kan gøre indsigelse mod behandling af dine personoplysninger
                til direkte markedsføring.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                <strong>Hvordan:</strong> Klik "afmeld" i vores emails eller
                kontakt os
              </p>
            </div>
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Cookies Og Tracking
          </h2>
          <p className="text-slate-600">
            TimeTrack bruger nødvendige cookies. Marketing-cookies fra Google
            Ads sættes kun, hvis du siger ja til dem. Vi bruger ikke
            analytics-cookies.
          </p>

          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200/60">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                    Cookie Type
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                    Formål
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                    Varighed
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                    Påkrævet
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-900">
                    <strong>Session</strong>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Login og session management
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">7 dage</td>
                  <td className="px-6 py-4 text-sm text-green-700">
                    <strong>Ja</strong>
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-900">
                    <strong>Cookie Consent</strong>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Gemmer dine cookie præferencer
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">1 år</td>
                  <td className="px-6 py-4 text-sm text-green-700">
                    <strong>Ja</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-6">
            <h3 className="mb-2 font-semibold text-slate-900">
              Cookieløs Analytics
            </h3>
            <p className="text-sm text-slate-700">
              Vores analytics (Plausible) bruger INGEN cookies. Vi tracker dig
              ikke på tværs af websites, og vi respekterer Do Not Track (DNT)
              browser-indstillinger. Alle data er anonymiseret og kan ikke
              bruges til at identificere dig personligt.
            </p>
          </div>

          <p className="mt-4 text-sm text-slate-600">
            Læs mere i vores{" "}
            <Link
              href="/cookies"
              className="text-brand-600 hover:text-brand-700"
            >
              Cookie Politik
            </Link>
            .
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Datasikkerhed
          </h2>
          <p className="text-slate-600">
            Vi beskytter dine data med følgende sikkerhedsforanstaltninger:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              <strong>Kryptering:</strong> SSL/TLS for all datatransmission
            </li>
            <li>
              <strong>Hosting:</strong> Databasen hostes hos Hetzner i Nürnberg,
              Tyskland (EU). Filer og backup ligger i Helsinki, Finland (EU)
            </li>
            <li>
              <strong>Backups:</strong> Daglig automatisk backup af databasen,
              de seneste 30 gemmes. Gendannelse testes automatisk hver måned
            </li>
            <li>
              <strong>Adgangskontrol:</strong> Multi-factor authentication
              tilgængelig for alle brugere
            </li>
            <li>
              <strong>Adgangskoder:</strong> Gemmes kun som envejs-hash, aldrig
              i klartekst
            </li>
            <li>
              <strong>Netværkssikkerhed:</strong> Firewall, DDoS beskyttelse og
              rate limiting
            </li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Databehandlere
          </h2>
          <p className="text-slate-600">
            Komplet liste over alle databehandlere. Alle er GDPR-compliant og vi
            har indgået databehandleraftaler hvor relevant.
          </p>

          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            Kernetjenester (altid aktive)
          </h3>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/60">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                    Tjeneste
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                    Formål
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                    Lokation
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    Hetzner
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Hosting og database
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Nürnberg, Tyskland og Helsinki, Finland (EU)
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    Stripe
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Betalingsbehandling
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Irland og USA (EU-U.S. DPF). Kun desktop-livstidslicens
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    Resend
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Transaktionelle emails
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    EU-region (Irland), amerikansk virksomhed (EU-U.S. DPF)
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    Sentry
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Fejlovervågning
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    USA (EU-U.S. Data Privacy Framework)
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    Plausible (selvhostet)
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Cookieløs analytics
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Vores egne servere (EU)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            Valgfrie tjenester (kun aktive hvis du vælger dem)
          </h3>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/60">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                    Tjeneste
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                    Formål
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                    Aktiveres ved
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    OpenAI
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    AI-funktioner (forslag, estimering)
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Du aktiverer AI i indstillinger
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    Google
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Calendar-sync og/eller OAuth-login
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Du tilslutter Google-konto
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    GitHub / Discord
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    OAuth-login
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Du vælger login via udbyder
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    MessageBird
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    SMS-login (OTP)
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Du tilføjer telefonnummer
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    Billy / Dinero / e-conomic
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Bogføring og fakturering
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    Du konfigurerer integrationen
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-6 text-slate-600">
            Vi bruger ikke Google Analytics eller Facebook Pixel. Googles
            annoncetag (Google Ads) indlæses i Consent Mode og sætter kun
            cookies, hvis du siger ja til marketing. Den fulde liste over
            databehandlere med land står på{" "}
            <Link
              href="/tillid"
              className="text-brand-600 hover:text-brand-700"
            >
              Tillid og data
            </Link>
            . Bruger du TimeTrack til oplysninger om andre, fx medarbejdere
            eller dine kunder, gælder{" "}
            <Link
              href="/databehandleraftale"
              className="text-brand-600 hover:text-brand-700"
            >
              databehandleraftalen
            </Link>{" "}
            for alle planer.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            AI og Dataminimering
          </h2>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <p className="text-sm text-slate-700">
              TimeTrack tilbyder valgfrie AI-funktioner drevet af OpenAI. Disse
              er <strong>deaktiveret som standard</strong>.
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>
                <strong>Dataminimering:</strong> Kun nødvendige data sendes
                (opgavetekster, tidsdata), aldrig adgangskoder, betalingsinfo
                eller private beskeder.
              </li>
              <li>
                <strong>Ingen træning:</strong> OpenAI oplyser, at API-data ikke
                bruges til at træne deres modeller.
              </li>
              <li>
                <strong>BYOK:</strong> Du kan bruge din egen OpenAI API-nøgle,
                så data håndteres direkte under din egen konto og aftale med
                OpenAI.
              </li>
              <li>
                <strong>Fravalg:</strong> Du kan deaktivere AI-funktioner når
                som helst under Indstillinger.
              </li>
            </ul>
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Databrud
          </h2>
          <p className="text-slate-600">I tilfælde af et databrud vil vi:</p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>Notificere Datatilsynet inden for 72 timer</li>
            <li>Notificere alle berørte brugere hurtigst muligt via email</li>
            <li>Tage øjeblikkelige skridt til at begrænse skaden</li>
            <li>Gennemføre en fuld sikkerhedsaudit</li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Klager
          </h2>
          <p className="text-slate-600">
            Hvis du mener, vi ikke overholder GDPR, kan du:
          </p>
          <ol className="mt-4 space-y-2 text-slate-600">
            <li>
              1. Kontakte os på{" "}
              <a
                href="mailto:timetrack@timetrack.dk"
                className="text-brand-600 hover:text-brand-700"
              >
                timetrack@timetrack.dk
              </a>
            </li>
            <li>
              2. Klage til Datatilsynet:{" "}
              <a
                href="https://www.datatilsynet.dk"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:text-brand-700"
              >
                www.datatilsynet.dk
              </a>
            </li>
          </ol>

          <div className="mt-12 rounded-2xl border-2 border-brand-600 bg-brand-50 p-8">
            <h3 className="mb-4 text-xl font-bold text-slate-900">
              Spørgsmål Om GDPR?
            </h3>
            <p className="mb-4 text-slate-700">
              Kontakt os hvis du har spørgsmål om hvordan vi behandler dine data
              eller vil udøve dine GDPR-rettigheder.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Kontakt Os
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
